import { PatternEngine, LATE_NIGHT_HOUR } from "../../../src/brain/patterns/pattern.engine";
import { projectBehaviorEvents } from "../../../src/brain/events/event.projector";
import { renderPlannerContext } from "../../../src/brain/brain.prompt";
import {
  BehaviorEventType,
  IBehaviorEvent,
} from "../../../src/brain/schemas/behavior-event.schema";
import { BrainState } from "../../../src/brain/decision/brain-state.types";

const engine = new PatternEngine();

/** 2026-09-07 is a Monday. */
const dayKey = (offset: number) => {
  const d = new Date(2026, 8, 7 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const event = (
  over: Partial<IBehaviorEvent> & { dayOffset?: number; hour?: number },
): IBehaviorEvent => {
  const { dayOffset = 0, hour = 12, ...rest } = over;
  const key = dayKey(dayOffset);
  const [y, m, d] = key.split("-").map(Number);
  return {
    userId: "u" as any,
    type: BehaviorEventType.MEAL_LOGGED,
    timestamp: new Date(y, m - 1, d, hour, 0, 0),
    timestampIsExact: true,
    dateKey: key,
    source: "test",
    fingerprint: `${key}-${hour}-${Math.random()}`,
    ...rest,
  } as IBehaviorEvent;
};

const lunch = (dayOffset: number) =>
  event({ dayOffset, mealType: "lunch", type: BehaviorEventType.MEAL_LOGGED });
const skippedLunch = (dayOffset: number, skipReason?: string) =>
  event({
    dayOffset,
    mealType: "lunch",
    type: BehaviorEventType.MEAL_SKIPPED,
    timestampIsExact: false,
    context: { planned: true, explicitSkip: Boolean(skipReason), ...(skipReason ? { skipReason } : {}) },
  });
const lateSnack = (dayOffset: number) =>
  event({ dayOffset, type: BehaviorEventType.SNACK_LOGGED, hour: 22 });

const window = { days: 30, observedDays: 14 };

describe("P09 · skipping lunch", () => {
  it("fires when lunch is skipped on most days, and says why and what followed", () => {
    // Adam: 4 busy-day skips out of 7, chocolate at 22:00 on three of them.
    const events = [
      skippedLunch(0, "time-pressure"),
      skippedLunch(1, "time-pressure"),
      skippedLunch(2, "time-pressure"),
      skippedLunch(3),
      lunch(4),
      lunch(5),
      lunch(6),
      lateSnack(0),
      lateSnack(1),
      lateSnack(3),
    ];

    const p09 = engine.analyze(events, window).find((p) => p.patternId === "P09");

    expect(p09).toBeDefined();
    expect(p09!.score).toBeGreaterThan(0.35);
    const text = p09!.evidence.map((e) => e.description);
    expect(text[0]).toBe("Lunch was skipped on 4 of 7 days it was planned.");
    expect(text).toContain("3 of those were because you were too busy.");
    expect(text).toContain(`On 3 of those days, something was eaten after ${LATE_NIGHT_HOUR}:00.`);
  });

  it("stays silent for someone who mostly eats lunch", () => {
    const events = [skippedLunch(0), skippedLunch(1), ...[2, 3, 4, 5, 6, 7, 8].map(lunch)];
    expect(engine.analyze(events, window).find((p) => p.patternId === "P09")).toBeUndefined();
  });

  it("stays silent below the minimum window", () => {
    const events = [0, 1, 2, 3, 4].map((d) => skippedLunch(d));
    expect(
      engine
        .analyze(events, { days: 30, observedDays: 5 })
        .find((p) => p.patternId === "P09"),
    ).toBeUndefined();
  });

  it("lets a lunch logged later in the day beat a skip record", () => {
    const events = [0, 1, 2].flatMap((d) => [skippedLunch(d), lunch(d)]).concat(
      [3, 4, 5, 6].map(lunch),
    );
    expect(engine.analyze(events, window).find((p) => p.patternId === "P09")).toBeUndefined();
  });

  it("never counts an inexact late meal as evidence", () => {
    const events = [
      skippedLunch(0),
      skippedLunch(1),
      skippedLunch(2),
      lunch(3),
      lunch(4),
      event({ dayOffset: 0, type: BehaviorEventType.SNACK_LOGGED, hour: 22, timestampIsExact: false }),
    ];
    const p09 = engine.analyze(events, window).find((p) => p.patternId === "P09");
    expect(p09!.evidence.some((e) => /after/.test(e.description))).toBe(false);
  });
});

describe("explicit skips reach the Brain", () => {
  const planned = { _id: { toString: () => "l1" }, name: "Quesadillas", done: false, calories: 600 };

  it("projects today's explicit skip, with its reason", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        {
          dateKey: "2026-09-08",
          meals: { lunch: { ...planned, skipped: true, skipReason: "time-pressure" } },
          workouts: [],
        },
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    } as any);

    const skip = events.find((e) => e.type === BehaviorEventType.MEAL_SKIPPED);
    expect(skip).toBeDefined();
    expect(skip!.context).toMatchObject({ explicitSkip: true, skipReason: "time-pressure" });
  });

  it("still ignores today's untouched meals", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [{ dateKey: "2026-09-08", meals: { lunch: planned }, workouts: [] }],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    } as any);
    expect(events.find((e) => e.type === BehaviorEventType.MEAL_SKIPPED)).toBeUndefined();
  });
});

describe("planner brief · week-to-week progress", () => {
  const state = (patterns: any[]): BrainState =>
    ({
      confidence: "medium",
      patterns,
      decision: { patternId: null, mealStrategy: null },
      analysis: { plannerBrief: null, directives: null },
    }) as any;

  it("tells the planner what is improving, so it keeps what works", () => {
    const brief = renderPlannerContext(
      state([{ patternId: "P09", name: "Skipping lunch", status: "improving", evidence: [] }]),
    );
    expect(brief).toMatch(/PROGRESS — Improving since we started: Skipping lunch\./);
    expect(brief).toMatch(/do not stack new changes/);
  });

  it("mentions a recently resolved pattern, and forgets an old one", () => {
    const now = new Date(2026, 8, 30);
    const recent = renderPlannerContext(
      state([]),
      [{ patternId: "P04", resolvedAt: new Date(2026, 8, 20) }],
      now,
    );
    expect(recent).toMatch(/Recently resolved: Late-night eating/);

    const old = renderPlannerContext(
      state([]),
      [{ patternId: "P04", resolvedAt: new Date(2026, 6, 1) }],
      now,
    );
    expect(old).toBeNull();
  });
});
