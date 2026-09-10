import {
  BehaviorEventType,
  IBehaviorEvent,
  IBehaviorEventContext,
} from "../schemas/behavior-event.schema";
import {
  LoggedMeal,
  MealSlot,
  SLOT_DEFAULT_HOUR,
  dateKeyAtHour,
  extractLoggedMeals,
  extractSkippedMeals,
} from "../../utils/eating-episodes";

/**
 * Turns what the app already recorded into what the Brain can reason about.
 *
 * The Brain does not get its own write path. Every event here is derived from
 * a collection some other part of Habeat owns, which means there is one system
 * of record and the Brain cannot quietly disagree with the tracker the user is
 * looking at. Re-running a window is idempotent: each event carries a
 * `fingerprint` built from the record it came from, so a second projection
 * updates in place instead of doubling every pattern's evidence.
 *
 * The projection is also where context gets attached. A meal on its own is a
 * food log; a meal with the mood that sat closest to it is a behaviour, and
 * that join happens once, here, rather than in every detector.
 */

/** How close a mood check-in must sit to a meal to be treated as its context. */
export const CONTEXT_WINDOW_MINUTES = 120;

export interface ProjectorMood {
  date?: string;
  time?: string;
  moodLevel?: number;
  moodCategory?: string;
  energyLevel?: number;
  stressLevel?: number;
}

export interface ProjectorCorrelation {
  mealId?: unknown;
  mealName?: string;
  mealType?: string;
  date?: string;
  wasEmotionalEating?: boolean;
  hungerLevelBefore?: number;
  moodBefore?: { moodCategory?: string };
  /** Where the food came from, when the user said. Absent is not "cooked". */
  source?: string;
}

export interface ProjectorInput {
  userId: unknown;
  /** Daily-progress documents covering the window. */
  progressDocs: any[];
  moods: ProjectorMood[];
  correlations: ProjectorCorrelation[];
  /** Today's local date key. Today is still in progress, so its untouched
   *  meals are not skips. */
  todayKey: string;
}

/** Sources that mean the food was not cooked by the user. */
const TAKEAWAY_SOURCES = new Set(["ordered", "eaten-out", "takeaway"]);

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * "YYYY-MM-DD" + "HH:MM" as a local Date. Built from parts rather than parsed,
 * because `new Date("2026-09-08")` is UTC midnight and would move an evening
 * mood into the following day for anyone west of Greenwich.
 */
const localDateTime = (dateKey?: string, time?: string): Date | null => {
  if (!dateKey) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = (time ?? "12:00").split(":").map(Number);
  const at = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
};

interface TimedMood {
  at: Date;
  mood: ProjectorMood;
}

/** The mood check-in closest to `at`, within the context window. */
const moodNear = (at: Date, moods: TimedMood[]): ProjectorMood | null => {
  let best: TimedMood | null = null;
  let bestGap = Infinity;

  for (const candidate of moods) {
    const gap = Math.abs(candidate.at.getTime() - at.getTime());
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }

  if (!best || bestGap > CONTEXT_WINDOW_MINUTES * 60_000) return null;
  return best.mood;
};

const contextFrom = (
  mood: ProjectorMood | null,
  extra: Partial<IBehaviorEventContext> = {},
): IBehaviorEventContext | undefined => {
  const context: IBehaviorEventContext = { ...extra };

  if (mood) {
    if (mood.moodCategory) context.feeling = mood.moodCategory;
    if (typeof mood.energyLevel === "number") context.energy = mood.energyLevel;
    if (typeof mood.stressLevel === "number") context.stress = mood.stressLevel;
  }

  return Object.keys(context).length > 0 ? context : undefined;
};

