/**
 * Alternatives for a planned meal that isn't going to happen, offered before
 * anything is changed.
 *
 * Free users who tapped Swap used to find two locked tiles, an empty favourites
 * list and a nutrition form; "I'm tired" replaced the meal with an AI dish
 * without asking. Both now start here. The user's own dishes come first —
 * they already know how to make them — then quick library meals, and only if
 * that leaves fewer than two choices does the caller ask the model for one.
 *
 * Every option has passed the hard dietary constraints and skips dishes the
 * user has turned down (meal-learning.ts swapAvoidNames). Library meals with a
 * dislike are offered only after every other fit; the user's own dishes are
 * theirs, as in the planner.
 */
import { DietaryConstraints, findMealViolations } from "../utils/dietary-constraints";
import { findMealDislikes } from "../utils/ingredient-match";
import { LibraryMeal, libraryMealFits } from "./library-picks";
import { dishAsPlanMeal, PlannableDish } from "./own-dishes";
import type { MealSlot } from "./meal-plan-prompt";

export type MealOptionsMode = "mine" | "quicker";
export type MealOptionSource = "own" | "library" | "ai";

export interface MealOption {
  meal: any;
  source: MealOptionSource;
  /** One line on why it's offered, shown under the name. */
  reason: string;
}

/** The most "quicker" may take: a third off the planned meal, never over 20. */
export const quickPrepLimit = (currentPrep?: number | null): number => {
  const planned = Number(currentPrep) || 30;
  return Math.max(10, Math.min(20, Math.round(planned * 0.67)));
};

/** Mains a dish with no recorded slots is fit for. */
const DEFAULT_DISH_SLOTS: MealSlot[] = ["lunch", "dinner"];

const fitsSlot = (dish: PlannableDish, slot: MealSlot): boolean =>
  (dish.slots?.length ? dish.slots : DEFAULT_DISH_SLOTS).includes(slot);

const sameDish = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface BuildMealOptionsInput {
  mode: MealOptionsMode;
  slot: MealSlot;
  /** The planned meal being replaced. */
  current: { name?: string; calories?: number; prepTime?: number };
  ownDishes: PlannableDish[];
  libraryCandidates: LibraryMeal[];
  constraints: DietaryConstraints;
  dislikes: string[];
  /** Dishes the user has turned down. */
  avoidNames: string[];
  path?: string;
  limit?: number;
}

/** The options that need no model call. Pure; exported for tests. */
export const buildMealOptions = (input: BuildMealOptionsInput): MealOption[] => {
  const { mode, slot, current, constraints, dislikes, path } = input;
  const limit = input.limit ?? (mode === "mine" ? 6 : 3);
  const avoid = new Set(input.avoidNames.map((n) => n.trim().toLowerCase()));
  const quickLimit = quickPrepLimit(current.prepTime);
  const options: MealOption[] = [];
  const seen = new Set<string>();
  const add = (option: MealOption) => {
    const key = String(option.meal.name).trim().toLowerCase();
    if (seen.has(key) || sameDish(option.meal.name, current.name)) return;
    seen.add(key);
    options.push(option);
  };

  for (const dish of input.ownDishes) {
    if (!fitsSlot(dish, slot)) continue;
    const meal = dishAsPlanMeal(dish, slot);
    if (!meal) continue;
    // Their own dish is theirs whatever they said about an ingredient, but a
    // hard constraint added since still applies.
    if (findMealViolations(meal, constraints).length) continue;
    if (mode === "quicker" && meal.prepTime > quickLimit) continue;
    add({ meal, source: "own", reason: `Your dish · ${meal.prepTime} min` });
  }

  if (mode === "quicker") {
    const target = Number(current.calories) || 0;
    // Dislikes are a preference: those meals come last, after every other fit.
    const fits = input.libraryCandidates.filter(
      (candidate) =>
        !avoid.has(candidate.name.trim().toLowerCase()) &&
        libraryMealFits(candidate, slot, target, { constraints, path, maxPrepMinutes: quickLimit }) === null,
    );
    const hasDislike = (c: LibraryMeal) => findMealDislikes(c, dislikes).length > 0;
    const ranked = [...fits.filter((c) => !hasDislike(c)), ...fits.filter(hasDislike)];
    for (const candidate of ranked) {
      if (options.length >= limit) break;
      const prep = candidate.labels?.prepMinutes ?? candidate.prepTime ?? quickLimit;
      add({
        meal: {
          _id: candidate._id,
          name: candidate.name,
          nameEn: candidate.name,
          category: slot,
          calories: candidate.calories,
          macros: { ...candidate.macros },
          ingredients: candidate.ingredients,
          prepTime: prep,
          done: false,
        },
        source: "library",
        reason: `${prep} min · similar calories`,
      });
    }
  }

  return options.slice(0, limit);
};
