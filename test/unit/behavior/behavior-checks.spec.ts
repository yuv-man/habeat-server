import { runChecks, checkById, verifyCheck, CheckResult } from "../../../src/behavior/behavior-checks";
import { BehaviorSummary } from "../../../src/behavior/behavior-summary.types";

const rate = (value: number | null, hits = 0, of = 0) => ({ value, hits, of });

const summary = (over: any = {}): BehaviorSummary =>
  ({
    period: { days: 30, start: "", end: "", daysWithAnyData: 25 },
    adherence: {
      plannedMeals: 84, completed: 58, skipped: 26, replaced: 1, replacedTotal: 1,
      completionRate: rate(0.69, 58, 84),
      bySlot: {
        breakfast: rate(0.3, 6, 20),
        lunch: rate(0.95, 25, 26),
        dinner: rate(0.8, 16, 20),
        snacks: rate(0.8, 8, 10),
      },
      weekday: rate(0.8, 45, 56),
      weekend: rate(0.46, 13, 28),
      weekendDelta: -0.34,
      byDayOfWeek: {},
    },
    timing: { lateEatingRate: rate(0.2, 5, 25), lateEatingDays: 5 },
    variety: { distinctMeals: 18, totalMeals: 40, repeatRate: 0.55, mostRepeated: [] },
    nutrition: {
      avgCaloriesConsumed: 1900, avgCalorieGoal: 2000, calorieAccuracy: "on-target",
      macroWeakness: "protein", daysWithNutritionData: 25,
    },
    water: { avgGlasses: 6, goal: 8, daysMetGoal: 20, consistency: rate(0.8, 20, 25) },
    exercise: { sessionsPlanned: 10, sessionsCompleted: 8, completionRate: rate(0.8, 8, 10) },
    prepTime: {
      avgPlanned: 25, avgCompleted: 12, avgSkipped: 38, skippedMinusCompleted: 26,
      bySlot: {
        breakfast: { avgCompleted: null, avgSkipped: 40 },
        lunch: { avgCompleted: 12, avgSkipped: 13 },
        dinner: { avgCompleted: 20, avgSkipped: 22 },
        snacks: { avgCompleted: 2, avgSkipped: 2 },
      },
    },
    wellness: { daysWithCheckIn: 20 },
    foodAndFeeling: {
      scoredEpisodes: 20, emotionalEpisodes: 4, mindfulEatingScore: 80,
      adherenceOnLowMoodDays: rate(0.4, 6, 15),
      adherenceOnOtherDays: rate(0.75, 52, 69),
      lateEatingOnHardDays: rate(0.2, 2, 10),
      lateEatingOnOtherDays: rate(0.2, 3, 15),
      snacksPerHardDay: 0.6, snacksPerOtherDay: 0.5,
    },
    ...over,
  }) as BehaviorSummary;

const fired = (checks: CheckResult[]) => checks.filter((c) => c.fired).map((c) => c.id);

