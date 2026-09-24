/**
 * Meals taken from the labelled library instead of written by the model.
 *
 * A plan used to be written dish by dish, every week, for every user — and
 * much of it was then replaced in code anyway. Library meals are real dishes
 * from earlier plans, with ingredients and nutrition already worked out; a
 * share of each week now comes from there, which makes the plan cheaper and
 * quicker to build.
 *
 * The library once served a vegan "Sirloin Steak And Broccoli Scramble"
 * (generator.service.ts, processMeal), because it was matched on calories and
 * liked foods alone. So every pick here is checked against the user's own
 * constraints with the same function that checks generated meals, and a slot
 * only gets a library meal when one genuinely fits; otherwise the model writes
 * it as before.
 */
import { DietaryConstraints, findMealViolations } from "../utils/dietary-constraints";
import { MealLabels } from "../meal/meal-labels";
import { isLowCarbPath, MealSlot, PlannedDay } from "./meal-plan-prompt";

/** Share of the slots left for the model that the library may take. */
export const LIBRARY_SHARE = 0.4;
/** How far a library meal's calories may sit from the slot; portions are then
 *  scaled onto the slot (calorie-balance.ts allows 0.5–1.5x). */
const MIN_RATIO = 0.7;
const MAX_RATIO = 1.4;

export interface LibraryMeal {
  _id: string;
  name: string;
  category: "breakfast" | "lunch" | "dinner" | "snack";
  calories: number;
  macros: { protein: number; carbs: number; fat: number };
  ingredients: unknown[];
  prepTime?: number;
  labels: MealLabels;
  timesCompleted?: number;
}

export interface LibraryPickOptions {
  /** The outline still to be filled (repeat slots already removed). */
  skeleton: PlannedDay[];
  candidates: LibraryMeal[];
  constraints: DietaryConstraints;
  dislikes?: string[];
  /** Dish names not to serve: recently planned, swapped away. */
  avoidNames?: string[];
  /** The user's own dishes, placed separately: a library "Garlic Beef Burger"
   *  in the same week as their own "Beef burger" is the same meal twice. */
  ownDishes?: string[];
  path?: string;
  maxPrepMinutes?: number;
  share?: number;
  seed: string;
}

export const slotKey = (date: string, slot: string): string => `${date}|${slot}`;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Why a candidate cannot go in a slot, or null when it can. Exported for tests. */
export const libraryMealFits = (
  meal: LibraryMeal,
  slot: MealSlot,
  targetCalories: number,
  opts: Pick<LibraryPickOptions, "constraints" | "dislikes" | "path" | "maxPrepMinutes">,
): string | null => {
  if (meal.category !== slot) return "wrong slot";
  if (!meal.calories || !targetCalories) return "no calories";
  const ratio = meal.calories / targetCalories;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return "calories too far from the slot";
  if (findMealViolations(meal, opts.constraints).length) return "breaks a dietary constraint";
  const text = [norm(meal.name), ...(meal.labels?.ingredientNames ?? [])].join(" | ");
  if ((opts.dislikes ?? []).some((d) => d.trim() && text.includes(norm(d)))) return "contains a dislike";
  if (isLowCarbPath(opts.path) && !meal.labels?.lowCarb) return "not low-carb";
  const prep = meal.labels?.prepMinutes ?? meal.prepTime;
  if (opts.maxPrepMinutes && prep && prep > opts.maxPrepMinutes) return "takes too long";
  return null;
};

/**
 * Which outline slots take a library meal, and which one. Keys are
 * slotKey(date, slot). Favourites (the user's own dishes, liked foods) are
 * never taken — they are placed on purpose.
 */
