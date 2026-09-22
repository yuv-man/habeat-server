/**
 * Passive repertoire capture — docs/the-repertoire.md §4.2.
 *
 * Pure functions over daily-progress documents, so the rules that decide what
 * counts as "a dish this user cooks" are testable without a database.
 *
 * The one rule that matters most: **only home cooking is evidence.** A meal
 * logged as `ordered` or `eaten-out` never counts toward a dish, and a meal with
 * no `source` is unanswered, not cooked — the same reading the Brain's takeaway
 * detection (P08) uses. The same Pad Thai can be takeaway on Friday and
 * home-cooked on Sunday; only Sunday says anything about the repertoire.
 */

import { ingredientKey } from "../utils/ingredient-key";

export type RepertoireSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type MealSourceValue = "cooked" | "ordered" | "eaten-out";

/** Home-cooked logs needed before a dish is proposed. */
export const CANDIDATE_MIN_COOKED = 2;
/** How far back capture looks. */
export const CAPTURE_WINDOW_DAYS = 30;

interface SnapshotLike {
  name?: unknown;
  done?: unknown;
  source?: unknown;
  calories?: unknown;
  macros?: { protein?: unknown; carbs?: unknown; fat?: unknown } | null;
  prepTime?: unknown;
  completedAt?: unknown;
}

export interface ProgressDayLike {
  dateKey?: string;
  meals?: {
    breakfast?: SnapshotLike | null;
    lunch?: SnapshotLike | null;
    dinner?: SnapshotLike | null;
    snacks?: (SnapshotLike | null)[] | null;
  } | null;
}

/** One ticked-off meal, with the fields capture needs. */
export interface LoggedDish {
  key: string;
  name: string;
  slot: RepertoireSlot;
  dateKey: string;
  source?: MealSourceValue;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  prepMinutes?: number;
}

export interface DishNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface RepertoireCandidate {
  key: string;
  /** The spelling from the most recent log — what the user will recognise. */
  name: string;
  /**
   * `confirmed`: cooked at home at least twice — "add it to your dishes?"
   * `ask-source`: logged often enough, but some logs never said where the food
   * came from — ask "do you make this at home?" before adding it.
   */
  kind: "confirmed" | "ask-source";
  slots: RepertoireSlot[];
  cookedCount: number;
  unansweredCount: number;
  lastLoggedOn: string;
  nutritionPerServing: DishNutrition | null;
  prepMinutes: number | null;
}

export interface ObservedRhythm {
  /** Home-cooked (or unanswered) logs in the window, scaled to 30 days. */
  observedPerMonth: number;
  lastCookedOn: string | null;
}

/**
 * Identity of a dish name. Built on the shopping list's ingredient key, so
 * case, punctuation, spacing and plurals fold the same way, and non-Latin
 * names (Hebrew plans) keep their letters.
 */
export const dishKey = (name: string): string => ingredientKey(name);

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const sourceOf = (v: unknown): MealSourceValue | undefined =>
  v === "cooked" || v === "ordered" || v === "eaten-out" ? v : undefined;

/** Every ticked-off meal across the days, keyed by dish. */
export const extractLoggedDishes = (days: ProgressDayLike[]): LoggedDish[] => {
  const out: LoggedDish[] = [];

  for (const day of days) {
    if (!day?.dateKey) continue;
    const push = (m: SnapshotLike | null | undefined, slot: RepertoireSlot) => {
      if (!m || m.done !== true || typeof m.name !== "string") return;
      const name = m.name.trim();
      const key = dishKey(name);
      if (!key) return;
      out.push({
        key,
        name,
        slot,
        dateKey: day.dateKey!,
        source: sourceOf(m.source),
        calories: num(m.calories),
        protein: num(m.macros?.protein),
        carbs: num(m.macros?.carbs),
        fat: num(m.macros?.fat),
        prepMinutes: num(m.prepTime),
      });
    };

    push(day.meals?.breakfast, "breakfast");
    push(day.meals?.lunch, "lunch");
    push(day.meals?.dinner, "dinner");
    (day.meals?.snacks ?? []).forEach((s) => push(s, "snack"));
  }

  return out;
};

