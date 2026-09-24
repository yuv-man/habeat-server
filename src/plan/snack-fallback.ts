import { IngredientNutrition } from "../utils/usda-nutrition.service";

/**
 * Nutrition for a snack the user logged when the model couldn't estimate it.
 *
 * A snack someone took the trouble to log must never be thrown away because a
 * model was busy — "chocolate in front of the TV at 22:30" is exactly the entry
 * the Brain needs, and a rough number beats a lost one. So: a USDA lookup of
 * the name at a typical snack portion, and failing that a typical snack.
 * Either way the result is marked `estimated` and kept out of the shared meal
 * cache, so a guess never becomes the answer for everyone who logs that name.
 */

/** USDA reports per 100 g; a snack is closer to half that. */
export const SNACK_PORTION = "50g";

/** A typical packaged snack (a small bar, a handful of crackers). */
export const GENERIC_SNACK = {
  calories: 200,
  macros: { protein: 5, carbs: 24, fat: 9 },
};

const MIN_KCAL = 50;
const MAX_KCAL = 600;

export interface SnackEstimate {
  calories: number;
  macros: { protein: number; carbs: number; fat: number };
  ingredients: [string, string, string?][];
  source: "usda" | "generic";
}

export async function estimateSnackFallback(
  snackName: string,
  lookup: (name: string, amount: string) => Promise<IngredientNutrition | null>
): Promise<SnackEstimate> {
  let usda: IngredientNutrition | null = null;
  try {
    usda = await lookup(snackName, SNACK_PORTION);
  } catch {
    usda = null;
  }

  // A zero or absurd match ("chocolate" → cocoa powder, "tv" → nothing) is
  // worse than the generic snack, not better.
  if (usda && usda.calories >= MIN_KCAL && usda.calories <= MAX_KCAL) {
    return {
      calories: usda.calories,
      macros: { ...usda.macros },
      ingredients: [[snackName, SNACK_PORTION]],
      source: "usda",
    };
  }

  return {
    calories: GENERIC_SNACK.calories,
    macros: { ...GENERIC_SNACK.macros },
    ingredients: [[snackName, "1 portion"]],
    source: "generic",
  };
}