describe("runChecks", () => {
  it("fires on the slot that is planned and not eaten, and not on the ones that are", () => {
    const ids = fired(runChecks(summary()));
    expect(ids).toContain("breakfast-adherence-low");
    expect(ids).not.toContain("lunch-adherence-low");
    expect(ids).not.toContain("dinner-adherence-low");
  });

  it("compares a never-eaten slot against everything the user does finish", () => {
    // Breakfast has no completed prep time of its own — it is never made. The
    // baseline is the user's other meals, which is the comparison that matters.
    const c = checkById(runChecks(summary()), "breakfast-too-slow")!;
    expect(c.fired).toBe(true);
    expect(c.value).toBe(28);
    expect(c.evidence).toContain("40 min");
  });

  it("holds a check below its minimum evidence, however extreme the value", () => {
    const c = checkById(
      runChecks(
        summary({
          adherence: { ...summary().adherence, bySlot: { ...summary().adherence.bySlot, dinner: rate(0, 0, 2) } },
        })
      ),
      "dinner-adherence-low"
    )!;

    // Zero of two is not a pattern. The evidence bar is part of the check, not
    // an afterthought applied downstream.
    expect(c.value).toBe(0);
    expect(c.fired).toBe(false);
    expect(c.basis).toBeLessThan(c.minBasis);
  });

  describe("low-variety", () => {
    const variety = (distinctMeals: number, totalMeals: number) =>
      checkById(
        runChecks(
          summary({
            variety: {
              distinctMeals,
              totalMeals,
              repeatRate: totalMeals ? (totalMeals - distinctMeals) / totalMeals : null,
              mostRepeated: [],
            },
          })
        ),
        "low-variety"
      )!;

    it("does not fire on a normal rotation, however often it repeats", () => {
      // 20 dishes over 90 meals is a 78% repeat rate — and a healthy, settled
      // week. The old repeat-rate check fired here and pushed plans toward
      // novelty (docs/the-repertoire.md).
      expect(variety(20, 90).fired).toBe(false);
      expect(variety(8, 60).fired).toBe(false);
    });

    it("fires on a rotation narrower than the repertoire minimum", () => {
      const c = variety(5, 40);
      expect(c.fired).toBe(true);
      expect(c.value).toBe(5);
      expect(c.evidence).toContain("5 distinct dishes across 40 logged meals");
    });

    it("holds when too few meals are logged for the rotation to have come round", () => {
      expect(variety(5, 12).fired).toBe(false);
    });
  });

  it("never fires on an unmeasurable quantity", () => {
    const blank = runChecks(
      summary({
        timing: { lateEatingRate: rate(null, 0, 0), lateEatingDays: 0 },
        variety: { distinctMeals: 0, totalMeals: 0, repeatRate: null, mostRepeated: [] },
        water: { avgGlasses: null, goal: null, daysMetGoal: 0, consistency: rate(null, 0, 0) },
      })
    );

    expect(fired(blank)).not.toContain("late-eating-frequent");
    expect(fired(blank)).not.toContain("low-variety");
    expect(fired(blank)).not.toContain("water-inconsistent");
  });

  it("reports every check, fired or not, as the baseline for a later comparison", () => {
    const checks = runChecks(summary());
    expect(checks.length).toBeGreaterThan(10);
    expect(checks.every((c) => typeof c.evidence === "string" && c.evidence.length > 0)).toBe(true);
    expect(checks.some((c) => !c.fired)).toBe(true);
  });

  it("fires the weekend and wellbeing links when the gaps are real", () => {
    const ids = fired(
      runChecks(
        summary({
          foodAndFeeling: {
            ...summary().foodAndFeeling,
            snacksPerHardDay: 2.1,
            snacksPerOtherDay: 0.6,
          },
        })
      )
    );

    expect(ids).toContain("weekend-gap");
    expect(ids).toContain("low-mood-adherence-drop");
    expect(ids).toContain("stress-snacking");
  });
});

describe("verifyCheck", () => {
  const before: CheckResult = {
    id: "breakfast-adherence-low",
    area: "breakfast",
    label: "breakfast is logged far less often than it is planned",
    fired: true,
    value: 0.3,
    threshold: 0.6,
    direction: "below",
    basis: 20,
    minBasis: 3,
    evidence: "6 of 20",
  };

  it("calls it resolved once the check stops firing", () => {
    const r = verifyCheck(before, { ...before, value: 0.8, fired: false, evidence: "16 of 20" });
    expect(r.outcome).toBe("resolved");
    expect(r.after).toBe(0.8);
  });

  it("calls it eased when it is still firing but genuinely moving", () => {
    const r = verifyCheck(before, { ...before, value: 0.5, evidence: "10 of 20" });
    expect(r.outcome).toBe("eased");
  });

  it("calls it unchanged when the number barely moved", () => {
    const r = verifyCheck(before, { ...before, value: 0.32, evidence: "6 of 19" });
    expect(r.outcome).toBe("holds");
  });

  it("admits it cannot tell when the check no longer measures anything", () => {
    expect(verifyCheck(before, undefined).outcome).toBe("unverifiable");
    expect(verifyCheck(before, { ...before, value: null }).outcome).toBe("unverifiable");
  });

  it("reads the right direction for a check that fires above its threshold", () => {
    const above: CheckResult = { ...before, id: "late-eating-frequent", direction: "above", value: 0.8, threshold: 0.5 };
    expect(verifyCheck(above, { ...above, value: 0.55 }).outcome).toBe("eased");
    expect(verifyCheck(above, { ...above, value: 0.82 }).outcome).toBe("holds");
  });

  it("will not compare across a change in what the check measures", () => {
    // A profile saved before low-variety became a distinct-dish count holds a
    // repeat rate. Comparing 0.72 against 5 dishes would be noise.
    const oldForm: CheckResult = { ...before, id: "low-variety", direction: "above", value: 0.72, threshold: 0.5 };
    const newForm: CheckResult = { ...before, id: "low-variety", direction: "below", value: 5, threshold: 8 };
    expect(verifyCheck(oldForm, newForm).outcome).toBe("unverifiable");
  });
});
