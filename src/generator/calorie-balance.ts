/**
 * Portion-scale generated meals onto their calorie targets.
 *
 * The prompt gives every meal a target and says the numbers are checked; this
 * is the check. A meal that lands off its target is portion-scaled — ingredient
 * amounts and macros together, so the recipe and its nutrition still agree —
 * the same way the repertoire balancer scales a known dish onto a day
 * (docs/the-repertoire.md §6), instead of re-asking the model.
 *
 * (A +28% week that prompted this turned out to come from a later step,
 * validateAndCorrectMealMacros, not from the model; this remains the net for
 * the model drifting on its own.)
 *
 * Works on the raw model output, before transformWeeklyPlan: meals are
 * `{ calories, macros: {protein, carbs, fat}, ingredients: ["name|amount|unit|category"] }`.
 */

import { MealSlot, slotCalorieShares } from "./meal-plan-prompt";

/** A meal this close to its target is left exactly as the model wrote it. */
export const CALORIE_TOLERANCE = 0.12;
/** Past this, scaling makes a different-looking plate; the rest stays over. */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 1.5;

export interface CalorieAdjustment {
  date: string;
  slot: MealSlot;
  name: string;
  from: number;
  to: number;
  target: number;
}

const roundTo = (value: number, step: number): number => Math.round(value / step) * step;

/** Round a scaled amount to something a person would actually measure. */
export const roundAmount = (value: number, unit: string): number => {
  const u = unit.trim().toLowerCase();
  if (u === "g" || u === "ml") return Math.max(5, roundTo(value, value >= 50 ? 5 : 1));
  if (u === "tsp") return Math.max(0.25, roundTo(value, 0.25));
  if (u === "tbsp" || u === "cup") return Math.max(0.25, roundTo(value, 0.25));
  // piece, slice and anything unrecognised: halves.
  return Math.max(0.5, roundTo(value, 0.5));
};

/** "rolled_oats|60|g|Grains" scaled by `factor`. Unparseable entries pass through. */
export const scaleIngredient = (entry: unknown, factor: number): unknown => {
  if (typeof entry === "string") {
    const parts = entry.split("|");
    const amount = Number(parts[1]);
    if (parts.length < 3 || !Number.isFinite(amount) || amount <= 0) return entry;
    parts[1] = String(roundAmount(amount * factor, parts[2]));
    return parts.join("|");
  }
  if (Array.isArray(entry)) {
    // [name, "45 g", category?]
    const m = String(entry[1] ?? "").match(/^\s*([\d.]+)\s*(.*)$/);
    if (!m) return entry;
    const scaled = roundAmount(Number(m[1]) * factor, m[2] || "piece");
    return [entry[0], `${scaled}${m[2] ? ` ${m[2]}` : ""}`, ...entry.slice(2)];
  }
  return entry;
};

/** Scale one meal in place — ingredients and macros together. Returns its new calories. */
export const scaleMeal = (meal: any, factor: number): number => {
  const macros = meal.macros ?? {};
  const protein = Math.round((Number(macros.protein) || 0) * factor);
  const carbs = Math.round((Number(macros.carbs) || 0) * factor);
  const fat = Math.round((Number(macros.fat) || 0) * factor);
  meal.macros = { ...macros, protein, carbs, fat };
  // Keep the prompt's own invariant: calories are the energy in the macros.
  meal.calories = protein * 4 + carbs * 4 + fat * 9;
  if (Array.isArray(meal.ingredients)) {
    meal.ingredients = meal.ingredients.map((i: unknown) => scaleIngredient(i, factor));
  }
  return meal.calories;
};

/**
 * Bring every meal of the given raw days within tolerance of its slot target,
 * as far as the scale limits allow. Mutates and returns the days, plus a list of
 * what changed for the log.
 */
export const rebalanceDayCalories = (
  days: any[],
  targetCalories: number,
  activeSlots: MealSlot[],
): { days: any[]; adjustments: CalorieAdjustment[] } => {
  const shares = slotCalorieShares(activeSlots);
  const adjustments: CalorieAdjustment[] = [];

  for (const day of days) {
    const meals = day?.meals;
    if (!meals) continue;

    const entries: [MealSlot, any, number][] = [];
    for (const slot of ["breakfast", "lunch", "dinner"] as const) {
      if (meals[slot] && shares[slot]) entries.push([slot, meals[slot], targetCalories * shares[slot]]);
    }
    const snacks = Array.isArray(meals.snacks) ? meals.snacks.filter(Boolean) : [];
    if (snacks.length && shares.snack) {
      // Several snacks share the one snack budget.
      for (const s of snacks) entries.push(["snack", s, (targetCalories * shares.snack) / snacks.length]);
    }

    for (const [slot, meal, rawTarget] of entries) {
      const calories = Number(meal.calories);
      if (!Number.isFinite(calories) || calories <= 0) continue;
      const target = Math.round(rawTarget);
      if (Math.abs(calories - target) <= CALORIE_TOLERANCE * target) continue;

      const factor = Math.min(MAX_SCALE, Math.max(MIN_SCALE, target / calories));
      const to = scaleMeal(meal, factor);
      adjustments.push({ date: day.date ?? "", slot, name: meal.name ?? slot, from: calories, to, target });
    }
  }

  return { days, adjustments };
};
