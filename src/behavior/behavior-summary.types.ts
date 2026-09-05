/**
 * The behavioural summary — the contract between MongoDB and the LLM.
 *
 * Nothing in this file is inferred, judged or interpreted: every field is a
 * count, an average or a rate that code can compute and a test can pin down.
 * The reasoning happens one stage later, over this object, never over raw
 * documents. That split is the whole point of the pipeline:
 *
 *     MongoDB → aggregation (here) → behavioural summary → LLM analysis
 *
 * Two rules this shape has to keep honest:
 *
 *  1. **Absent is not zero.** Every derived rate is `null` when its denominator
 *     is empty, so "we never asked" can't be read as "the answer was none".
 *  2. **Coverage travels with the data.** Each block carries how many days or
 *     records it stands on, so the analyst can weigh a pattern seen twice in
 *     three days differently from one seen twice in thirty.
 */

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snacks";

export interface SlotCounts {
  breakfast: number;
  lunch: number;
  dinner: number;
  snacks: number;
}

/** A rate plus the evidence under it. `value` is null when `of` is 0. */
export interface Rate {
  value: number | null;
  hits: number;
  of: number;
}

export interface BehaviorSummary {
  period: { days: number; start: string; end: string; daysWithAnyData: number };

  goal: {
    path: string | null;
    targetWeight: number | null;
    currentWeight: number | null;
    activeGoals: { title: string; current: number; target: number; unit: string }[];
    mealsPerDay: number | null;
    fastingHours: number | null;
  };

  meals: {
    logged: SlotCounts;
    totalLogged: number;
    averagePerDay: number | null;
    daysWithAnyMeal: number;
    daysWithFullDay: number;
  };

  timing: {
    /** "HH:MM" averages over meals that carry a real completion time. */
    average: Partial<Record<MealSlot, string>>;
    /** How many meals each average stands on. */
    basis: SlotCounts;
    latestMealHour: number | null;
    lateEatingDays: number;
    lateEatingRate: Rate;
  };

  adherence: {
    plannedMeals: number;
    completed: number;
    skipped: number;
    /** Planned meals swapped out for something else during this period. Only
     *  counts swaps recorded since dated swap events existed — `replacedTotal`
     *  is the lifetime figure it sits inside. */
    replaced: number;
    replacedTotal: number;
    completionRate: Rate;
    bySlot: Record<MealSlot, Rate>;
    weekday: Rate;
    weekend: Rate;
    /** weekend rate minus weekday rate; null when either side has no data. */
    weekendDelta: number | null;
    byDayOfWeek: Record<number, Rate>;
  };

  nutrition: {
    avgCaloriesConsumed: number | null;
    avgCalorieGoal: number | null;
    calorieAccuracy: "under" | "on-target" | "over" | null;
    avgProtein: number | null;
    proteinGoal: number | null;
    avgCarbs: number | null;
    avgFat: number | null;
    macroWeakness: "protein" | "carbs" | "fat" | null;
    daysWithNutritionData: number;
  };

  water: {
    avgGlasses: number | null;
    goal: number | null;
    daysMetGoal: number;
    consistency: Rate;
  };

  exercise: {
    sessionsPlanned: number;
    sessionsCompleted: number;
    completionRate: Rate;
    daysWithWorkout: number;
    avgPerWeek: number | null;
    /** Adherence on days a workout was completed vs days without one. */
    mealAdherenceOnWorkoutDays: Rate;
    mealAdherenceOnRestDays: Rate;
  };

  variety: {
    distinctMeals: number;
    totalMeals: number;
    /** 0–1: share of logged meals that were a repeat of something already eaten. */
    repeatRate: number | null;
    mostRepeated: { name: string; count: number }[];
  };

  prepTime: {
    avgPlanned: number | null;
    avgCompleted: number | null;
    avgSkipped: number | null;
    /** Positive means skipped meals took longer to make than completed ones —
     *  the signal behind "complicated breakfasts don't get eaten". */
    skippedMinusCompleted: number | null;
    bySlot: Record<MealSlot, { avgCompleted: number | null; avgSkipped: number | null }>;
  };

  preferences: {
    favoriteMeals: { name: string; count: number }[];
    swappedAwayFrom: { name: string; count: number }[];
    favoriteCategories: { cuisine: string; score: number }[];
    dislikes: string[];
    restrictions: string[];
  };

  wellness: {
    checkIns: number;
    daysWithCheckIn: number;
    avgMood: number | null;
    avgEnergy: number | null;
    avgStress: number | null;
    tiredDays: number;
    stressedDays: number;
    lowMoodDays: number;
    byDayOfWeek: Record<number, { checkIns: number; avgMood: number | null }>;
    topTriggers: { trigger: string; count: number }[];
    easedBy: { facilitator: string; count: number }[];
    hinderedBy: { trigger: string; count: number }[];
  };

  /**
   * The bridge this feature exists for: what the feelings did to the eating.
   * Every figure here is a comparison of the same user against themselves, so
   * a low mood day is measured against their own ordinary day.
   */
  foodAndFeeling: {
    scoredEpisodes: number;
    emotionalEpisodes: number;
    mindfulEatingScore: number | null;
    /** Meal adherence on days the user reported a low mood, against the rest. */
    adherenceOnLowMoodDays: Rate;
    adherenceOnOtherDays: Rate;
    /** Late eating on stressed/tired days against the rest. */
    lateEatingOnHardDays: Rate;
    lateEatingOnOtherDays: Rate;
    /** Snacks logged per day, hard days against the rest. */
    snacksPerHardDay: number | null;
    snacksPerOtherDay: number | null;
    /** Emotions most often logged near a meal. */
    emotionsAroundMeals: { emotion: string; count: number }[];
  };
}
