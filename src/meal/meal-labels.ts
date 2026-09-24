/**
 * Labels on library meals, so a plan can take meals from the library instead
 * of paying the model to write each one.
 *
 * Worked out in code, never asked of a model: diets from the same rules the
 * generator is checked against (utils/dietary-constraints.ts), so a label can
 * never disagree with the check that guards a user's plan; the rest from the
 * meal's own numbers and ingredients.
 */
import {
  DIETARY_RULES,
  findMealViolations,
  resolveDietaryConstraints,
} from "../utils/dietary-constraints";

/** Bump when the labels change shape or meaning; older ones are recomputed. */
export const MEAL_LABELS_VERSION = 1;

export interface MealLabels {
  version: number;
  /** Dietary rule ids this meal satisfies ("vegan", "gluten-free", ...). */
  fits: string[];
  /** Main proteins found in the ingredients, in the generator's vocabulary. */
  proteins: string[];
  /** Share of calories from each macro, 0–1. */
  proteinShare: number;
  carbShare: number;
  fatShare: number;
  highProtein: boolean;
  lowCarb: boolean;
  /** Under 20 g of carbs. */
  keto: boolean;
  prepMinutes: number | null;
  /** Normalised ingredient names, for dislike checks without re-parsing. */
  ingredientNames: string[];
}

/** Protein words → the protein they stand for. First match wins per ingredient. */
const PROTEINS: [RegExp, string][] = [
  [/chicken/, "chicken"],
  [/turkey/, "turkey"],
  [/\bbeef\b|steak|sirloin|ribeye|brisket|ground beef/, "beef"],
  [/\bpork\b|bacon|\bham\b/, "pork"],
  [/\blamb\b/, "lamb"],
  [/salmon/, "salmon"],
  [/tuna/, "tuna"],
  [/\bcod\b|haddock|tilapia|white fish|sea bass|\btrout\b|\bfish\b/, "white fish"],
  [/shrimp|prawn/, "shrimp"],
  [/\begg/, "eggs"],
  [/tofu/, "tofu"],
  [/tempeh/, "tempeh"],
  [/lentil/, "lentils"],
  [/chickpea|hummus/, "chickpeas"],
  [/\bbeans?\b|black bean|kidney bean/, "beans"],
  [/greek yogurt|yoghurt|yogurt/, "yogurt"],
  [/cottage cheese/, "cottage cheese"],
  [/whey|protein powder/, "protein powder"],
];

const ingredientName = (i: unknown): string =>
  String(Array.isArray(i) ? i[0] : String(i ?? "").split("|")[0])
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const computeMealLabels = (meal: {
  name?: string;
  calories?: number;
  macros?: { protein?: number; carbs?: number; fat?: number };
  ingredients?: unknown[];
  prepTime?: number | null;
}): MealLabels => {
  const ingredientNames = Array.from(
    new Set((meal.ingredients ?? []).map(ingredientName).filter(Boolean)),
  );

  const fits = DIETARY_RULES.filter(
    (rule) =>
      findMealViolations(
        meal,
        resolveDietaryConstraints({ dietaryRestrictions: [rule.label], allergies: [] }),
      ).length === 0,
  ).map((rule) => rule.id);

  const text = [String(meal.name ?? "").toLowerCase(), ...ingredientNames].join(" | ");
  const proteins = Array.from(
    new Set(PROTEINS.filter(([re]) => re.test(text)).map(([, p]) => p)),
  );

  const p = Number(meal.macros?.protein) || 0;
  const c = Number(meal.macros?.carbs) || 0;
  const f = Number(meal.macros?.fat) || 0;
  const kcal = p * 4 + c * 4 + f * 9 || Number(meal.calories) || 1;
  const proteinShare = (p * 4) / kcal;
  const carbShare = (c * 4) / kcal;
  const fatShare = (f * 9) / kcal;

  return {
    version: MEAL_LABELS_VERSION,
    fits,
    proteins,
    proteinShare: Math.round(proteinShare * 100) / 100,
    carbShare: Math.round(carbShare * 100) / 100,
    fatShare: Math.round(fatShare * 100) / 100,
    highProtein: proteinShare >= 0.3,
    lowCarb: carbShare <= 0.25,
    keto: c > 0 && c <= 20,
    prepMinutes: typeof meal.prepTime === "number" && meal.prepTime > 0 ? meal.prepTime : null,
    ingredientNames,
  };
};
