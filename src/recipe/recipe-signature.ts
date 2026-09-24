import crypto from "crypto";

/**
 * What makes two plan meals the same dish, for recipe purposes: the name and
 * the ingredients, not the amounts (portions are scaled per person) and not
 * the id (every generated meal gets a new one). Two users with "Chicken
 * schnitzel" of chicken, egg and breadcrumbs share one recipe.
 */
export const recipeSignature = (meal: { name?: string; ingredients?: unknown[] }): string => {
  const name = String(meal?.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const ingredients = Array.from(
    new Set(
      (Array.isArray(meal?.ingredients) ? meal.ingredients : [])
        .map((i) => (Array.isArray(i) ? i[0] : String(i ?? "").split("|")[0]))
        .map((n) => String(n ?? "").trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ).sort();
  return crypto.createHash("sha1").update(`${name}|${ingredients.join(",")}`).digest("hex");
};
