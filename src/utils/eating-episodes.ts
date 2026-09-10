/**
 * Eating episodes — the join between what the user *ate* and what they *felt*.
 *
 * The insight pipeline used to read one collection only: MealMoodCorrelation,
 * written when a user deliberately attaches a mood to a meal. That is the
 * highest-fidelity record and also the rarest one, so a user who faithfully
 * ticked off every meal on the tracker still saw an empty eating half on the
 * chart and an "Example" badge over their patterns table — the app had the
 * meals all along, it just never looked at them.
 *
 * This module makes the meals visible. Every meal marked done on the daily
 * tracker is an episode. Where a mood check-in sits close enough in time to
 * have plausibly been about that meal, the two are paired and the episode can
 * be scored; where nothing was felt nearby, the episode still counts as a meal
 * logged and is reported as unscored rather than being scored as neutral.
 *
 * The provenance of every episode travels with it (`source`), so nothing
 * downstream can quietly present an inferred pairing as something the user
 * told us.
 */

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snacks";

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snacks"];

/**
 * When a meal has no completion timestamp we place it at the middle of its
 * slot. Meals completed before `completedAt` existed have no better anchor,
 * and a slot-typical hour is closer to the truth than "midnight".
 */
export const SLOT_DEFAULT_HOUR: Record<MealSlot, number> = {
  breakfast: 8,
  lunch: 13,
  dinner: 19,
  snacks: 16,
};

/** How close a mood check-in has to sit to a meal to be treated as being
 *  about it. Two hours either side: long enough to catch "logged the mood
 *  once I'd finished", short enough that breakfast's mood can't be lunch's. */
export const MOOD_MATCH_WINDOW_MINUTES = 120;

/** A meal the user actually marked done on the tracker. */
export interface LoggedMeal {
  mealId: string;
  mealName: string;
  mealType: MealSlot;
  /** YYYY-MM-DD, local to the user (progress stores it that way). */
  date: string;
  /** When it was eaten. Exact when the tracker recorded a completion time,
   *  otherwise the slot's typical hour on that date. */
  at: Date;
  /** False when `at` is a slot fallback rather than a real timestamp. Time-of-
   *  day claims (late-night eating, risk windows) require a real one. */
  atIsExact: boolean;
  calories?: number;
  /** Where the food came from, when the user told us. Undefined means they
   *  were never asked or declined to say — never read it as home cooking. */
  source?: "cooked" | "ordered" | "eaten-out";
}

interface ProgressMealSnapshot {
  _id?: unknown;
  name?: string;
  done?: boolean;
  completedAt?: Date | string | null;
  calories?: number;
  source?: "cooked" | "ordered" | "eaten-out";
}

interface ProgressDoc {
  dateKey?: string;
  date?: Date | string;
  meals?: {
    breakfast?: ProgressMealSnapshot | null;
    lunch?: ProgressMealSnapshot | null;
    dinner?: ProgressMealSnapshot | null;
    snacks?: ProgressMealSnapshot[] | null;
  } | null;
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
};

/** YYYY-MM-DD in the server's local zone, matching how progress writes dateKey. */
export const toLocalDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Local midnight of a YYYY-MM-DD key, plus `hour`. Built from parts rather
 *  than `new Date(str)` so the key isn't reinterpreted as UTC. */
export const dateKeyAtHour = (dateKey: string, hour: number): Date | null => {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return null;
  const at = new Date(y, m - 1, d, hour, 0, 0, 0);
  return isNaN(at.getTime()) ? null : at;
};

/**
 * Every meal ticked off across a set of daily-progress documents.
 * Meals still open (done !== true) are not episodes — they are plans.
 */
export const extractLoggedMeals = (progressDocs: ProgressDoc[]): LoggedMeal[] => {
  const meals: LoggedMeal[] = [];

  for (const doc of progressDocs) {
    const dateKey =
      doc.dateKey ??
      (toDate(doc.date) ? toLocalDateKey(toDate(doc.date)!) : undefined);
    if (!dateKey) continue;

    const push = (snapshot: ProgressMealSnapshot | null | undefined, slot: MealSlot) => {
      if (!snapshot || snapshot.done !== true) return;

      const exact = toDate(snapshot.completedAt);
      const at = exact ?? dateKeyAtHour(dateKey, SLOT_DEFAULT_HOUR[slot]);
      if (!at) return;

      meals.push({
        mealId: snapshot._id ? String(snapshot._id) : `${dateKey}-${slot}-${meals.length}`,
        mealName: snapshot.name ?? slot,
        mealType: slot,
        date: dateKey,
        at,
        atIsExact: Boolean(exact),
        calories: snapshot.calories,
        source: snapshot.source,
      });
    };

    push(doc.meals?.breakfast, "breakfast");
    push(doc.meals?.lunch, "lunch");
    push(doc.meals?.dinner, "dinner");
    (doc.meals?.snacks ?? []).forEach((snack) => push(snack, "snacks"));
  }

  return meals.sort((a, b) => a.at.getTime() - b.at.getTime());
};

/** Slots that were on the plan for a past day and never got ticked off. Used
 *  to describe skipping as a pattern, which is as much a food pattern as
 *  eating is. */
export const extractSkippedMeals = (
  progressDocs: ProgressDoc[],
  /** Today's key — the current day is still in progress, so its untouched
   *  meals are not skips. */
  todayKey: string,
): { date: string; mealType: MealSlot }[] => {
  const skipped: { date: string; mealType: MealSlot }[] = [];

  for (const doc of progressDocs) {
    const dateKey = doc.dateKey;
    if (!dateKey || dateKey >= todayKey) continue;

    (["breakfast", "lunch", "dinner"] as const).forEach((slot) => {
      const snapshot = doc.meals?.[slot];
      // Only a meal that was actually planned can be skipped.
      if (snapshot?.name && snapshot.done !== true) {
        skipped.push({ date: dateKey, mealType: slot });
      }
    });
  }

  return skipped;
};

export interface TimedMood<T> {
  at: Date;
  entry: T;
}

/**
 * Parse mood entries into timestamped ones, dropping any whose date/time can't
 * be read. A mood we can't place in time can still be counted, but it can't be
 * attached to a meal.
 */
export const timestampMoods = <T extends { date?: string; time?: string }>(
  moods: T[],
): TimedMood<T>[] =>
  moods
    .map((entry) => {
      if (!entry.date || !entry.time) return null;
      const [y, m, d] = entry.date.split("-").map(Number);
      const [hh, mm] = entry.time.split(":").map(Number);
      if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
      const at = new Date(y, m - 1, d, hh, mm, 0, 0);
      return isNaN(at.getTime()) ? null : { at, entry };
    })
    .filter((x): x is TimedMood<T> => x !== null);

/**
 * The mood check-in closest in time to a meal, within the match window.
 * Returns null when nothing was logged near enough — the honest answer, and
 * the reason an episode can come back unscored.
 */
export const nearestMood = <T>(
  meal: LoggedMeal,
  moods: TimedMood<T>[],
  windowMinutes: number = MOOD_MATCH_WINDOW_MINUTES,
): TimedMood<T> | null => {
  const limit = windowMinutes * 60 * 1000;
  let best: TimedMood<T> | null = null;
  let bestGap = Infinity;

  for (const mood of moods) {
    const gap = Math.abs(mood.at.getTime() - meal.at.getTime());
    if (gap <= limit && gap < bestGap) {
      best = mood;
      bestGap = gap;
    }
  }

  return best;
};