const isTakeaway = (d: LoggedDish): boolean =>
  d.source === "ordered" || d.source === "eaten-out";

const mean = (xs: (number | undefined)[]): number | null => {
  const vals = xs.filter((x): x is number => x !== undefined);
  return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
};

/** Average of the home logs' snapshots. Null unless every macro is known. */
export const averageNutrition = (logs: LoggedDish[]): DishNutrition | null => {
  const calories = mean(logs.map((l) => l.calories));
  const protein = mean(logs.map((l) => l.protein));
  const carbs = mean(logs.map((l) => l.carbs));
  const fat = mean(logs.map((l) => l.fat));
  if (calories === null || protein === null || carbs === null || fat === null) return null;
  return {
    calories: Math.round(calories),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
  };
};

const groupByKey = (logs: LoggedDish[]): Map<string, LoggedDish[]> => {
  const groups = new Map<string, LoggedDish[]>();
  for (const log of logs) {
    const list = groups.get(log.key) ?? [];
    list.push(log);
    groups.set(log.key, list);
  }
  return groups;
};

/**
 * Dishes worth proposing: logged at home often enough, and not already known
 * to the repertoire in any status — including ones the user declined, which
 * must never be proposed again.
 */
export const findCandidates = (
  logs: LoggedDish[],
  knownKeys: Set<string>,
): RepertoireCandidate[] => {
  const candidates: RepertoireCandidate[] = [];

  for (const [key, group] of groupByKey(logs)) {
    if (knownKeys.has(key)) continue;

    const home = group.filter((l) => !isTakeaway(l));
    const cooked = home.filter((l) => l.source === "cooked").length;
    const unanswered = home.length - cooked;

    let kind: RepertoireCandidate["kind"] | null = null;
    if (cooked >= CANDIDATE_MIN_COOKED) kind = "confirmed";
    else if (home.length >= CANDIDATE_MIN_COOKED) kind = "ask-source";
    if (!kind) continue;

    const latest = [...home].sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0];
    candidates.push({
      key,
      name: latest.name,
      kind,
      slots: [...new Set(home.map((l) => l.slot))],
      cookedCount: cooked,
      unansweredCount: unanswered,
      lastLoggedOn: latest.dateKey,
      nutritionPerServing: averageNutrition(home),
      prepMinutes: (() => {
        const p = mean(home.map((l) => l.prepMinutes));
        return p === null ? null : Math.round(p);
      })(),
    });
  }

  // Confirmed first, then the dishes eaten most — the ones the user is most
  // likely to recognise as "theirs".
  return candidates.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "confirmed" ? -1 : 1) ||
      b.cookedCount + b.unansweredCount - (a.cookedCount + a.unansweredCount),
  );
};

/**
 * How often each known dish actually turns up at home, for the balancer to
 * compare against what the user said. Takeaway logs don't count; unanswered
 * ones do — the dish is already confirmed as home cooking, so an unanswered
 * log of it is far more likely home than not.
 */
export const observeRhythm = (
  logs: LoggedDish[],
  keys: string[],
  windowDays: number = CAPTURE_WINDOW_DAYS,
): Map<string, ObservedRhythm> => {
  const groups = groupByKey(logs.filter((l) => !isTakeaway(l)));
  const out = new Map<string, ObservedRhythm>();

  for (const key of keys) {
    const group = groups.get(key) ?? [];
    const last = group.map((l) => l.dateKey).sort().pop() ?? null;
    out.set(key, {
      observedPerMonth: Math.round((group.length / Math.max(windowDays, 1)) * 30 * 10) / 10,
      lastCookedOn: last,
    });
  }

  return out;
};