export const projectBehaviorEvents = (
  input: ProjectorInput,
): Omit<IBehaviorEvent, "userId">[] => {
  const { progressDocs, moods, correlations, todayKey } = input;

  const timedMoods: TimedMood[] = moods
    .map((mood) => {
      const at = localDateTime(mood.date, mood.time);
      return at ? { at, mood } : null;
    })
    .filter((m): m is TimedMood => m !== null);

  const events: Omit<IBehaviorEvent, "userId">[] = [];

  // ── meals the user ticked off ────────────────────────────────────────────
  const loggedMeals: LoggedMeal[] = extractLoggedMeals(progressDocs);

  // Correlations are indexed by day+slot so a meal can pick up what the user
  // said about it — hunger, emotional eating, where the food came from.
  const correlationKey = (date?: string, mealType?: string) =>
    `${date ?? ""}::${(mealType ?? "").toLowerCase()}`;
  const correlationsByMeal = new Map<string, ProjectorCorrelation>();
  for (const c of correlations) {
    correlationsByMeal.set(correlationKey(c.date, c.mealType), c);
  }

  for (const meal of loggedMeals) {
    const correlation =
      correlationsByMeal.get(correlationKey(meal.date, meal.mealType)) ??
      // "snacks" in progress, "snack" in the CBT model.
      correlationsByMeal.get(
        correlationKey(meal.date, meal.mealType.replace(/s$/, "")),
      );

    const mood = meal.atIsExact ? moodNear(meal.at, timedMoods) : null;

    const context = contextFrom(mood, {
      ...(typeof correlation?.hungerLevelBefore === "number"
        ? { hunger: correlation.hungerLevelBefore }
        : {}),
      // A meal that appears on the plan and was ticked off was planned. One
      // logged with no plan behind it was not.
      planned: true,
    });

    events.push({
      type:
        meal.mealType === "snacks"
          ? BehaviorEventType.SNACK_LOGGED
          : BehaviorEventType.MEAL_LOGGED,
      mealId: meal.mealId,
      mealType: meal.mealType,
      mealName: meal.mealName,
      timestamp: meal.at,
      timestampIsExact: meal.atIsExact,
      dateKey: meal.date,
      context,
      source: "daily_progress",
      fingerprint: `meal:${meal.date}:${meal.mealType}:${meal.mealId}`,
    });

    // ── takeaway ──────────────────────────────────────────────────────────
    // Two capture points, one answer. The meal's own `source` wins: it is
    // stamped on the progress snapshot at the moment the user logged what they
    // ate, whereas the correlation is a later reflection on the same meal.
    //
    // Either way, only when the user actually told us. An unanswered meal stays
    // silent rather than counting as home cooking, which would make the
    // takeaway rate look better than it is.
    const mealSource = meal.source ?? correlation?.source;

    if (mealSource && TAKEAWAY_SOURCES.has(mealSource)) {
      events.push({
        type: BehaviorEventType.TAKEAWAY_LOGGED,
        mealId: meal.mealId,
        mealType: meal.mealType,
        mealName: meal.mealName,
        timestamp: meal.at,
        timestampIsExact: meal.atIsExact,
        dateKey: meal.date,
        context,
        // Provenance has to name where the answer actually came from, or the
        // evidence trail points at the wrong record.
        source: meal.source ? "daily_progress" : "meal_mood_correlation",
        fingerprint: `takeaway:${meal.date}:${meal.mealType}:${meal.mealId}`,
      });
    }
  }

  // ── planned meals that never happened ────────────────────────────────────
  const skipped = extractSkippedMeals(progressDocs, todayKey);
  for (const miss of skipped) {
    const at = dateKeyAtHour(
      miss.date,
      SLOT_DEFAULT_HOUR[miss.mealType as MealSlot] ?? 12,
    );
    if (!at) continue;

    events.push({
      type: BehaviorEventType.MEAL_SKIPPED,
      mealType: miss.mealType,
      timestamp: at,
      // A skip has no real time — nothing happened. Marked inexact so no
      // time-of-day detector can build a claim on a placeholder.
      timestampIsExact: false,
      dateKey: miss.date,
      context: contextFrom(null, { planned: true }),
      source: "daily_progress",
      fingerprint: `skip:${miss.date}:${miss.mealType}`,
    });
  }

  // ── wellness check-ins ───────────────────────────────────────────────────
  for (const { at, mood } of timedMoods) {
    events.push({
      type: BehaviorEventType.WELLNESS_LOGGED,
      timestamp: at,
      timestampIsExact: true,
      dateKey: mood.date ?? "",
      context: contextFrom(mood),
      source: "mood_entry",
      fingerprint: `mood:${mood.date}:${mood.time}`,
    });
  }

  // ── workouts ─────────────────────────────────────────────────────────────
  for (const doc of progressDocs) {
    const dateKey: string | undefined = doc?.dateKey;
    if (!dateKey) continue;

    const workouts: any[] = Array.isArray(doc?.workouts) ? doc.workouts : [];
    workouts.forEach((workout, index) => {
      if (workout?.done !== true) return;
      const at = dateKeyAtHour(dateKey, 18);
      if (!at) return;

      events.push({
        type: BehaviorEventType.WORKOUT_COMPLETED,
        timestamp: at,
        timestampIsExact: false,
        dateKey,
        source: "daily_progress",
        fingerprint: `workout:${dateKey}:${index}`,
      });
    });
  }

  return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
};

/** Days in the window that carry any observation at all. */
export const observedDaysIn = (
  events: Omit<IBehaviorEvent, "userId">[],
): number => new Set(events.map((e) => e.dateKey).filter(Boolean)).size;
