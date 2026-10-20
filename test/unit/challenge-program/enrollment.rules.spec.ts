import { FOOD_A_LITTLE_BETTER_V1 as PROGRAM } from "../../../src/challenge-program/content/food-a-little-better.v1";
import {
  EnrollmentRuleError,
  EnrollmentState,
  addDays,
  completionLabel,
  daysBetween,
  isDateKey,
  newEnrollmentState,
  recordAction,
  recordLesson,
  renderTemplate,
  resolveDay,
  shouldWelcomeBack,
  tipsForDay,
  validateAnswer,
} from "../../../src/challenge-program/enrollment.rules";

const NOW = new Date("2026-10-15T09:00:00Z");
const D1 = "2026-10-15";

/** Runs a day's action with an answer that fits it. */
function answerFor(day: number): unknown {
  const action = PROGRAM.days[day - 1].action;
  if (action.kind === "meal_pick") return ["Chicken and rice"];
  if ((action.kind === "choice" || action.kind === "reflection") && action.options) return action.options[0].id;
  if (action.kind === "choice" || action.kind === "plan") return "Something short";
  return undefined;
}

/** Plays days 1..n, one per calendar day. Returns the next calendar day. */
function playDays(state: EnrollmentState, n: number, status: "done" | "partly" | "skipped" = "done", from = D1) {
  let today = from;
  for (let i = 0; i < n; i++) {
    recordAction(state, PROGRAM, state.currentDay, { status, answer: answerFor(state.currentDay) }, today, NOW);
    today = addDays(today, 1);
  }
  return today;
}

describe("date keys", () => {
  it("validates real calendar dates only", () => {
    expect(isDateKey("2026-10-15")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("15/10/2026")).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
  });

  it("adds and diffs across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
  });
});

describe("progression", () => {
  it("starts on day 1, open today", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    expect(s.currentDay).toBe(1);
    expect(s.dayUnlockedOn).toBe(D1);
    expect(s.days).toHaveLength(30);
  });

  it("unlocks at most one new day per calendar day", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    const r = recordAction(s, PROGRAM, 1, { status: "done", answer: ["Pasta"] }, D1, NOW);
    expect(r.advanced).toBe(true);
    expect(s.currentDay).toBe(2);
    expect(s.dayUnlockedOn).toBe("2026-10-16");

    // Same day: day 2 is locked.
    expect(() => recordAction(s, PROGRAM, 2, { status: "done", answer: "midday" }, D1, NOW)).toThrow(
      expect.objectContaining({ code: "locked" }),
    );
    // Next day: it opens.
    expect(recordAction(s, PROGRAM, 2, { status: "done", answer: "midday" }, "2026-10-16", NOW).advanced).toBe(true);
  });

  it("refuses days not reached yet", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    expect(() => recordLesson(s, PROGRAM, 5, "opened", D1, NOW)).toThrow(
      expect.objectContaining({ code: "not_reached" }),
    );
    expect(() => recordLesson(s, PROGRAM, 31, "opened", D1, NOW)).toThrow(
      expect.objectContaining({ code: "invalid_day" }),
    );
  });

  it("waits after a gap without resetting anything", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    playDays(s, 3);
    expect(s.currentDay).toBe(4);
    // Ten days later, day 4 is simply there.
    const later = "2026-10-28";
    expect(recordAction(s, PROGRAM, 4, { status: "done", answer: "quick" }, later, NOW).advanced).toBe(true);
    expect(s.currentDay).toBe(5);
    expect(s.days.slice(0, 4).every((d) => d.actionStatus === "done")).toBe(true);
  });

  it("treats 'Not today' as a valid answer that moves the journey on", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    const r = recordAction(s, PROGRAM, 1, { status: "skipped" }, D1, NOW);
    expect(r.advanced).toBe(true);
    expect(s.days[0].actionStatus).toBe("skipped");
    expect(s.answers.everydayMeals).toBeUndefined();
  });

  it("'started' records an attempt without advancing or downgrading", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    expect(recordAction(s, PROGRAM, 1, { status: "started" }, D1, NOW).advanced).toBe(false);
    expect(s.days[0].actionStatus).toBe("started");
    recordAction(s, PROGRAM, 1, { status: "done", answer: ["Pasta"] }, D1, NOW);
    recordAction(s, PROGRAM, 1, { status: "started" }, D1, NOW);
    expect(s.days[0].actionStatus).toBe("done");
  });

  it("lets earlier answers be revised without advancing again", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    recordAction(s, PROGRAM, 1, { status: "done", answer: ["Pasta"] }, D1, NOW);
    const r = recordAction(s, PROGRAM, 1, { status: "done", answer: ["Soup", "Toast"] }, D1, NOW);
    expect(r.advanced).toBe(false);
    expect(s.currentDay).toBe(2);
    expect(s.answers.everydayMeals).toEqual(["Soup", "Toast"]);
  });

  it("keeps lesson opened and read apart", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    recordLesson(s, PROGRAM, 1, "opened", D1, NOW);
    expect(s.days[0].lessonOpenedAt).toEqual(NOW);
    expect(s.days[0].lessonReadAt).toBeUndefined();
    recordLesson(s, PROGRAM, 1, "read", D1, NOW);
    expect(s.days[0].lessonReadAt).toEqual(NOW);
  });

  it("rejects actions on a paused journey", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    s.status = "paused";
    expect(() => recordAction(s, PROGRAM, 1, { status: "skipped" }, D1, NOW)).toThrow(EnrollmentRuleError);
  });
});

