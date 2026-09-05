/**
 * Aggregation: MongoDB documents → one clean behavioural summary.
 *
 * Deliberately pure and I/O-free. Everything the analyst LLM ever sees is
 * produced here, which means every number it reasons over is one a unit test
 * can pin to a fixture. Handing a model thirty days of raw documents and
 * hoping it counts correctly is the failure mode this file exists to prevent.
 *
 * See `behavior-summary.types.ts` for the shape and the two rules it keeps:
 * absent is never zero, and coverage travels with the data.
 */

import {
  BehaviorSummary,
  MealSlot,
  Rate,
  SlotCounts,
} from "./behavior-summary.types";
import {
  extractLoggedMeals,
  extractSkippedMeals,
  timestampMoods,
  toLocalDateKey,
  MEAL_SLOTS,
} from "../utils/eating-episodes";

// ─── small helpers ──────────────────────────────────────────────────────────

const rate = (hits: number, of: number): Rate => ({
  value: of > 0 ? Math.round((hits / of) * 100) / 100 : null,
  hits,
  of,
});

const mean = (values: number[], dp = 1): number | null => {
  if (values.length === 0) return null;
  const f = 10 ** dp;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * f) / f;
};

const emptySlots = (): SlotCounts => ({ breakfast: 0, lunch: 0, dinner: 0, snacks: 0 });

/** Minutes past midnight → "HH:MM". */
const asClock = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const dayOfWeek = (dateKey: string): number => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

const isWeekend = (dateKey: string): boolean => {
  const dow = dayOfWeek(dateKey);
  return dow === 0 || dow === 6;
};

/** Anything eaten at or after this hour counts as late. */
export const LATE_EATING_HOUR = 21;

/** A mood at or below this level is a low-mood day. Mood is 1–5. */
export const LOW_MOOD_LEVEL = 2;

/** Feelings that make eating to plan harder — the "hard day" set. */
export const HARD_DAY_MOODS = ["stressed", "anxious", "sad", "tired", "angry"];

// ─── inputs ─────────────────────────────────────────────────────────────────

export interface ProgressDocLike {
  dateKey?: string;
  caloriesConsumed?: number;
  caloriesGoal?: number;
  protein?: { consumed?: number; goal?: number };
  carbs?: { consumed?: number; goal?: number };
  fat?: { consumed?: number; goal?: number };
  water?: { consumed?: number; goal?: number };
  workouts?: { name?: string; done?: boolean }[];
  meals?: Record<string, any>;
}

export interface MoodDocLike {
  date?: string;
  time?: string;
  moodLevel: number;
  moodCategory: string;
  energyLevel?: number;
  stressLevel?: number;
  triggers?: string[];
  reflection?: { easedBy?: string[]; hinderedBy?: string[] };
}

export interface SummaryInput {
  periodDays: number;
  /** Today, local. Days at or after this are still in progress. */
  todayKey: string;
  startKey: string;
  progressDocs: ProgressDocLike[];
  moods: MoodDocLike[];
  user: {
    path?: string;
    weight?: number;
    targetWeight?: number;
    mealsPerDay?: number;
    fastingHours?: number;
    dislikes?: string[];
    dietaryRestrictions?: string[];
    allergies?: string[];
    mealLearningProfile?: {
      completedMeals?: { name: string; count: number }[];
      swappedMeals?: { name: string; count: number }[];
      recentSwaps?: { name: string; at: Date | string }[];
      cuisineScores?: Record<string, number> | Map<string, number>;
    };
  } | null;
  goals: { title: string; current?: number; target: number; unit: string }[];
  /** Scored eating episodes from the emotional-eating pipeline, if available. */
  episodes?: {
    date: string;
    mealType: MealSlot;
    score: number | null;
    emotional: boolean;
    moodCategory: string | null;
  }[];
}

// ─── the aggregation ────────────────────────────────────────────────────────

