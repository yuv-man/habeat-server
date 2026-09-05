/**
 * The checks — every claim this system is allowed to make, as code.
 *
 * A check is a named predicate over the behavioural summary with an explicit
 * threshold and the evidence behind it. Nothing else in the pipeline is
 * permitted to assert a pattern: the derivation raises directives from fired
 * checks, and the analyst may only write prose about a check that actually
 * fired. A pattern with no check behind it is dropped.
 *
 * That is what makes the system testable against itself, in two directions:
 *
 *  - **At write time** — a model claim citing a check that did not fire cannot
 *    be stored. The model explains findings; it does not get to invent them.
 *  - **Over time** — the fired checks and their values are snapshotted onto the
 *    profile, so a later run re-runs the same predicates and can say whether
 *    each claim still holds, eased, or has gone. See `verifyProfile`.
 *
 * Adding a claim to the product means adding a check here, with a threshold
 * someone can argue with, rather than a sentence in a prompt.
 */

import { BehaviorSummary, MealSlot, Rate } from "./behavior-summary.types";

export type CheckArea =
  | "breakfast" | "lunch" | "dinner" | "snacks"
  | "timing" | "variety" | "hydration" | "exercise"
  | "wellbeing" | "planning" | "nutrition";

export interface CheckResult {
  id: string;
  area: CheckArea;
  /** Plain description of what fired, for the analyst and for logs. */
  label: string;
  fired: boolean;
  /** The measured quantity, or null when it could not be measured at all. */
  value: number | null;
  /** What `value` had to beat. */
  threshold: number;
  /** Which side of the threshold counts as firing. */
  direction: "below" | "above";
  /** How many observations `value` rests on. A check never fires under its
   *  minimum basis — that is the "not on one occurrence" rule, in code. */
  basis: number;
  minBasis: number;
  /** The figures, phrased for a human. */
  evidence: string;
}

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snacks"];

/** Minimum observations before any check may fire. */
export const MIN_BASIS = 3;

const check = (
  id: string,
  area: CheckArea,
  label: string,
  rate: { value: number | null; basis: number },
  threshold: number,
  direction: "below" | "above",
  evidence: string,
  minBasis: number = MIN_BASIS,
): CheckResult => {
  const { value, basis } = rate;
  const fired =
    value !== null &&
    basis >= minBasis &&
    (direction === "below" ? value < threshold : value > threshold);

  return { id, area, label, fired, value, threshold, direction, basis, minBasis, evidence };
};

const pct = (v: number | null): string => (v === null ? "unknown" : `${Math.round(v * 100)}%`);

const fromRate = (r: Rate) => ({ value: r.value, basis: r.of });

/**
 * Run every check against a summary.
 *
 * Always returns the full list, fired or not: a check that did not fire is the
 * evidence that a claim was considered and rejected, and it is what a later
 * verification compares against.
 */
