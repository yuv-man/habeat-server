/**
 * Which of last week's dishes the next plan should be told not to repeat.
 *
 * Only dishes the user did *not* eat. A dish they ate at home is exactly what a
 * plan they will follow should be allowed to bring back; excluding it pushed
 * every week toward unfamiliar food (docs/the-repertoire.md §1). A dish they
 * ordered or ate out does not count as eaten at home — the plan is home
 * cooking, and a takeaway is not evidence the user cooks that dish.
 *
 * `done` and `source` live on DailyProgress, not on the plan, so the eaten set
 * is read from progress snapshots. An absent `source` on a ticked meal means
 * the user wasn't asked — the dish was on their plan and they ate it, so it is
 * treated as eaten at home.
 */

type MealLike = { name?: unknown; done?: unknown; source?: unknown } | null | undefined;

interface MealsLike {
  breakfast?: MealLike;
  lunch?: MealLike;
  dinner?: MealLike;
  snacks?: MealLike[];
}

const mealsOf = (meals: MealsLike | undefined): MealLike[] => [
  meals?.breakfast,
  meals?.lunch,
  meals?.dinner,
  ...(Array.isArray(meals?.snacks) ? meals!.snacks! : []),
];

const nameOf = (meal: MealLike): string =>
  typeof meal?.name === "string" ? meal.name.trim() : "";

const keyOf = (name: string): string => name.toLowerCase();

export const isEatenAtHome = (meal: MealLike): boolean =>
  meal?.done === true && meal.source !== "ordered" && meal.source !== "eaten-out";

export const recentMealsToExclude = (
  weeklyPlan: Record<string, any> | null | undefined,
  progressDays: { meals?: MealsLike }[],
  limit = 40,
): string[] => {
  const eaten = new Set<string>();
  for (const day of progressDays) {
    for (const meal of mealsOf(day?.meals)) {
      const name = nameOf(meal);
      if (name && isEatenAtHome(meal)) eaten.add(keyOf(name));
    }
  }

  const names = new Map<string, string>();
  for (const day of Object.values(weeklyPlan ?? {})) {
    for (const meal of mealsOf(day?.meals ?? day)) {
      const name = nameOf(meal);
      if (name && !eaten.has(keyOf(name)) && !names.has(keyOf(name))) {
        names.set(keyOf(name), name);
      }
    }
  }

  return [...names.values()].slice(0, limit);
};