export const buildBehaviorSummary = (input: SummaryInput): BehaviorSummary => {
  const { periodDays, todayKey, startKey, progressDocs, moods, user, goals } = input;

  const docs = progressDocs.filter((d): d is ProgressDocLike & { dateKey: string } =>
    Boolean(d.dateKey)
  );
  /** Days that are over. Today's untouched meals are not skips, and today's
   *  half-finished macros would drag every average down. */
  const closedDocs = docs.filter((d) => d.dateKey < todayKey);

  const loggedMeals = extractLoggedMeals(docs as any[]);
  const skippedMeals = extractSkippedMeals(docs as any[], todayKey);
  const timedMoods = timestampMoods(moods);

  // ── meals ────────────────────────────────────────────────────────────────
  const loggedBySlot = emptySlots();
  loggedMeals.forEach((m) => loggedBySlot[m.mealType]++);

  const mealDays = new Set(loggedMeals.map((m) => m.date));
  const fullDays = [...mealDays].filter((day) => {
    const slots = new Set(
      loggedMeals.filter((m) => m.date === day).map((m) => m.mealType)
    );
    return slots.has("breakfast") && slots.has("lunch") && slots.has("dinner");
  }).length;

  // ── timing ───────────────────────────────────────────────────────────────
  const timedMeals = loggedMeals.filter((m) => m.atIsExact);
  const timingAverage: Partial<Record<MealSlot, string>> = {};
  const timingBasis = emptySlots();
  MEAL_SLOTS.forEach((slot) => {
    const slotMeals = timedMeals.filter((m) => m.mealType === slot);
    timingBasis[slot] = slotMeals.length;
    const avg = mean(
      slotMeals.map((m) => m.at.getHours() * 60 + m.at.getMinutes()),
      0
    );
    if (avg !== null) timingAverage[slot] = asClock(avg);
  });

  const lateMeals = timedMeals.filter((m) => m.at.getHours() >= LATE_EATING_HOUR);
  const lateDays = new Set(lateMeals.map((m) => m.date));
  const daysWithTimedMeals = new Set(timedMeals.map((m) => m.date));

  // ── adherence ────────────────────────────────────────────────────────────
  // Everything on a closed day's plan either happened or didn't. Progress docs
  // carry the plan for that day, so they are the only denominator that can't
  // drift when the weekly plan is regenerated on top of itself.
  const closedLogged = loggedMeals.filter((m) => m.date < todayKey);
  const planned = closedLogged.length + skippedMeals.length;

  const slotAdherence = {} as Record<MealSlot, Rate>;
  MEAL_SLOTS.forEach((slot) => {
    const done = closedLogged.filter((m) => m.mealType === slot).length;
    const missed = skippedMeals.filter((s) => s.mealType === slot).length;
    slotAdherence[slot] = rate(done, done + missed);
  });

  const weekdayDone = closedLogged.filter((m) => !isWeekend(m.date)).length;
  const weekdayMissed = skippedMeals.filter((s) => !isWeekend(s.date)).length;
  const weekendDone = closedLogged.filter((m) => isWeekend(m.date)).length;
  const weekendMissed = skippedMeals.filter((s) => isWeekend(s.date)).length;
  const weekday = rate(weekdayDone, weekdayDone + weekdayMissed);
  const weekend = rate(weekendDone, weekendDone + weekendMissed);

  const byDayOfWeek: Record<number, Rate> = {};
  for (let dow = 0; dow < 7; dow++) {
    const done = closedLogged.filter((m) => dayOfWeek(m.date) === dow).length;
    const missed = skippedMeals.filter((s) => dayOfWeek(s.date) === dow).length;
    byDayOfWeek[dow] = rate(done, done + missed);
  }

  // ── nutrition ────────────────────────────────────────────────────────────
  const nutritionDocs = closedDocs.filter((d) => (d.caloriesConsumed ?? 0) > 0);
  const avgCalories = mean(nutritionDocs.map((d) => d.caloriesConsumed ?? 0), 0);
  const avgCalorieGoal = mean(
    nutritionDocs.filter((d) => (d.caloriesGoal ?? 0) > 0).map((d) => d.caloriesGoal!),
    0
  );
  const calorieAccuracy =
    avgCalories !== null && avgCalorieGoal !== null && avgCalorieGoal > 0
      ? avgCalories < avgCalorieGoal * 0.9
        ? ("under" as const)
        : avgCalories > avgCalorieGoal * 1.1
          ? ("over" as const)
          : ("on-target" as const)
      : null;

  const avgProtein = mean(nutritionDocs.map((d) => d.protein?.consumed ?? 0), 0);
  const proteinGoal = mean(
    nutritionDocs.filter((d) => (d.protein?.goal ?? 0) > 0).map((d) => d.protein!.goal!),
    0
  );
  const avgCarbs = mean(nutritionDocs.map((d) => d.carbs?.consumed ?? 0), 0);
  const avgFat = mean(nutritionDocs.map((d) => d.fat?.consumed ?? 0), 0);

  // Which macro sits furthest below its own goal. Only claimed when goals exist.
  const macroGaps = (["protein", "carbs", "fat"] as const)
    .map((macro) => {
      const withGoal = nutritionDocs.filter((d) => ((d as any)[macro]?.goal ?? 0) > 0);
      if (withGoal.length === 0) return null;
      const consumed = mean(withGoal.map((d) => (d as any)[macro].consumed ?? 0), 1)!;
      const goal = mean(withGoal.map((d) => (d as any)[macro].goal), 1)!;
      return { macro, ratio: goal > 0 ? consumed / goal : 1 };
    })
    .filter((x): x is { macro: "protein" | "carbs" | "fat"; ratio: number } => x !== null)
    .sort((a, b) => a.ratio - b.ratio);
  const macroWeakness =
    macroGaps.length > 0 && macroGaps[0].ratio < 0.85 ? macroGaps[0].macro : null;

  // ── water ────────────────────────────────────────────────────────────────
  const waterDocs = closedDocs.filter((d) => d.water?.goal != null);
  const avgGlasses = mean(waterDocs.map((d) => d.water?.consumed ?? 0), 1);
  const waterGoal = mean(waterDocs.map((d) => d.water?.goal ?? 0), 0);
  const daysMetWater = waterDocs.filter(
    (d) => (d.water?.consumed ?? 0) >= (d.water?.goal ?? Infinity)
  ).length;

  // ── exercise ─────────────────────────────────────────────────────────────
  const allWorkouts = closedDocs.flatMap((d) =>
    (d.workouts ?? []).map((w) => ({ ...w, dateKey: d.dateKey }))
  );
  const doneWorkouts = allWorkouts.filter((w) => w.done);
  const workoutDays = new Set(doneWorkouts.map((w) => w.dateKey));

  const onWorkoutDone = closedLogged.filter((m) => workoutDays.has(m.date)).length;
  const onWorkoutMissed = skippedMeals.filter((s) => workoutDays.has(s.date)).length;
  const onRestDone = closedLogged.filter((m) => !workoutDays.has(m.date)).length;
  const onRestMissed = skippedMeals.filter((s) => !workoutDays.has(s.date)).length;

  // ── variety ──────────────────────────────────────────────────────────────
  const nameCounts = new Map<string, number>();
  loggedMeals.forEach((m) => {
    const key = m.mealName.trim().toLowerCase();
    if (!key) return;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  });
  const namedTotal = [...nameCounts.values()].reduce((s, n) => s + n, 0);
  const repeats = [...nameCounts.values()].reduce((s, n) => s + (n - 1), 0);
  const mostRepeated = [...nameCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // ── prep time ────────────────────────────────────────────────────────────
  const prepOf = (doc: ProgressDocLike, slot: MealSlot, wantDone: boolean): number[] => {
    const snapshot = doc.meals?.[slot];
    const list = slot === "snacks" ? (snapshot ?? []) : snapshot ? [snapshot] : [];
    return (list as any[])
      .filter((m) => m?.name && Boolean(m.done) === wantDone && typeof m.prepTime === "number")
      .map((m) => m.prepTime as number);
  };

  const completedPrep: number[] = [];
  const skippedPrep: number[] = [];
  const prepBySlot = {} as Record<MealSlot, { avgCompleted: number | null; avgSkipped: number | null }>;
  MEAL_SLOTS.forEach((slot) => {
    const done = closedDocs.flatMap((d) => prepOf(d, slot, true));
    const missed = closedDocs.flatMap((d) => prepOf(d, slot, false));
    completedPrep.push(...done);
    skippedPrep.push(...missed);
    prepBySlot[slot] = { avgCompleted: mean(done, 0), avgSkipped: mean(missed, 0) };
  });
  const avgCompletedPrep = mean(completedPrep, 0);
  const avgSkippedPrep = mean(skippedPrep, 0);

  // ── preferences ──────────────────────────────────────────────────────────
  const learning = user?.mealLearningProfile ?? {};

  // Swaps inside the window. Older installs have swap counts but no dates, so
  // this counts what it can and `replacedTotal` carries the rest — better than
  // reporting a lifetime total as if it happened this month.
  const replacedInPeriod = (learning.recentSwaps ?? []).filter((swap) => {
    if (!swap?.at) return false;
    const key = toLocalDateKey(new Date(swap.at));
    return key >= startKey && key <= todayKey;
  }).length;
  const cuisineScores =
    learning.cuisineScores instanceof Map
      ? Object.fromEntries(learning.cuisineScores)
      : (learning.cuisineScores ?? {});

  // ── wellness ─────────────────────────────────────────────────────────────
  const moodDays = new Set(moods.map((m) => m.date).filter(Boolean) as string[]);
  const triggerCounts = new Map<string, number>();
  const easedCounts = new Map<string, number>();
  const hinderedCounts = new Map<string, number>();
  moods.forEach((m) => {
    m.triggers?.forEach((t) => triggerCounts.set(t, (triggerCounts.get(t) ?? 0) + 1));
    m.reflection?.easedBy?.forEach((f) => easedCounts.set(f, (easedCounts.get(f) ?? 0) + 1));
    m.reflection?.hinderedBy?.forEach((t) =>
      hinderedCounts.set(t, (hinderedCounts.get(t) ?? 0) + 1)
    );
  });

  const topN = (counts: Map<string, number>, n: number) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  const moodByDow: Record<number, { checkIns: number; avgMood: number | null }> = {};
  for (let dow = 0; dow < 7; dow++) {
    const entries = moods.filter((m) => m.date && dayOfWeek(m.date) === dow);
    moodByDow[dow] = {
      checkIns: entries.length,
      avgMood: mean(entries.map((m) => m.moodLevel)),
    };
  }

  /** Days carrying a feeling that tends to make eating to plan harder. */
  const hardDays = new Set(
    moods
      .filter(
        (m) =>
          m.date &&
          (HARD_DAY_MOODS.includes(m.moodCategory) || m.moodLevel <= LOW_MOOD_LEVEL)
      )
      .map((m) => m.date!)
  );
  const lowMoodDays = new Set(
    moods.filter((m) => m.date && m.moodLevel <= LOW_MOOD_LEVEL).map((m) => m.date!)
  );

  // ── food × feeling ───────────────────────────────────────────────────────
  const episodes = input.episodes ?? [];
  const scored = episodes.filter((e) => e.score !== null);
  const emotionCounts = new Map<string, number>();
  episodes.forEach((e) => {
    if (!e.moodCategory) return;
    emotionCounts.set(e.moodCategory, (emotionCounts.get(e.moodCategory) ?? 0) + 1);
  });

  const lowMoodDone = closedLogged.filter((m) => lowMoodDays.has(m.date)).length;
  const lowMoodMissed = skippedMeals.filter((s) => lowMoodDays.has(s.date)).length;
  const otherDone = closedLogged.filter((m) => !lowMoodDays.has(m.date)).length;
  const otherMissed = skippedMeals.filter((s) => !lowMoodDays.has(s.date)).length;

  const hardTimed = timedMeals.filter((m) => hardDays.has(m.date));
  const easyTimed = timedMeals.filter((m) => !hardDays.has(m.date));

  const snacksOnHardDays = loggedMeals.filter(
    (m) => m.mealType === "snacks" && hardDays.has(m.date)
  ).length;
  const snacksOnOtherDays = loggedMeals.filter(
    (m) => m.mealType === "snacks" && !hardDays.has(m.date)
  ).length;
  const hardDaysWithData = [...hardDays].filter((d) => mealDays.has(d)).length;
  const otherDaysWithData = [...mealDays].filter((d) => !hardDays.has(d)).length;

  const mindfulScore =
    scored.length > 0
      ? 100 -
        Math.round(
          (scored.reduce((s, e) => s + (e.score ?? 0), 0) / scored.length) * 100
        )
      : null;

  return {
    period: {
      days: periodDays,
      start: startKey,
      end: todayKey,
      daysWithAnyData: new Set([...mealDays, ...moodDays]).size,
    },

    goal: {
      path: user?.path ?? null,
      targetWeight: user?.targetWeight ?? null,
      currentWeight: user?.weight ?? null,
      activeGoals: goals.slice(0, 5).map((g) => ({
        title: g.title,
        current: g.current ?? 0,
        target: g.target,
        unit: g.unit,
      })),
      mealsPerDay: user?.mealsPerDay ?? null,
      fastingHours: user?.fastingHours ?? null,
    },

    meals: {
      logged: loggedBySlot,
      totalLogged: loggedMeals.length,
      averagePerDay:
        mealDays.size > 0 ? Math.round((loggedMeals.length / mealDays.size) * 10) / 10 : null,
      daysWithAnyMeal: mealDays.size,
      daysWithFullDay: fullDays,
    },

    timing: {
      average: timingAverage,
      basis: timingBasis,
      latestMealHour:
        timedMeals.length > 0
          ? Math.max(...timedMeals.map((m) => m.at.getHours()))
          : null,
      lateEatingDays: lateDays.size,
      lateEatingRate: rate(lateDays.size, daysWithTimedMeals.size),
    },

    adherence: {
      plannedMeals: planned,
      completed: closedLogged.length,
      skipped: skippedMeals.length,
      replaced: replacedInPeriod,
      replacedTotal: (learning.swappedMeals ?? []).reduce(
        (s, m) => s + (m.count ?? 0),
        0
      ),
      completionRate: rate(closedLogged.length, planned),
      bySlot: slotAdherence,
      weekday,
      weekend,
      weekendDelta:
        weekend.value !== null && weekday.value !== null
          ? Math.round((weekend.value - weekday.value) * 100) / 100
          : null,
      byDayOfWeek,
    },

    nutrition: {
      avgCaloriesConsumed: avgCalories,
      avgCalorieGoal,
      calorieAccuracy,
      avgProtein,
      proteinGoal,
      avgCarbs,
      avgFat,
      macroWeakness,
      daysWithNutritionData: nutritionDocs.length,
    },

    water: {
      avgGlasses,
      goal: waterGoal,
      daysMetGoal: daysMetWater,
      consistency: rate(daysMetWater, waterDocs.length),
    },

    exercise: {
      sessionsPlanned: allWorkouts.length,
      sessionsCompleted: doneWorkouts.length,
      completionRate: rate(doneWorkouts.length, allWorkouts.length),
      daysWithWorkout: workoutDays.size,
      avgPerWeek:
        closedDocs.length > 0
          ? Math.round((doneWorkouts.length / closedDocs.length) * 7 * 10) / 10
          : null,
      mealAdherenceOnWorkoutDays: rate(onWorkoutDone, onWorkoutDone + onWorkoutMissed),
      mealAdherenceOnRestDays: rate(onRestDone, onRestDone + onRestMissed),
    },

    variety: {
      distinctMeals: nameCounts.size,
      totalMeals: namedTotal,
      repeatRate: namedTotal > 0 ? Math.round((repeats / namedTotal) * 100) / 100 : null,
      mostRepeated,
    },

    prepTime: {
      avgPlanned: mean([...completedPrep, ...skippedPrep], 0),
      avgCompleted: avgCompletedPrep,
      avgSkipped: avgSkippedPrep,
      skippedMinusCompleted:
        avgSkippedPrep !== null && avgCompletedPrep !== null
          ? avgSkippedPrep - avgCompletedPrep
          : null,
      bySlot: prepBySlot,
    },

    preferences: {
      favoriteMeals: (learning.completedMeals ?? [])
        .filter((m) => (m.count ?? 0) >= 2)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 8)
        .map((m) => ({ name: m.name, count: m.count ?? 0 })),
      swappedAwayFrom: (learning.swappedMeals ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 8)
        .map((m) => ({ name: m.name, count: m.count ?? 0 })),
      favoriteCategories: Object.entries(cuisineScores as Record<string, number>)
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cuisine, score]) => ({ cuisine, score: Math.round(score * 100) / 100 })),
      dislikes: (user?.dislikes ?? []).slice(0, 15),
      restrictions: [
        ...(user?.dietaryRestrictions ?? []),
        ...(user?.allergies ?? []),
      ].slice(0, 15),
    },

    wellness: {
      checkIns: moods.length,
      daysWithCheckIn: moodDays.size,
      avgMood: mean(moods.map((m) => m.moodLevel)),
      avgEnergy: mean(
        moods.filter((m) => m.energyLevel != null).map((m) => m.energyLevel!)
      ),
      avgStress: mean(
        moods.filter((m) => m.stressLevel != null).map((m) => m.stressLevel!)
      ),
      tiredDays: new Set(
        moods.filter((m) => m.moodCategory === "tired" && m.date).map((m) => m.date!)
      ).size,
      stressedDays: new Set(
        moods
          .filter((m) => ["stressed", "anxious"].includes(m.moodCategory) && m.date)
          .map((m) => m.date!)
      ).size,
      lowMoodDays: lowMoodDays.size,
      byDayOfWeek: moodByDow,
      topTriggers: topN(triggerCounts, 5).map(([trigger, count]) => ({ trigger, count })),
      easedBy: topN(easedCounts, 5).map(([facilitator, count]) => ({ facilitator, count })),
      hinderedBy: topN(hinderedCounts, 5).map(([trigger, count]) => ({ trigger, count })),
    },

    foodAndFeeling: {
      scoredEpisodes: scored.length,
      emotionalEpisodes: episodes.filter((e) => e.emotional).length,
      mindfulEatingScore: mindfulScore,
      adherenceOnLowMoodDays: rate(lowMoodDone, lowMoodDone + lowMoodMissed),
      adherenceOnOtherDays: rate(otherDone, otherDone + otherMissed),
      lateEatingOnHardDays: rate(
        hardTimed.filter((m) => m.at.getHours() >= LATE_EATING_HOUR).length,
        hardTimed.length
      ),
      lateEatingOnOtherDays: rate(
        easyTimed.filter((m) => m.at.getHours() >= LATE_EATING_HOUR).length,
        easyTimed.length
      ),
      snacksPerHardDay:
        hardDaysWithData > 0
          ? Math.round((snacksOnHardDays / hardDaysWithData) * 100) / 100
          : null,
      snacksPerOtherDay:
        otherDaysWithData > 0
          ? Math.round((snacksOnOtherDays / otherDaysWithData) * 100) / 100
          : null,
      emotionsAroundMeals: topN(emotionCounts, 5).map(([emotion, count]) => ({
        emotion,
        count,
      })),
    },
  };
};

/** Re-exported so callers building a summary don't need a second import just to
 *  compute the local day keys this function expects. */
export { toLocalDateKey };