export const runChecks = (summary: BehaviorSummary): CheckResult[] => {
  const results: CheckResult[] = [];

  // ── adherence, per slot ──────────────────────────────────────────────────
  SLOTS.forEach((slot) => {
    const r = summary.adherence.bySlot[slot];
    results.push(
      check(
        `${slot}-adherence-low`,
        slot,
        `${slot} is logged far less often than it is planned`,
        fromRate(r),
        0.6,
        "below",
        `${r.hits} of ${r.of} planned ${slot} meals were logged (${pct(r.value)})`,
      ),
    );

    // Only meaningful alongside the adherence check: it says *why* the meal
    // isn't happening, which decides whether simplifying it would help.
    //
    // The baseline is the same slot's completed meals where there are any, and
    // otherwise everything the user does finish. A slot that is *never* eaten
    // has no within-slot baseline, and that is exactly the case this check most
    // needs to catch — a 40-minute breakfast nobody has ever made, next to a
    // day of 12-minute meals they always do.
    const prep = summary.prepTime.bySlot[slot];
    const baseline = prep.avgCompleted ?? summary.prepTime.avgCompleted;
    const gap =
      prep.avgSkipped !== null && baseline !== null ? prep.avgSkipped - baseline : null;
    results.push(
      check(
        `${slot}-too-slow`,
        slot,
        `the ${slot} meals that don't happen take longer to make than the ones that do`,
        { value: gap, basis: r.of },
        5,
        "above",
        gap === null
          ? `no prep-time comparison available for ${slot}`
          : `skipped ${slot} averaged ${prep.avgSkipped} min against ${baseline} min for the meals this user does make`,
      ),
    );
  });

  results.push(
    check(
      "overall-adherence-low",
      "planning",
      "the plan as a whole is followed less than half the time",
      fromRate(summary.adherence.completionRate),
      0.6,
      "below",
      `${summary.adherence.completed} of ${summary.adherence.plannedMeals} planned meals logged (${pct(summary.adherence.completionRate.value)})`,
      10,
    ),
  );

  // ── weekday vs weekend ───────────────────────────────────────────────────
  results.push(
    check(
      "weekend-gap",
      "planning",
      "weekends run to a different shape from weekdays",
      {
        value: summary.adherence.weekendDelta,
        basis: summary.adherence.weekend.of,
      },
      -0.2,
      "below",
      `weekend adherence ${pct(summary.adherence.weekend.value)} against ${pct(summary.adherence.weekday.value)} on weekdays`,
    ),
  );

  // ── timing ───────────────────────────────────────────────────────────────
  results.push(
    check(
      "late-eating-frequent",
      "timing",
      "eating regularly runs past 9pm",
      fromRate(summary.timing.lateEatingRate),
      0.4,
      "above",
      `${summary.timing.lateEatingDays} of ${summary.timing.lateEatingRate.of} days with a timed meal included one at 9pm or later`,
    ),
  );

  // ── replacement ──────────────────────────────────────────────────────────
  results.push(
    check(
      "frequent-replacement",
      "planning",
      "planned meals are often swapped for something else",
      { value: summary.adherence.replaced, basis: summary.adherence.plannedMeals },
      3,
      "above",
      `${summary.adherence.replaced} planned meals were replaced during this period`,
      10,
    ),
  );

  // ── variety ──────────────────────────────────────────────────────────────
  results.push(
    check(
      "low-variety",
      "variety",
      "the same few dishes come round repeatedly",
      { value: summary.variety.repeatRate, basis: summary.variety.totalMeals },
      0.5,
      "above",
      `${summary.variety.distinctMeals} distinct dishes across ${summary.variety.totalMeals} logged meals`,
      10,
    ),
  );

  // ── nutrition ────────────────────────────────────────────────────────────
  const macroShort = summary.nutrition.macroWeakness;
  results.push({
    id: "macro-short",
    area: "nutrition",
    label: macroShort
      ? `${macroShort} lands consistently below its own target`
      : "no macro is consistently short",
    fired: macroShort !== null && summary.nutrition.daysWithNutritionData >= MIN_BASIS,
    value: macroShort ? 1 : 0,
    threshold: 1,
    direction: "above",
    basis: summary.nutrition.daysWithNutritionData,
    minBasis: MIN_BASIS,
    evidence: macroShort
      ? `average ${macroShort} intake sits under target across ${summary.nutrition.daysWithNutritionData} days`
      : "macros track close enough to target",
  });

  const calorieRatio =
    summary.nutrition.avgCaloriesConsumed !== null &&
    summary.nutrition.avgCalorieGoal !== null &&
    summary.nutrition.avgCalorieGoal > 0
      ? summary.nutrition.avgCaloriesConsumed / summary.nutrition.avgCalorieGoal
      : null;

  results.push(
    check(
      "calories-under-target",
      "nutrition",
      "logged intake sits well under the daily target",
      { value: calorieRatio, basis: summary.nutrition.daysWithNutritionData },
      0.85,
      "below",
      calorieRatio === null
        ? "no calorie data logged"
        : `averaging ${summary.nutrition.avgCaloriesConsumed} kcal against a ${summary.nutrition.avgCalorieGoal} kcal target`,
    ),
  );

  // ── hydration ────────────────────────────────────────────────────────────
  results.push(
    check(
      "water-inconsistent",
      "hydration",
      "the water goal is met on a minority of days",
      fromRate(summary.water.consistency),
      0.5,
      "below",
      `hit the water goal on ${summary.water.daysMetGoal} of ${summary.water.consistency.of} days`,
      5,
    ),
  );

  // ── exercise ─────────────────────────────────────────────────────────────
  results.push(
    check(
      "exercise-adherence-low",
      "exercise",
      "planned sessions are more often missed than done",
      fromRate(summary.exercise.completionRate),
      0.5,
      "below",
      `${summary.exercise.sessionsCompleted} of ${summary.exercise.sessionsPlanned} planned sessions completed`,
    ),
  );

  // ── the feeling ↔ food links ─────────────────────────────────────────────
  const { foodAndFeeling } = summary;

  const snackLift =
    foodAndFeeling.snacksPerHardDay !== null && foodAndFeeling.snacksPerOtherDay !== null
      ? foodAndFeeling.snacksPerHardDay - foodAndFeeling.snacksPerOtherDay
      : null;
  results.push(
    check(
      "stress-snacking",
      "wellbeing",
      "snacking rises on days reported as stressed, tired or low",
      { value: snackLift, basis: summary.wellness.daysWithCheckIn },
      0.5,
      "above",
      snackLift === null
        ? "not enough check-ins beside logged meals to compare"
        : `${foodAndFeeling.snacksPerHardDay} snacks per hard day against ${foodAndFeeling.snacksPerOtherDay} on other days`,
    ),
  );

  const moodDrop =
    foodAndFeeling.adherenceOnOtherDays.value !== null &&
    foodAndFeeling.adherenceOnLowMoodDays.value !== null
      ? foodAndFeeling.adherenceOnOtherDays.value - foodAndFeeling.adherenceOnLowMoodDays.value
      : null;
  results.push(
    check(
      "low-mood-adherence-drop",
      "wellbeing",
      "the plan gets followed less on days reported as low",
      { value: moodDrop, basis: foodAndFeeling.adherenceOnLowMoodDays.of },
      0.2,
      "above",
      moodDrop === null
        ? "not enough low-mood days with planned meals to compare"
        : `${pct(foodAndFeeling.adherenceOnLowMoodDays.value)} on low days against ${pct(foodAndFeeling.adherenceOnOtherDays.value)} otherwise`,
    ),
  );

  const lateLift =
    foodAndFeeling.lateEatingOnHardDays.value !== null &&
    foodAndFeeling.lateEatingOnOtherDays.value !== null
      ? foodAndFeeling.lateEatingOnHardDays.value - foodAndFeeling.lateEatingOnOtherDays.value
      : null;
  results.push(
    check(
      "hard-day-late-eating",
      "wellbeing",
      "meals land later on days reported as hard",
      { value: lateLift, basis: foodAndFeeling.lateEatingOnHardDays.of },
      0.2,
      "above",
      lateLift === null
        ? "not enough timed meals on reported hard days to compare"
        : `${pct(foodAndFeeling.lateEatingOnHardDays.value)} of hard-day meals ran late against ${pct(foodAndFeeling.lateEatingOnOtherDays.value)} otherwise`,
    ),
  );

  results.push(
    check(
      "emotional-eating-frequent",
      "wellbeing",
      "a sizeable share of scored meals read as eaten on emotion",
      {
        value:
          foodAndFeeling.scoredEpisodes > 0
            ? foodAndFeeling.emotionalEpisodes / foodAndFeeling.scoredEpisodes
            : null,
        basis: foodAndFeeling.scoredEpisodes,
      },
      0.3,
      "above",
      `${foodAndFeeling.emotionalEpisodes} of ${foodAndFeeling.scoredEpisodes} scored meals`,
      5,
    ),
  );

  return results;
};

