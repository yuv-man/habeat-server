/**
 * Persisting generated meals into the shared `meals` collection.
 *
 * Plan meals need a real row for anything that references a meal by id to work:
 * favourites resolve against `meals` (user.service.ts), and so does recipe
 * lookup. A meal that exists only inside a plan document cannot be favourited
 * and its recipe 404s.
 *
 * Writes are deduplicated on a content signature so that regenerating a plan
 * every week does not grow the collection without bound — a repeated dish
 * increments `analytics.timesGenerated` on the existing row instead.
 *
 * plan.service.ts has had an equivalent private `ensureMealInDB` for the
 * meal-swap and add-snack paths; this is the shared implementation so the
 * weekly generator behaves identically rather than inventing a second scheme.
 */

import crypto from "crypto";
import { Model } from "mongoose";
import { IMeal } from "../types/interfaces";
import logger from "./logger";

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Content hash of a meal: same dish at the same size collapses to one row,
 * regardless of which user generated it or when.
 */
export const calculateMealSignature = (meal: any): string => {
  const ingredientsStr = Array.isArray(meal.ingredients)
    ? meal.ingredients
        .map((ing: any) => (Array.isArray(ing) ? ing[0] : ing))
        .sort()
        .join("_")
    : "";
  const key = `${meal.category}_${meal.calories}_${meal.macros?.protein || 0}_${ingredientsStr}`;
  return crypto.createHash("md5").update(key).digest("hex");
};

/**
 * Return the meal with a stable `_id` from the `meals` collection, creating the
 * row if this dish has not been seen before.
 *
 * Never throws: a persistence failure must not lose the user's plan, so the
 * caller gets the meal back regardless and simply keeps whatever id it had.
 */
export const ensureMealPersisted = async (
  mealModel: Model<IMeal>,
  meal: any,
): Promise<any> => {
  if (!meal?.name) return meal;

  const signature = calculateMealSignature(meal);

  try {
    const existing = await mealModel
      .findOne({
        $or: [
          { "analytics.signature": signature },
          {
            name: { $regex: new RegExp(`^${escapeRegex(meal.name)}$`, "i") },
            category: meal.category,
            calories: {
              $gte: (meal.calories || 0) - 50,
              $lte: (meal.calories || 0) + 50,
            },
          },
        ],
      })
      .lean()
      .exec();

    if (existing) {
      await mealModel.findByIdAndUpdate((existing as any)._id, {
        $inc: { "analytics.timesGenerated": 1 },
      });
      return { ...meal, _id: (existing as any)._id.toString() };
    }

    const created = await mealModel.create({
      name: meal.name,
      category: meal.category,
      calories: meal.calories || 0,
      macros: meal.macros || { protein: 0, carbs: 0, fat: 0 },
      prepTime: meal.prepTime,
      ingredients: meal.ingredients || [],
      aiGenerated: true,
      analytics: { timesGenerated: 1, signature },
    } as any);

    return { ...meal, _id: (created as any)._id.toString() };
  } catch (err) {
    logger.warn(
      `[ensureMealPersisted] Could not persist "${meal.name}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return meal;
  }
};