export const pickLibraryMeals = (opts: LibraryPickOptions): Map<string, LibraryMeal> => {
  const picks = new Map<string, LibraryMeal>();
  const share = opts.share ?? LIBRARY_SHARE;
  if (share <= 0 || !opts.candidates.length) return picks;

  const slots = opts.skeleton.flatMap((day) =>
    day.meals.filter((m) => !m.favourite).map((m) => ({ day, meal: m })),
  );
  const want = Math.floor(slots.length * share);
  if (!want) return picks;

  const usedIds = new Set<string>();
  const usedNames = new Set((opts.avoidNames ?? []).map(norm));
  const dayProteins = new Map<string, Set<string>>();

  // A seeded order, so the library's share lands across the week rather than
  // filling Monday first — and the same week comes out the same way.
  const ordered = [...slots].sort(
    (a, b) =>
      hash(`${opts.seed}|${a.day.dateStr}|${a.meal.slot}`) -
      hash(`${opts.seed}|${b.day.dateStr}|${b.meal.slot}`),
  );

  const own = (opts.ownDishes ?? []).map(norm).filter((n) => n.length >= 4);

  for (const { day, meal: planned } of ordered) {
    if (picks.size >= want) break;
    const proteinsToday = dayProteins.get(day.dateStr) ?? new Set<string>();

    let best: { meal: LibraryMeal; score: number } | null = null;
    for (const candidate of opts.candidates) {
      if (usedIds.has(String(candidate._id)) || usedNames.has(norm(candidate.name))) continue;
      if (own.some((o) => norm(candidate.name).includes(o))) continue;
      if (libraryMealFits(candidate, planned.slot, planned.calories, opts)) continue;
      const proteins = candidate.labels?.proteins ?? [];
      // Two mains with the same protein on one day is what the outline's
      // shared rotation exists to prevent.
      const isMain = planned.slot === "lunch" || planned.slot === "dinner";
      if (isMain && proteins.some((p) => proteinsToday.has(p))) continue;

      const score =
        (proteins.includes(planned.protein) ? 3 : 0) +
        Math.min(candidate.timesCompleted ?? 0, 5) * 0.5 -
        Math.abs(candidate.calories / planned.calories - 1) * 2 +
        (hash(`${opts.seed}|${candidate._id}|${day.dateStr}`) % 1000) / 10000;
      if (!best || score > best.score) best = { meal: candidate, score };
    }
    if (!best) continue;

    picks.set(slotKey(day.dateStr, planned.slot), best.meal);
    usedIds.add(String(best.meal._id));
    usedNames.add(norm(best.meal.name));
    if (planned.slot === "lunch" || planned.slot === "dinner") {
      for (const p of best.meal.labels?.proteins ?? []) proteinsToday.add(p);
      dayProteins.set(day.dateStr, proteinsToday);
    }
  }
  return picks;
};

/** "150 g" → ["150", "g"]; "1 large" → ["1", "large"]; "pinch" → ["1", "pinch"]. */
const splitAmount = (amount: string): [string, string] => {
  const m = String(amount ?? "").trim().match(/^([\d.\/]+)\s*(.*)$/);
  return m ? [m[1], m[2] || "piece"] : ["1", String(amount ?? "").trim() || "piece"];
};

/**
 * A library meal in the shape the model's answer has, so it goes through the
 * same pipeline — portioned onto its slot, checked, stored — as a written one.
 */
export const libraryMealToRaw = (meal: LibraryMeal): Record<string, unknown> => ({
  name: meal.name,
  calories: meal.calories,
  macros: { ...meal.macros },
  ingredients: (meal.ingredients ?? []).map((i) => {
    if (!Array.isArray(i)) return String(i);
    const [amount, unit] = splitAmount(String(i[1] ?? ""));
    return `${String(i[0])}|${amount}|${unit}|${String(i[2] ?? "Other")}`;
  }),
  prepTime: meal.prepTime ?? meal.labels?.prepMinutes ?? 20,
  fromLibrary: String(meal._id),
});

/** The outline without the slots filled in code; days left with nothing to write are dropped. */
export const outlineForModel = (skeleton: PlannedDay[], filled: Set<string>): PlannedDay[] =>
  skeleton
    .map((day) => ({ ...day, meals: day.meals.filter((m) => !filled.has(slotKey(day.dateStr, m.slot))) }))
    .filter((day) => day.meals.length > 0);

/**
 * Put the library's meals into the model's days (or into a day the model was
 * not asked for at all). Mutates and returns the list of days.
 */
export const injectLibraryMeals = (
  days: any[],
  picks: Map<string, LibraryMeal>,
  dayNames: Map<string, string>,
): any[] => {
  for (const [key, meal] of picks) {
    const [date, slot] = key.split("|");
    let day = days.find((d) => d?.date === date);
    if (!day) {
      day = { date, day: dayNames.get(date) ?? "", meals: {}, workouts: [] };
      days.push(day);
    }
    day.meals = day.meals ?? {};
    const raw = libraryMealToRaw(meal);
    if (slot === "snack") day.meals.snacks = [raw, ...(day.meals.snacks ?? []).slice(1)];
    else day.meals[slot] = raw;
  }
  days.sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
  return days;
};