export const firedChecks = (checks: CheckResult[]): CheckResult[] =>
  checks.filter((c) => c.fired);

export const checkById = (checks: CheckResult[], id: string): CheckResult | undefined =>
  checks.find((c) => c.id === id);

/** How a previously fired check looks now. */
export type CheckOutcome = "holds" | "eased" | "resolved" | "unverifiable";

export interface CheckVerification {
  id: string;
  outcome: CheckOutcome;
  /** The value when the claim was made. */
  before: number | null;
  /** The value now. */
  after: number | null;
  note: string;
}

/**
 * Re-run one check's verdict against a later measurement.
 *
 * "Eased" is the interesting outcome and the reason this isn't just a boolean:
 * a check that still fires but has moved meaningfully towards its threshold is
 * a claim that is working, and the user should be told that rather than shown
 * the same finding again unchanged.
 */
export const verifyCheck = (
  before: CheckResult,
  after: CheckResult | undefined,
): CheckVerification => {
  if (!after || after.value === null || before.value === null) {
    return {
      id: before.id,
      outcome: "unverifiable",
      before: before.value ?? null,
      after: after?.value ?? null,
      note: "not enough data this time to measure it again",
    };
  }

  if (!after.fired) {
    return {
      id: before.id,
      outcome: "resolved",
      before: before.value,
      after: after.value,
      note: `no longer above the line (${after.evidence})`,
    };
  }

  // Movement towards the threshold, in the direction that counts as better.
  const improvement =
    before.direction === "below"
      ? after.value - before.value
      : before.value - after.value;
  const span = Math.max(Math.abs(before.threshold), 0.01);

  if (improvement / span >= 0.15) {
    return {
      id: before.id,
      outcome: "eased",
      before: before.value,
      after: after.value,
      note: `moving in the right direction (${after.evidence})`,
    };
  }

  return {
    id: before.id,
    outcome: "holds",
    before: before.value,
    after: after.value,
    note: after.evidence,
  };
};
