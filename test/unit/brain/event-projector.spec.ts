import {
  projectBehaviorEvents,
  observedDaysIn,
} from "../../../src/brain/events/event.projector";
import { BehaviorEventType } from "../../../src/brain/schemas/behavior-event.schema";

const oid = (n: number) => ({ toString: () => `meal${n}` }) as any;

const progressDay = (
  dateKey: string,
  meals: Record<string, any>,
  workouts: any[] = [],
) => ({ dateKey, meals, workouts });

const doneMeal = (name: string, completedAt?: string, id = 1) => ({
  _id: oid(id),
  name,
  done: true,
  calories: 500,
  ...(completedAt ? { completedAt } : {}),
});

describe("projectBehaviorEvents", () => {
  it("turns a ticked-off meal into a meal event", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", {
          breakfast: doneMeal("Oats", "2026-09-01T08:15:00"),
        }),
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const meal = events.find((e) => e.type === BehaviorEventType.MEAL_LOGGED);
    expect(meal).toBeDefined();
    expect(meal!.mealName).toBe("Oats");
    expect(meal!.dateKey).toBe("2026-09-01");
    expect(meal!.timestampIsExact).toBe(true);
    expect(meal!.timestamp.getHours()).toBe(8);
  });

  it("marks a meal with no completion time as inexact", () => {
    // The projector still places it, at the slot's typical hour, but flags
    // that the time is its own guess so no time-of-day claim can rest on it.
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [progressDay("2026-09-01", { dinner: doneMeal("Stew") })],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const meal = events.find((e) => e.type === BehaviorEventType.MEAL_LOGGED);
    expect(meal!.timestampIsExact).toBe(false);
  });

  it("emits snacks as snack events, not meals", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", {
          snacks: [doneMeal("Almonds", "2026-09-01T22:30:00", 2)],
        }),
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.SNACK_LOGGED)).toBe(true);
    expect(events.some((e) => e.type === BehaviorEventType.MEAL_LOGGED)).toBe(false);
  });

  it("records a planned meal that never happened as a skip", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", { breakfast: { _id: oid(3), name: "Toast", done: false } }),
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const skip = events.find((e) => e.type === BehaviorEventType.MEAL_SKIPPED);
    expect(skip).toBeDefined();
    expect(skip!.timestampIsExact).toBe(false);
  });

  it("does not treat today's untouched meals as skips", () => {
    // The day is still in progress. Counting it would tell a user at 9am that
    // they had already missed lunch.
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-08", { lunch: { _id: oid(4), name: "Soup", done: false } }),
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.MEAL_SKIPPED)).toBe(false);
  });

  it("attaches the mood that sat closest to the meal", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", {
          dinner: doneMeal("Pizza", "2026-09-01T21:30:00"),
        }),
      ],
      moods: [
        { date: "2026-09-01", time: "21:15", moodCategory: "stressed", energyLevel: 2, stressLevel: 5 },
        { date: "2026-09-01", time: "08:00", moodCategory: "calm", energyLevel: 4 },
      ],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const meal = events.find((e) => e.type === BehaviorEventType.MEAL_LOGGED);
    expect(meal!.context?.feeling).toBe("stressed");
    expect(meal!.context?.stress).toBe(5);
  });

  it("leaves feeling absent when no check-in was anywhere near", () => {
    // Absent is not neutral. A default here would let the Brain report a
    // calm dinner it never observed.
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", { dinner: doneMeal("Pizza", "2026-09-01T21:30:00") }),
      ],
      moods: [{ date: "2026-09-01", time: "08:00", moodCategory: "calm" }],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const meal = events.find((e) => e.type === BehaviorEventType.MEAL_LOGGED);
    expect(meal!.context?.feeling).toBeUndefined();
  });

  it("emits a takeaway event only when the user said where the food came from", () => {
    const withSource = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", { dinner: doneMeal("Pad Thai", "2026-09-01T20:00:00") }),
      ],
      moods: [],
      correlations: [
        { date: "2026-09-01", mealType: "dinner", source: "ordered" },
      ],
      todayKey: "2026-09-08",
    });

    expect(
      withSource.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED),
    ).toBe(true);

    const withoutSource = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", { dinner: doneMeal("Pad Thai", "2026-09-01T20:00:00") }),
      ],
      moods: [],
      correlations: [{ date: "2026-09-01", mealType: "dinner" }],
      todayKey: "2026-09-08",
    });

    expect(
      withoutSource.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED),
    ).toBe(false);
  });

  it("does not count home cooking as takeaway", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", { dinner: doneMeal("Stew", "2026-09-01T19:00:00") }),
      ],
      moods: [],
      correlations: [{ date: "2026-09-01", mealType: "dinner", source: "cooked" }],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED)).toBe(false);
  });

  it("matches the CBT model's singular slot name against progress's plural", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", {
          snacks: [doneMeal("Crisps", "2026-09-01T22:00:00", 7)],
        }),
      ],
      moods: [],
      correlations: [{ date: "2026-09-01", mealType: "snack", source: "ordered" }],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED)).toBe(true);
  });

  it("gives every event a fingerprint that is stable across runs", () => {
    const input = {
      userId: "u1",
      progressDocs: [
        progressDay(
          "2026-09-01",
          { breakfast: doneMeal("Oats", "2026-09-01T08:00:00") },
          [{ name: "Run", done: true }],
        ),
      ],
      moods: [{ date: "2026-09-01", time: "08:00", moodCategory: "calm" }],
      correlations: [],
      todayKey: "2026-09-08",
    };

    const a = projectBehaviorEvents(input).map((e) => e.fingerprint);
    const b = projectBehaviorEvents(input).map((e) => e.fingerprint);

    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("builds timestamps in local time, not UTC", () => {
    // `new Date("2026-09-01")` is UTC midnight, which is the previous evening
    // for anyone behind Greenwich — enough to move a mood into the wrong day.
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [],
      moods: [{ date: "2026-09-01", time: "23:30", moodCategory: "tired" }],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const wellness = events.find(
      (e) => e.type === BehaviorEventType.WELLNESS_LOGGED,
    );
    expect(wellness!.timestamp.getHours()).toBe(23);
    expect(wellness!.timestamp.getDate()).toBe(1);
  });

  it("counts observed days from the events themselves", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-01", { breakfast: doneMeal("Oats", undefined, 1) }),
        progressDay("2026-09-02", { breakfast: doneMeal("Eggs", undefined, 2) }),
        progressDay("2026-09-03", { breakfast: doneMeal("Yogurt", undefined, 3) }),
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    expect(observedDaysIn(events)).toBe(3);
  });

  it("returns events in chronological order", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [
        progressDay("2026-09-03", { breakfast: doneMeal("C", "2026-09-03T08:00:00", 3) }),
        progressDay("2026-09-01", { breakfast: doneMeal("A", "2026-09-01T08:00:00", 1) }),
        progressDay("2026-09-02", { breakfast: doneMeal("B", "2026-09-02T08:00:00", 2) }),
      ],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const times = events.map((e) => e.timestamp.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("takeaway data path", () => {
  /**
   * The end-to-end signal: the user says where the food came from, it lands on
   * the DailyProgress meal snapshot, and the Brain sees a takeaway event.
   * Before this path existed the answer lived only in device-local storage and
   * P08 could never fire.
   */
  const sourcedMeal = (source?: string) => ({
    _id: oid(9),
    name: "Pad Thai",
    done: true,
    calories: 700,
    completedAt: "2026-09-01T20:00:00",
    ...(source ? { source } : {}),
  });

  it("reads source straight off the progress snapshot", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [progressDay("2026-09-01", { dinner: sourcedMeal("ordered") })],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    const takeaway = events.find(
      (e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED,
    );
    expect(takeaway).toBeDefined();
    expect(takeaway!.mealName).toBe("Pad Thai");
    // Provenance names the record the answer came from, not just any record
    // that could have carried it.
    expect(takeaway!.source).toBe("daily_progress");
  });

  it("treats eaten-out as takeaway too", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [progressDay("2026-09-01", { dinner: sourcedMeal("eaten-out") })],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED)).toBe(true);
  });

  it("prefers the meal's own answer over a later correlation", () => {
    // The snapshot is stamped when the user logged what they ate; the
    // correlation is a reflection on the same meal afterwards.
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [progressDay("2026-09-01", { dinner: sourcedMeal("cooked") })],
      moods: [],
      correlations: [{ date: "2026-09-01", mealType: "dinner", source: "ordered" }],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED)).toBe(false);
  });

  it("falls back to the correlation when the snapshot never got an answer", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [progressDay("2026-09-01", { dinner: sourcedMeal() })],
      moods: [],
      correlations: [{ date: "2026-09-01", mealType: "dinner", source: "ordered" }],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED)).toBe(true);
  });

  it("stays silent when nobody ever said where the food came from", () => {
    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: [progressDay("2026-09-01", { dinner: sourcedMeal() })],
      moods: [],
      correlations: [],
      todayKey: "2026-09-08",
    });

    expect(events.some((e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED)).toBe(false);
  });

  it("feeds P08 from progress snapshots alone", () => {
    // The real acceptance test: source on the snapshot is enough to make the
    // pattern fire, with no correlations involved at all.
    const { PatternEngine } = require("../../../src/brain/patterns/pattern.engine");
    const engine = new PatternEngine();

    const docs = Array.from({ length: 8 }, (_, i) => {
      const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
      return progressDay(day, {
        dinner: {
          _id: oid(100 + i),
          name: "Takeaway",
          done: true,
          calories: 700,
          completedAt: `${day}T20:00:00`,
          source: "ordered",
        },
      });
    });

    const events = projectBehaviorEvents({
      userId: "u1",
      progressDocs: docs,
      moods: [],
      correlations: [],
      todayKey: "2026-09-30",
    });

    const patterns = engine.analyze(events, { days: 14, observedDays: 8 });
    const p08 = patterns.find((p: any) => p.patternId === "P08");

    expect(p08).toBeDefined();
    expect(p08.score).toBeGreaterThan(0.35);
  });
});
