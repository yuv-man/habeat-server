/**
 * Summary → the computed half of the living profile.
 *
 * Everything here is arithmetic on the behavioural summary. It runs whether or
 * not the analyst LLM is reachable, which means the weekly planner always has
 * something real to work from: if the model is down, the plan still adapts to
 * the user's adherence, prep-time tolerance and hard days — it just loses the
 * prose explaining why.
 *
 * The directives produced here are the floor. The analyst can add to them and
 * can raise a flag this file left down, but its output is validated against the
 * same summary before anything reaches the planner.
 */

import { BehaviorSummary } from "./behavior-summary.types";
import { IPlanningDirectives, ProfileConfidence } from "./behavior-profile.model";
import { CheckResult, checkById, runChecks } from "./behavior-checks";
import { MEAL_SLOTS } from "../utils/eating-episodes";

/** A day-of-week needs this many planned meals before it can be called hard.
 *  Thresholds for everything else live with their check in behavior-checks.ts. */
export const MIN_DAY_EVIDENCE = 3;

export interface ComputedProfile {
  confidence: ProfileConfidence;
  /** Every check and its verdict, fired or not — the snapshot a later run
   *  compares against to say whether a claim still holds. */
  checks: CheckResult[];
  dataSnapshot: {
    periodDays: number;
    daysWithData: number;
    mealsLogged: number;
    moodCheckIns: number;
    plannedMeals: number;
  };
  behavior: {
    breakfastAdherence: number | null;
    lunchAdherence: number | null;
    dinnerAdherence: number | null;
    snacksAdherence: number | null;
    overallAdherence: number | null;
    weekdayAdherence: number | null;
    weekendAdherence: number | null;
    prefersQuickMeals: number | null;
    varietyTolerance: number | null;
    waterConsistency: number | null;
    exerciseAdherence: number | null;
  };
  context: {
    busyDays: number[];
    lowMotivationDays: number[];
    lateEatingRate: number | null;
    stressCorrelatedWithSnacking: number | null;
    lowMoodAdherenceDrop: number | null;
    typicalMealTimes: Record<string, string>;
  };
  preferences: {
    favoriteMeals: string[];
    avoidMeals: string[];
    favoriteCategories: string[];
    effectiveMaxPrepMinutes: number | null;
  };
  planningDirectives: IPlanningDirectives;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How firmly anything here can be stated.
 *
 * Deliberately strict at the bottom: with under a week of data the honest
 * answer is "not enough yet", and a profile that says so is more useful than
 * one that guesses and gets acted on by the planner.
 */
export const deriveConfidence = (summary: BehaviorSummary): ProfileConfidence => {
  const days = summary.period.daysWithAnyData;
  const planned = summary.adherence.plannedMeals;

  if (days < 5 || planned < 10) return "insufficient";
  if (days < 10 || planned < 25) return "low";
  if (days < 20 || planned < 50) return "medium";
  return "high";
};

/**
 * How much this user's follow-through depends on a meal being quick.
 *
 * Reads the gap between what they skipped and what they made: if the meals
 * that didn't happen took materially longer, cooking time is the friction.
 * Null when prep times are missing or the two groups are the same size — no
 * gap is not evidence of indifference.
 */
export const derivePrefersQuickMeals = (summary: BehaviorSummary): number | null => {
  const { avgCompleted, avgSkipped } = summary.prepTime;
  if (avgCompleted === null || avgSkipped === null) return null;
  if (summary.adherence.skipped < 2) return null;

  const gap = avgSkipped - avgCompleted;
  // A 20-minute gap is a strong signal; scale linearly to that and clamp.
  return round2(clamp01(gap / 20));
};

/** Days of the week where the user follows the plan markedly less than usual. */
export const deriveHardDays = (summary: BehaviorSummary): number[] => {
  const overall = summary.adherence.completionRate.value;
  if (overall === null) return [];

  return Object.entries(summary.adherence.byDayOfWeek)
    .filter(([, r]) => r.of >= MIN_DAY_EVIDENCE && r.value !== null)
    .filter(([, r]) => (r.value as number) <= overall - 0.2)
    .sort((a, b) => (a[1].value as number) - (b[1].value as number))
    .slice(0, 3)
    .map(([dow]) => Number(dow));
};

/** Days of the week the user consistently reports feeling worse on. */
export const deriveLowMotivationDays = (summary: BehaviorSummary): number[] => {
  const overall = summary.wellness.avgMood;
  if (overall === null) return [];

  return Object.entries(summary.wellness.byDayOfWeek)
    .filter(([, d]) => d.checkIns >= 2 && d.avgMood !== null)
    .filter(([, d]) => (d.avgMood as number) <= overall - 0.5)
    .sort((a, b) => (a[1].avgMood as number) - (b[1].avgMood as number))
    .slice(0, 3)
    .map(([dow]) => Number(dow));
};

/**
 * How much more the user snacks on days they report stress, tiredness or a low
 * mood. Expressed 0–1 rather than as a raw ratio so it reads as a strength of
 * association, and null whenever either side of the comparison is missing.
 */
export const deriveStressSnackingLink = (summary: BehaviorSummary): number | null => {
  const { snacksPerHardDay, snacksPerOtherDay } = summary.foodAndFeeling;
  if (snacksPerHardDay === null || snacksPerOtherDay === null) return null;
  if (snacksPerOtherDay === 0) return snacksPerHardDay > 0 ? 1 : 0;
  return round2(clamp01((snacksPerHardDay / snacksPerOtherDay - 1) / 1.5));
};

/**
 * The prep ceiling this user actually respects.
 *
 * Anchored on what they finished rather than on what they were given, then
 * given a little headroom so the planner isn't forced into five-minute meals.
 * Only claimed when enough completed meals carry a prep time to mean anything.
 */
export const deriveEffectiveMaxPrep = (summary: BehaviorSummary): number | null => {
  const { avgCompleted } = summary.prepTime;
  if (avgCompleted === null || summary.adherence.completed < 5) return null;
  const ceiling = Math.round((avgCompleted + 10) / 5) * 5;
  return Math.max(15, Math.min(45, ceiling));
};

export const deriveProfile = (summary: BehaviorSummary): ComputedProfile => {
  const confidence = deriveConfidence(summary);
  const checks = runChecks(summary);

  const slotRate = (slot: (typeof MEAL_SLOTS)[number]) =>
    summary.adherence.bySlot[slot]?.value ?? null;

  const busyDays = deriveHardDays(summary);
  const lowMotivationDays = deriveLowMotivationDays(summary);
  const prefersQuickMeals = derivePrefersQuickMeals(summary);
  const effectiveMaxPrepMinutes = deriveEffectiveMaxPrep(summary);

  const lowMoodDrop =
    summary.foodAndFeeling.adherenceOnOtherDays.value !== null &&
    summary.foodAndFeeling.adherenceOnLowMoodDays.value !== null &&
    summary.foodAndFeeling.adherenceOnLowMoodDays.of >= MIN_DAY_EVIDENCE
      ? round2(
          summary.foodAndFeeling.adherenceOnOtherDays.value -
            summary.foodAndFeeling.adherenceOnLowMoodDays.value,
        )
      : null;

  // ── directives, raised only by checks that actually fired ─────────────────
  // Every flag below traces to a named predicate in behavior-checks.ts with its
  // own threshold and minimum evidence. Nothing here can fire on a hunch, and
  // a profile with too little data raises none of them.
  const enoughToAct = confidence !== "insufficient";
  const fired = (id: string) =>
    enoughToAct && (checkById(checks, id)?.fired ?? false);

  // A slot is only "make it simpler" when it is both being missed *and* the
  // ones being missed are the slower ones. Adherence alone says a meal isn't
  // happening; it doesn't say cooking time is the reason.
  const simplifySlots = (["breakfast", "lunch", "dinner"] as const).filter(
    (slot) => fired(`${slot}-adherence-low`) && fired(`${slot}-too-slow`),
  );

  // Swapped repeatedly rather than skipped: the meal happens, just not the one
  // that was planned. That wants flexibility, not simplification.
  const flexibleSlots = fired("frequent-replacement")
    ? (["breakfast", "lunch", "dinner"] as const).filter(
        (slot) => !simplifySlots.includes(slot) && (slotRate(slot) ?? 1) < 0.8,
      )
    : [];

  const weekendNeedsOwnShape = fired("weekend-gap");
  const reduceLateEating = fired("late-eating-frequent");
  const increaseVariety = fired("low-variety");

  return {
    confidence,
    checks,
    dataSnapshot: {
      periodDays: summary.period.days,
      daysWithData: summary.period.daysWithAnyData,
      mealsLogged: summary.meals.totalLogged,
      moodCheckIns: summary.wellness.checkIns,
      plannedMeals: summary.adherence.plannedMeals,
    },
    behavior: {
      breakfastAdherence: slotRate("breakfast"),
      lunchAdherence: slotRate("lunch"),
      dinnerAdherence: slotRate("dinner"),
      snacksAdherence: slotRate("snacks"),
      overallAdherence: summary.adherence.completionRate.value,
      weekdayAdherence: summary.adherence.weekday.value,
      weekendAdherence: summary.adherence.weekend.value,
      prefersQuickMeals,
      // How much variety the user actually sustains: 1 means every meal was
      // different, 0 means the same handful over and over.
      varietyTolerance:
        summary.variety.repeatRate === null ? null : round2(1 - summary.variety.repeatRate),
      waterConsistency: summary.water.consistency.value,
      exerciseAdherence: summary.exercise.completionRate.value,
    },
    context: {
      busyDays,
      lowMotivationDays,
      lateEatingRate: summary.timing.lateEatingRate.value,
      stressCorrelatedWithSnacking: deriveStressSnackingLink(summary),
      lowMoodAdherenceDrop: lowMoodDrop,
      typicalMealTimes: { ...summary.timing.average },
    },
    preferences: {
      favoriteMeals: summary.preferences.favoriteMeals.map((m) => m.name),
      avoidMeals: summary.preferences.swappedAwayFrom
        .filter((m) => m.count >= 2)
        .map((m) => m.name),
      favoriteCategories: summary.preferences.favoriteCategories.map((c) => c.cuisine),
      effectiveMaxPrepMinutes,
    },
    planningDirectives: {
      maxPrepMinutes: effectiveMaxPrepMinutes,
      simplifySlots: [...simplifySlots],
      flexibleSlots: [...flexibleSlots],
      weekendNeedsOwnShape,
      increaseVariety,
      reduceLateEating,
      emphasiseMacro: fired("macro-short") ? summary.nutrition.macroWeakness : null,
      notes: [],
    },
  };
};
