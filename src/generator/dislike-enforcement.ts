/**
 * Dislikes are a preference, not a rule: avoided whenever there is an equally
 * good alternative, never at the cost of a meal or a day.
 *
 * They used to be named in the prompt and never checked, and the model ignored
 * them often enough that users noticed — a Veggie Omelette with mushrooms for
 * someone who said no to mushrooms. A generated meal that contains a dislike
 * is now swapped for a library meal that fits the slot, the hard constraints
 * and the dislikes. When nothing fits, it stays.
 *
 * Allergies and restrictions remain hard rules (dietary-constraints.ts). The
 * user's own dishes are exempt (ingredient-match.ts `isUserChosen`).
 */
import logger from "../utils/logger";
import { DietaryConstraints } from "../utils/dietary-constraints";
import {
  describeDislikes,
  findMealDislikes,
  findPlanDislikes,
  isUserChosen,
  type DislikeViolation,
} from "../utils/ingredient-match";
import { LibraryMeal, libraryMealFits, libraryMealToRaw } from "./library-picks";
import type { MealSlot } from "./meal-plan-prompt";

const MAIN_SLOTS = ["breakfast", "lunch", "dinner"] as const;

/** Swap each remaining offender for a library meal that fits. Mutates `days`.
 *  Returns what could not be replaced. Exported for tests. */
export const replaceDislikedMeals = (
  days: any[],
  dislikes: string[],
  candidates: LibraryMeal[],
  opts: { constraints: DietaryConstraints; path?: string },
): DislikeViolation[] => {
  const used = new Set<string>();
  for (const day of days) {
    const m = day?.meals ?? {};
    for (const meal of [m.breakfast, m.lunch, m.dinner, ...(m.snacks ?? [])]) {
      if (meal?.name) used.add(String(meal.name).toLowerCase());
    }
  }

  const unresolved: DislikeViolation[] = [];
  const replaceIn = (day: any, slot: MealSlot, current: any, put: (meal: any) => void) => {
    if (!current || isUserChosen(current)) return;
    const matched = findMealDislikes(current, dislikes);
    if (!matched.length) return;
    const target = Number(current.calories) || 0;
    const fit = candidates.find(
      (c) =>
        !used.has(c.name.toLowerCase()) &&
        libraryMealFits(c, slot, target, { constraints: opts.constraints, dislikes, path: opts.path }) === null,
    );
    if (fit) {
      used.add(fit.name.toLowerCase());
      put(libraryMealToRaw(fit));
    } else {
      unresolved.push({ date: day?.date, mealType: slot, mealName: current.name, matched });
    }
  };

  for (const day of days) {
    const meals = day?.meals;
    if (!meals) continue;
    for (const slot of MAIN_SLOTS) {
      replaceIn(day, slot, meals[slot], (meal) => (meals[slot] = meal));
    }
    (meals.snacks ?? []).forEach((snack: any, i: number) =>
      replaceIn(day, "snack", snack, (meal) => (meals.snacks[i] = meal)),
    );
  }
  return unresolved;
};

/**
 * Steer freshly generated days away from dislikes. Each meal that contains one
 * is swapped for a library meal that fits as well; when none does, the meal
 * stays. No extra model call, and never a dropped day.
 */
export const preferWithoutDislikes = (params: {
  days: any[];
  dislikes: string[];
  constraints: DietaryConstraints;
  context: string;
  candidates?: LibraryMeal[];
  path?: string;
}): any[] => {
  const { days, dislikes, constraints, context } = params;
  if (!dislikes?.some((d) => d?.trim())) return days;

  const found = findPlanDislikes(days, dislikes);
  if (!found.length) return days;

  const kept = replaceDislikedMeals(days, dislikes, params.candidates ?? [], {
    constraints,
    path: params.path,
  });
  logger.info(
    `[${context}] Disliked ingredients in ${found.length} generated meal(s); ` +
      `replaced ${found.length - kept.length}` +
      (kept.length ? `, kept ${kept.length} with no alternative — ${describeDislikes(kept)}` : ""),
  );
  return days;
};