describe("milestones and completion", () => {
  it("reaches each weekly milestone once", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    playDays(s, 6);
    const r = recordAction(s, PROGRAM, 7, { status: "done", answer: "meal_times" }, "2026-10-21", NOW);
    expect(r.milestonesReached.map((m) => m.id)).toEqual(["noticed"]);
    expect(s.milestones.map((m) => m.id)).toEqual(["noticed"]);
  });

  it("completes at 20 of 30 core days done or partly done", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    let today = playDays(s, 15, "done");
    today = playDays(s, 5, "partly", today);
    today = playDays(s, 9, "skipped", today);
    const r = recordAction(s, PROGRAM, 30, { status: "skipped" }, today, NOW);
    expect(r.finished).toEqual({ completed: true, coreDaysDone: 20 });
    expect(s.status).toBe("completed");
    expect(completionLabel(s, PROGRAM)).toBe("completed");
    expect(s.milestones.map((m) => m.id)).toEqual(["noticed", "set_up", "upgraded", "steady", "finished"]);
  });

  it("labels a run under the threshold 'finished', still with a completion", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    let today = playDays(s, 19, "done");
    today = playDays(s, 10, "skipped", today);
    const r = recordAction(s, PROGRAM, 30, { status: "skipped" }, today, NOW);
    expect(r.finished).toEqual({ completed: false, coreDaysDone: 19 });
    expect(s.status).toBe("completed");
    expect(completionLabel(s, PROGRAM)).toBe("finished");
  });
});

describe("welcome back", () => {
  it("shows after 3 or more days away", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    expect(shouldWelcomeBack(s, "2026-10-17", D1)).toBe(false);
    expect(shouldWelcomeBack(s, "2026-10-18", D1)).toBe(true);
  });
});

describe("answers", () => {
  const day = (n: number) => PROGRAM.days[n - 1].action;

  it("accepts known chip ids and refuses unknown ones", () => {
    expect(validateAnswer(day(5), "busy_evenings")).toBeNull();
    expect(validateAnswer(day(5), "hacked")).not.toBeNull();
    expect(validateAnswer(day(5), ["busy_evenings", "weekends"])).toBe("Pick one option");
    expect(validateAnswer(day(2), ["midday", "evening"])).toBeNull();
  });

  it("limits meal picks to 1–5 short names", () => {
    expect(validateAnswer(day(1), ["A", "B", "C"])).toBeNull();
    expect(validateAnswer(day(1), [])).not.toBeNull();
    expect(validateAnswer(day(1), ["x".repeat(500)])).not.toBeNull();
  });

  it("accepts small structured plans and refuses huge ones", () => {
    expect(validateAnswer(day(12), { slot: "lunch", time: "12:30" })).toBeNull();
    expect(validateAnswer(day(12), { blob: "x".repeat(3000) })).not.toBeNull();
  });

  it("refuses outcomes a day doesn't offer", () => {
    const s = newEnrollmentState(PROGRAM, D1, NOW);
    expect(() =>
      recordAction(s, PROGRAM, 1, { status: "done", answer: ["Pasta"], outcome: "liked" }, D1, NOW),
    ).toThrow(expect.objectContaining({ code: "invalid_answer" }));
  });
});

describe("rendering earlier answers", () => {
  const answers = { everydayMeals: ["Shakshuka", "Lentil soup"], trickyMoment: "busy_evenings", backupMeal: ["Omelette"] };

  it("fills in labels, indexes, lower-casing and fallbacks", () => {
    expect(renderTemplate("{{everydayMeals.0}}", PROGRAM, answers)).toBe("Shakshuka");
    expect(renderTemplate("{{everydayMeals}}", PROGRAM, answers)).toBe("Shakshuka, Lentil soup");
    expect(renderTemplate("{{trickyMoment:lower}}", PROGRAM, answers)).toBe("busy evenings");
    expect(renderTemplate("{{upgradeDish|your dish}}", PROGRAM, answers)).toBe("your dish");
  });

  it("resolves a day's prompt and options from the user's answers", () => {
    const day22 = resolveDay(PROGRAM, 22, answers)!;
    expect(day22.action.prompt).toBe("My plan for busy evenings: I'll…");
    expect(day22.action.options![0].label).toBe("Make Omelette");
    expect(resolveDay(PROGRAM, 4, {})!.action.prompt).toBe("What makes your go-to meal easy?");
  });

  it("never leaves a raw placeholder in any day, with or without answers", () => {
    for (const a of [{}, answers]) {
      for (const d of PROGRAM.days) {
        expect(JSON.stringify(resolveDay(PROGRAM, d.day, a))).not.toMatch(/\{\{/);
      }
    }
  });
});

describe("tips", () => {
  it("picks the variant that matches the user's answer", () => {
    expect(tipsForDay(PROGRAM, 9, { trickyMoment: "busy_evenings" }).map((t) => t.id)).toEqual(["busy-evening-batch"]);
    expect(tipsForDay(PROGRAM, 9, { trickyMoment: "on_the_go" }).map((t) => t.id)).toEqual(["hectic-midday-pack"]);
    expect(tipsForDay(PROGRAM, 9, {})).toEqual([]);
    expect(tipsForDay(PROGRAM, 16, {}).map((t) => t.id)).toEqual(["frozen-veg"]);
  });
});
