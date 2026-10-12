/**
 * What we know about a user's food, from one place.
 *
 * The weekly planner, the chat assistant, quick meals and the swap options
 * each used to read the user record their own way: the planner honoured
 * dislikes, the assistant only mentioned them, quick meals never checked, and
 * nothing at all used what the user had actually eaten. They all ask this now.
 *
 * Order of authority, highest first:
 *   1. Hard constraints — allergies and dietary restrictions. Never broken.
 *   2. Explicit dislikes — what the user told us.
 *   3. Learned avoidance — dishes they turned down (meal-learning.ts rules).
 *   4. Learned enjoyment — dishes they ate again, or chose and then ate.
 * A learned signal never overrides an explicit one: a dish they ate twice
 * stays out if it now contains something they've said they dislike.
 */
import { DietaryConstraints, findMealViolations, resolveDietaryConstraints } from "../utils/dietary-constraints";
import { findDislikesInText } from "../utils/ingredient-match";
import { swapAvoidNames } from "../utils/meal-learning";

/** Eaten this many times before a dish counts as enjoyed. */
export const ENJOYED_AFTER_COMPLETIONS = 2;
/** How many enjoyed dishes to name: enough to steer, few enough for variety. */
const MAX_ENJOYED = 6;

export interface MealPreferences {
  constraints: DietaryConstraints;
  dislikes: string[];
  /** Dishes to keep out because of how the user swapped them. */
  avoidNames: string[];
  /** Dishes the user has shown they like, most evidence first. */
  enjoyed: Array<{ name: string; evidence: string }>;
}

export interface PreferenceSource {
  dietaryRestrictions?: string[];
  allergies?: string[];
  dislikes?: string[];
  mealLearningProfile?: {
    completedMeals?: Array<{ name: string; count: number }>;
    selectedMeals?: Array<{ name: string; count: number }>;
    swappedMeals?: Array<{ name: string; count: number; dislikes?: number; unexplained?: number }>;
  } | null;
}

const key = (name: string) => name.trim().toLowerCase();

export const resolveMealPreferences = (user: PreferenceSource | null | undefined): MealPreferences => {
  const constraints = resolveDietaryConstraints(user ?? {});
  const dislikes = (user?.dislikes ?? []).filter((d) => String(d ?? "").trim());
  const profile = user?.mealLearningProfile ?? {};
  const avoidNames = swapAvoidNames(profile as any);
  const avoid = new Set(avoidNames.map(key));

  const selected = new Map((profile.selectedMeals ?? []).map((m) => [key(m.name), m.count]));
  const candidates: Array<{ name: string; evidence: string; weight: number }> = [];
  for (const meal of profile.completedMeals ?? []) {
    const picked = selected.get(key(meal.name)) ?? 0;
    // Eaten twice, or chosen as a replacement and then eaten: either is the
    // user acting on a preference. A plan meal eaten once is just following
    // the plan.
    if (meal.count < ENJOYED_AFTER_COMPLETIONS && picked < 1) continue;
    candidates.push({
      name: meal.name,
      evidence: picked ? `chosen ${picked}×, eaten ${meal.count}×` : `eaten ${meal.count}×`,
      weight: meal.count + picked,
    });
  }

  const enjoyed = candidates
    .filter(
      (c) =>
        !avoid.has(key(c.name)) &&
        findDislikesInText(c.name, dislikes).length === 0 &&
        findMealViolations({ name: c.name }, constraints).length === 0,
    )
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_ENJOYED)
    .map(({ name, evidence }) => ({ name, evidence }));

  return { constraints, dislikes, avoidNames, enjoyed };
};

/**
 * The learned half, as a prompt section. Empty when there is nothing learned,
 * so a new user's prompt is unchanged.
 */
export const learnedPreferencesSection = (prefs: MealPreferences): string => {
  const lines: string[] = [];
  if (prefs.enjoyed.length) {
    lines.push(
      `- Dishes they keep coming back to (${prefs.enjoyed.map((e) => `${e.name} — ${e.evidence}`).join("; ")}). ` +
        `Bring back one or two of these this week, or close relatives of them. Not all of them: keep variety.`,
    );
  }
  if (prefs.avoidNames.length) {
    lines.push(`- Dishes they turned down — do not serve these: ${prefs.avoidNames.slice(0, 15).join(", ")}.`);
  }
  if (!lines.length) return "";
  return `LEARNED FROM THIS USER'S OWN CHOICES (explicit restrictions and dislikes above still win):\n${lines.join("\n")}`;
};
