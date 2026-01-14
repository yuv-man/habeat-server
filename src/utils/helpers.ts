import {
  IMeal,
  IRecipe,
  IDailyPlan,
  IWeeklyPlanObject,
  IAIMealData,
  IAIDayData,
  IParsedWeeklyPlanResponse,
  IWorkout,
  IMealWithStatus,
  IUserData,
} from "../types/interfaces";
import { ingredientCategories } from "./ingredientCategories";
import mongoose from "mongoose";
import logger from "./logger";

// ============================================================================
// INGREDIENT CONVERSION HELPERS
// ============================================================================

/**
 * Meal ingredient format: [name, amountWithUnit] or [name, amountWithUnit, shoppingCategory]
 * - name: ingredient name (e.g., "chicken_breast")
 * - amountWithUnit: amount and unit combined (e.g., "200 g")
 * - shoppingCategory: optional shopping bag category (e.g., "Proteins", "Grains", "Fruits")
 *
 * Examples:
 * - ["chicken_breast", "200 g"]
 * - ["chicken_breast", "200 g", "Proteins"]
 * - ["rice", "100 g", "Grains"]
 */
export type MealIngredient = [string, string] | [string, string, string?];

/**
 * AI Service ingredient format for recipe generation: [name, amount, unit]
 * - name: ingredient name
 * - amount: numeric amount as string (e.g., "200")
 * - unit: measurement unit (e.g., "g", "ml", "piece")
 *
 * Example: ["chicken_breast", "200", "g"]
 */
export type AIIngredient = [string, string, string?];

/**
 * Recipe ingredient format (for recipe model): { name, amount, unit }
 * Example: { name: "chicken_breast", amount: "200", unit: "g" }
 */
export interface RecipeIngredient {
  name: string;
  amount: string;
  unit: string;
}

/**
 * Convert meal ingredients to AI service format for recipe generation
 * Splits the combined "amount unit" string into separate amount and unit
 *
 * Meal format: [name, "200 g", "Proteins"] (category is ignored)
 * AI format: [name, "200", "g"]
 */
export const convertMealIngredientsToAIFormat = (
  ingredients: MealIngredient[]
): AIIngredient[] => {
  if (!ingredients || !Array.isArray(ingredients)) return [];

  return ingredients.map((ing) => {
    const name = ing[0] || "";
    const amountWithUnit = ing[1] || "";
    // Note: ing[2] is shopping category (e.g., "Proteins"), not unit - we ignore it here

    // Parse "200 g" or "200g" or "2 pieces" into amount and unit
    const match = amountWithUnit.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      const amount = match[1];
      const unit = match[2].trim() || "piece";
      return [name, amount, unit] as AIIngredient;
    }

    // If no numeric match, try to handle cases like "2 large" or just text
    return [name, "1", amountWithUnit || "piece"] as AIIngredient;
  });
};

/**
 * Convert AI service/recipe ingredients to meal model format
 * Combines separate amount and unit into single "amount unit" string
 *
 * AI format: [name, "200", "g"] or { name, amount, unit }
 * Meal format: [name, "200 g"]
 *
 * @param ingredients - Array of AI ingredients or recipe ingredients
 * @param defaultCategory - Optional default shopping category to add
 */
export const convertAIIngredientsToMealFormat = (
  ingredients: (AIIngredient | RecipeIngredient | string)[],
  defaultCategory?: string
): MealIngredient[] => {
  if (!ingredients || !Array.isArray(ingredients)) return [];

  return ingredients.map((ing) => {
    if (Array.isArray(ing)) {
      // AI tuple format: [name, amount, unit]
      const name = ing[0] || "";
      const amount = ing[1] || "";
      const unit = ing[2] || "";
      // Combine amount and unit: "200" + "g" = "200 g"
      const combinedAmount = unit ? `${amount} ${unit}`.trim() : amount;

      if (defaultCategory) {
        return [name, combinedAmount, defaultCategory] as MealIngredient;
      }
      return [name, combinedAmount] as MealIngredient;
    } else if (typeof ing === "object" && ing !== null) {
      // Recipe object format: { name, amount, unit }
      const objIng = ing as RecipeIngredient;
      const name = objIng.name || "";
      const amount = objIng.amount || "";
      const unit = objIng.unit || "";
      const combinedAmount = unit ? `${amount} ${unit}`.trim() : amount;

      if (defaultCategory) {
        return [name, combinedAmount, defaultCategory] as MealIngredient;
      }
      return [name, combinedAmount] as MealIngredient;
    } else if (typeof ing === "string") {
      // String format - try to parse "name (amount unit)"
      const match = ing.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (match) {
        if (defaultCategory) {
          return [
            match[1].trim(),
            match[2].trim(),
            defaultCategory,
          ] as MealIngredient;
        }
        return [match[1].trim(), match[2].trim()] as MealIngredient;
      }
      if (defaultCategory) {
        return [ing, "", defaultCategory] as MealIngredient;
      }
      return [ing, ""] as MealIngredient;
    }
    return ["", ""] as MealIngredient;
  });
};

/**
 * Convert meal ingredients to recipe model format
 * Parses the combined "amount unit" string into separate fields
 *
 * Meal format: [name, "200 g", "Proteins"] (category is ignored for recipe)
 * Recipe format: { name: "...", amount: "200", unit: "g" }
 */
export const convertMealIngredientsToRecipeFormat = (
  ingredients: MealIngredient[]
): RecipeIngredient[] => {
  if (!ingredients || !Array.isArray(ingredients)) return [];

  return ingredients.map((ing) => {
    const name = ing[0] || "";
    const amountWithUnit = ing[1] || "";
    // Note: ing[2] is shopping category, not relevant for recipe format

    // Parse "200 g" format into separate amount and unit
    const match = amountWithUnit.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      return {
        name,
        amount: match[1],
        unit: match[2].trim() || "piece",
      };
    }

    // Fallback for non-numeric amounts
    return {
      name,
      amount: "1",
      unit: amountWithUnit || "piece",
    };
  });
};

/**
 * Convert AI service ingredients (from AI response) to recipe model format
 * Handles both AI tuple format and already-parsed recipe objects
 *
 * AI format: [name, "200", "g"]
 * Recipe format: { name, amount, unit }
 */
export const convertAIIngredientsToRecipeFormat = (
  ingredients: (AIIngredient | RecipeIngredient | string)[]
): RecipeIngredient[] => {
  if (!ingredients || !Array.isArray(ingredients)) return [];

  return ingredients.map((ing) => {
    if (Array.isArray(ing)) {
      const name = ing[0] || "";
      const amountOrCombined = ing[1] || "";
      const unitOrCategory = ing[2];

      // Check if amount is purely numeric (AI format: [name, "200", "g"])
      const isNumericAmount = /^\d+(?:\.\d+)?$/.test(amountOrCombined.trim());

      if (isNumericAmount && unitOrCategory) {
        // AI format with separate unit
        return {
          name,
          amount: amountOrCombined,
          unit: unitOrCategory,
        };
      }

      // Meal format: [name, "200 g", "Proteins"] - parse the combined amount
      const match = amountOrCombined.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
      if (match) {
        return {
          name,
          amount: match[1],
          unit: match[2].trim() || "piece",
        };
      }

      return {
        name,
        amount: "1",
        unit: amountOrCombined || "piece",
      };
    } else if (typeof ing === "object" && ing !== null) {
      // Already in recipe format
      const objIng = ing as RecipeIngredient;
      return {
        name: objIng.name || "",
        amount: objIng.amount || "1",
        unit: objIng.unit || "piece",
      };
    } else if (typeof ing === "string") {
      // String format - try to parse "name (amount unit)"
      const match = ing.match(/^(.+?)\s*\((\d+(?:\.\d+)?)\s*(\w*)\)$/);
      if (match) {
        return {
          name: match[1].trim(),
          amount: match[2],
          unit: match[3] || "piece",
        };
      }
      return {
        name: ing,
        amount: "1",
        unit: "piece",
      };
    }
    return { name: "", amount: "1", unit: "piece" };
  });
};

/**
 * Convert recipe ingredients to meal model format
 * Combines separate amount and unit into single "amount unit" string
 *
 * Recipe format: { name, amount, unit }
 * Meal format: [name, "200 g"]
 */
export const convertRecipeIngredientsToMealFormat = (
  ingredients: RecipeIngredient[]
): MealIngredient[] => {
  if (!ingredients || !Array.isArray(ingredients)) return [];

  return ingredients.map((ing) => {
    const name = ing.name || "";
    const amount = ing.amount || "";
    const unit = ing.unit || "";
    const combinedAmount = unit ? `${amount} ${unit}`.trim() : amount;
    return [name, combinedAmount] as MealIngredient;
  });
};

// ============================================================================
// END INGREDIENT CONVERSION HELPERS
// ============================================================================

// Helper to get Meal model at runtime (after NestJS has registered it)
const getMealModel = () => mongoose.model("Meal");

// Helper to escape special regex characters to prevent regex injection attacks
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Helper to get local date key in YYYY-MM-DD format (avoids timezone issues with toISOString which uses UTC)
export const getLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper to parse numeric values from various formats (e.g., "10 minutes", "10 mins", "10", 10) to a number
// Works for prepTime, duration, caloriesBurned, etc.
export const parseNumericValue = (
  value: any,
  defaultValue: number = 0
): number => {
  if (typeof value === "number") {
    return Math.round(value);
  }
  if (typeof value === "string") {
    // Extract first number from string like "10 minutes", "60 mins", "300 calories"
    const match = value.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return defaultValue;
};

// Alias for backward compatibility and clarity
export const parsePrepTime = (prepTime: any): number =>
  parseNumericValue(prepTime, 0);
export const parseDuration = (duration: any): number =>
  parseNumericValue(duration, 0);
export const parseCalories = (calories: any): number =>
  parseNumericValue(calories, 0);

// Helper to get valid ObjectId (replace manual/invalid IDs with real ones)
// Handles cases like "manual-123456" or "temp-789" from client
export const getValidObjectId = (id: any): mongoose.Types.ObjectId => {
  if (!id) return new mongoose.Types.ObjectId();
  // Check if it's already a valid ObjectId
  if (mongoose.Types.ObjectId.isValid(id)) {
    // Also check it's not a manual/temp ID
    const idStr = id.toString();
    if (idStr.startsWith("manual-") || idStr.startsWith("temp-")) {
      return new mongoose.Types.ObjectId();
    }
    return new mongoose.Types.ObjectId(id);
  }
  return new mongoose.Types.ObjectId();
};

// Calculate extra water glasses based on workout calories and time
// Time affects hydration needs:
// - Early morning (before 09:00): 1.5x - full day to rehydrate
// - Morning (09:00-12:00): 1.25x
// - Afternoon (12:00-17:00): 1.0x (base)
// - Evening (17:00-21:00): 0.75x - less time remaining
// Calculate extra water glasses needed for a workout
// Simple formula: 1 glass per 250 calories, max 2 glasses per workout
export const calculateWorkoutWaterGlasses = (
  caloriesBurned: number,
  time?: string
): number => {
  if (!caloriesBurned || caloriesBurned <= 0) {
    return 0;
  }

  // 1 glass per 250 calories, minimum 1 for any workout, maximum 2
  const glasses = Math.ceil(caloriesBurned / 250);
  return Math.min(2, Math.max(1, glasses));
};

// Calculate total extra water for all workouts in a day
// Maximum 4 extra glasses per day from workouts
export const calculateDayWorkoutWater = (
  workouts: Array<{ caloriesBurned?: number; time?: string }>
): number => {
  if (!workouts || workouts.length === 0) return 0;

  const totalWorkoutWater = workouts.reduce((total, workout) => {
    const calories = parseCalories(workout.caloriesBurned);
    return total + calculateWorkoutWaterGlasses(calories, workout.time);
  }, 0);

  // Cap total workout water at 4 glasses per day
  return Math.min(4, totalWorkoutWater);
};

// Calculate base water intake from AI response
// Handles different formats: ml (2000), glasses (8), or liters (2.5)
// Returns number of glasses (250ml each)
export const calculateBaseWaterGlasses = (waterTarget: any): number => {
  const DEFAULT_GLASSES = 8; // Default: 8 glasses = 2L
  const MIN_GLASSES = 6;
  const MAX_GLASSES = 8; // Maximum base intake: 8 glasses (workout water is added separately)

  if (waterTarget === undefined || waterTarget === null) {
    return DEFAULT_GLASSES;
  }

  const numericValue =
    typeof waterTarget === "number"
      ? waterTarget
      : parseFloat(String(waterTarget));

  if (isNaN(numericValue) || numericValue <= 0) {
    return DEFAULT_GLASSES;
  }

  let glasses: number;

  // Determine the format based on value ranges:
  // - < 20: likely glasses (8, 10, 12)
  // - 20-100: likely incorrect or edge case, treat as glasses but cap
  // - > 100: likely ml (2000, 2500, 3000)
  if (numericValue < 20) {
    // Already in glasses
    glasses = Math.round(numericValue);
  } else if (numericValue <= 100) {
    // Ambiguous range - could be high glass count or low ml
    // Treat as glasses but apply max cap
    glasses = Math.round(numericValue);
  } else {
    // In milliliters - convert to glasses (250ml per glass)
    glasses = Math.round(numericValue / 250);
  }

  // Apply reasonable bounds - cap base at 8 glasses
  // Workout water will be added separately
  return Math.min(MAX_GLASSES, Math.max(MIN_GLASSES, glasses));
};

export interface MealPlanResponse {
  mealPlan: {
    weeklyPlan: IDailyPlan[] | IWeeklyPlanObject;
  };
  planType: "daily" | "weekly";
  language: string;
  generatedAt: string;
  fallbackModel?: string;
}

export const formatRecipeForResponse = (recipe: IRecipe) => {
  return `## ${recipe.mealName.toUpperCase()}
  
    ### NUTRITION INFO (per serving)
    - Calories: ${recipe.macros?.calories || "N/A"}
    - Protein: ${recipe.macros?.protein || "N/A"}g
    - Carbohydrates: ${recipe.macros?.carbs || "N/A"}g
    - Fat: ${recipe.macros?.fat || "N/A"}g
    
    ### PREP & COOK TIME
    - Prep Time: ${recipe.prepTime || "N/A"} minutes
    - Cook Time: ${recipe.cookTime || "N/A"} minutes
    - Difficulty: ${recipe.difficulty || "Medium"}
    
    ### INGREDIENTS
    ${
      recipe.ingredients
        ?.map(
          (ing: any) =>
            `- ${ing.amount} ${ing.unit} ${ing.name}${ing.notes ? ` (${ing.notes})` : ""}`
        )
        .join("\n") || "Ingredients not available"
    }
    
    ### EQUIPMENT NEEDED
    ${recipe.equipment?.map((eq: string) => `- ${eq}`).join("\n") || "- Basic kitchen equipment"}
    
    ### INSTRUCTIONS
    ${
      recipe.instructions
        ?.map(
          (inst: any) =>
            `${inst.step}. ${inst.instruction}${inst.time ? ` (${inst.time} minutes)` : ""}${inst.temperature ? ` at ${inst.temperature}°C` : ""}`
        )
        .join("\n") || "Instructions not available"
    }
    `;
};

export const processMealForIngredients = async (
  meal: IMeal,
  plan: any,
  allIngredients: string[],
  mealsToGenerate: string[]
) => {
  // Add to list of meals that need ingredient generation
  if (meal.ingredients && Array.isArray(meal.ingredients)) {
    // If meal already has ingredients, use them
    const ingredientNames = meal.ingredients.map((ing: any) =>
      typeof ing === "string" ? ing : ing[0] || ing.name || ""
    );
    allIngredients.push(...ingredientNames.filter(Boolean));
  } else {
    // Add to list of meals that need ingredient generation
    mealsToGenerate.push(meal.name);
  }
};

// Parse ingredient string like "greek_yogurt_2%_fat (200 g)" into name, amount, unit
const parseIngredientString = (
  str: string
): { name: string; amount: number; unit: string } => {
  // Match pattern: "name (amount unit)" or "name (amount)"
  const match = str.match(/^(.+?)\s*\((\d+(?:\.\d+)?)\s*(\w*)\)$/);
  if (match) {
    return {
      name: match[1].trim(),
      amount: parseFloat(match[2]),
      unit: match[3] || "",
    };
  }
  // No amount found, return name only
  return { name: str.trim(), amount: 0, unit: "" };
};

// Merge duplicate ingredients by adding amounts (same name + same unit)
const mergeIngredients = (items: string[]): string[] => {
  const merged: Map<string, { amount: number; unit: string }> = new Map();

  items.forEach((item) => {
    const { name, amount, unit } = parseIngredientString(item);
    const key = `${name}|${unit.toLowerCase()}`; // Group by name + unit

    if (merged.has(key)) {
      const existing = merged.get(key)!;
      existing.amount += amount;
    } else {
      merged.set(key, { amount, unit });
    }
  });

  // Convert back to string format
  const result: string[] = [];
  merged.forEach(({ amount, unit }, key) => {
    const name = key.split("|")[0];
    if (amount > 0) {
      const formattedAmount =
        amount % 1 === 0 ? amount.toString() : amount.toFixed(1);
      result.push(
        unit
          ? `${name} (${formattedAmount} ${unit})`
          : `${name} (${formattedAmount})`
      );
    } else {
      result.push(name);
    }
  });

  return result;
};

export const organizeIngredients = (
  ingredients: string[] | [string, string][] | [string, string, string?][]
): string => {
  const organized: { [key: string]: string[] } = {};

  // Process ingredients - handle both string array and tuple formats
  ingredients.forEach((ingredient) => {
    let ingredientName: string;
    let ingredientAmount: string;
    let ingredientCategory: string | undefined;

    // Handle tuple format [name, amount, category?]
    if (Array.isArray(ingredient)) {
      ingredientName = ingredient[0];
      ingredientAmount = ingredient[1] || "";
      ingredientCategory = ingredient[2]; // Optional category
    } else if (typeof ingredient === "string") {
      // Legacy string format - try to extract name and amount if in "name|amount" format
      const parts = ingredient.split("|");
      ingredientName = parts[0].trim();
      ingredientAmount = parts[1]?.trim() || "";
      ingredientCategory = parts[2]; // Optional category from string format
    } else {
      ingredientName = String(ingredient);
      ingredientAmount = "";
      ingredientCategory = undefined;
    }

    // Format ingredient display: "name (amount)" or just "name"
    const displayName = ingredientAmount
      ? `${ingredientName} (${ingredientAmount})`
      : ingredientName;

    // Use stored category if available, otherwise fall back to keyword matching
    let category: string | undefined = ingredientCategory;

    if (!category) {
      // Fall back to keyword matching
      for (const [cat, keywords] of Object.entries(ingredientCategories)) {
        if (
          keywords.some((keyword) =>
            ingredientName.toLowerCase().includes(keyword.toLowerCase())
          )
        ) {
          category = cat;
          break;
        }
      }
    }

    // Validate category is one of the known categories
    const validCategories = Object.keys(ingredientCategories);
    if (category && !validCategories.includes(category)) {
      category = undefined; // Invalid category, fall back to keyword matching
    }

    if (!category) {
      category = "Other";
    }

    if (!organized[category]) organized[category] = [];
    organized[category].push(displayName);
  });

  // Format the organized list with merged duplicates
  let result = "# SHOPPING LIST\n\n";
  for (const [category, items] of Object.entries(organized)) {
    if (items.length > 0) {
      // Merge duplicate ingredients within each category
      const mergedItems = mergeIngredients(items);
      result += `## ${category.toUpperCase()}\n`;
      mergedItems.forEach((item) => {
        result += `- ${item}\n`;
      });
      result += "\n";
    }
  }

  return result;
};

// Progress calculation utilities
export const calculateProgressPercentage = (
  current: number,
  goal: number
): number => {
  if (goal === 0) return 0;
  return Math.min(Math.round((current / goal) * 100), 100);
};

export const calculateCalorieDeficit = (
  consumed: number,
  goal: number
): number => {
  return goal - consumed;
};

export const calculateMealCompletionRate = (meals: {
  breakfast: any;
  lunch: any;
  dinner: any;
  snacks: any[];
}): number => {
  const totalMeals = 3; // breakfast, lunch, dinner
  const completedMainMeals = [
    meals.breakfast?.done,
    meals.lunch?.done,
    meals.dinner?.done,
  ].filter(Boolean).length;

  return Math.round((completedMainMeals / totalMeals) * 100);
};

export const getProgressStatus = (percentage: number): string => {
  if (percentage >= 90) return "excellent";
  if (percentage >= 75) return "good";
  if (percentage >= 50) return "fair";
  return "needs_improvement";
};

export const formatProgressStats = (progress: any) => {
  return {
    calories: {
      consumed: progress.caloriesConsumed,
      goal: progress.caloriesGoal,
      percentage: calculateProgressPercentage(
        progress.caloriesConsumed,
        progress.caloriesGoal
      ),
      deficit: calculateCalorieDeficit(
        progress.caloriesConsumed,
        progress.caloriesGoal
      ),
      status: getProgressStatus(
        calculateProgressPercentage(
          progress.caloriesConsumed,
          progress.caloriesGoal
        )
      ),
    },
    macros: {
      protein: {
        consumed: progress.protein.consumed,
        goal: progress.protein.goal,
        percentage: calculateProgressPercentage(
          progress.protein.consumed,
          progress.protein.goal
        ),
      },
      carbs: {
        consumed: progress.carbs.consumed,
        goal: progress.carbs.goal,
        percentage: calculateProgressPercentage(
          progress.carbs.consumed,
          progress.carbs.goal
        ),
      },
      fat: {
        consumed: progress.fat.consumed,
        goal: progress.fat.goal,
        percentage: calculateProgressPercentage(
          progress.fat.consumed,
          progress.fat.goal
        ),
      },
    },
    water: {
      consumed: progress.water.consumed,
      goal: progress.water.goal,
      percentage: calculateProgressPercentage(
        progress.water.consumed,
        progress.water.goal
      ),
      status: getProgressStatus(
        calculateProgressPercentage(
          progress.water.consumed,
          progress.water.goal
        )
      ),
    },
    workouts: {
      completed: progress.workouts.filter((w: any) => w.done).length,
      goal: progress.workouts.length,
      percentage: calculateProgressPercentage(
        progress.workouts.filter((w: any) => w.done).length,
        progress.workouts.length
      ),
      status: getProgressStatus(
        calculateProgressPercentage(
          progress.workouts.filter((w: any) => w.done).length,
          progress.workouts.length
        )
      ),
    },
    meals: {
      completed: {
        breakfast: progress.meals.breakfast?.done || false,
        lunch: progress.meals.lunch?.done || false,
        dinner: progress.meals.dinner?.done || false,
        snacks: progress.meals.snacks.filter((s: any) => s.done).length,
      },
      details: {
        breakfast: progress.meals.breakfast
          ? {
              name: progress.meals.breakfast.name,
              calories: progress.meals.breakfast.calories,
              macros: progress.meals.breakfast.macros,
              prepTime: progress.meals.breakfast.prepTime,
              done: progress.meals.breakfast.done,
            }
          : null,
        lunch: progress.meals.lunch
          ? {
              name: progress.meals.lunch.name,
              calories: progress.meals.lunch.calories,
              macros: progress.meals.lunch.macros,
              prepTime: progress.meals.lunch.prepTime,
              done: progress.meals.lunch.done,
            }
          : null,
        dinner: progress.meals.dinner
          ? {
              name: progress.meals.dinner.name,
              calories: progress.meals.dinner.calories,
              macros: progress.meals.dinner.macros,
              prepTime: progress.meals.dinner.prepTime,
              done: progress.meals.dinner.done,
            }
          : null,
        snacks: progress.meals.snacks.map((s: any) => ({
          name: s.name,
          calories: s.calories,
          macros: s.macros,
          prepTime: s.prepTime,
          done: s.done,
        })),
      },
      completionRate: calculateMealCompletionRate(progress.meals),
      status: getProgressStatus(calculateMealCompletionRate(progress.meals)),
    },
    exercise: {
      minutes: progress.workouts.reduce(
        (total: number, w: any) => total + (w.done ? w.duration : 0),
        0
      ),
      workouts: progress.workouts.filter((w: any) => w.done).length,
      details: progress.workouts.map((w: any) => ({
        name: w.name,
        duration: w.duration,
        caloriesBurned: w.caloriesBurned,
        done: w.done,
      })),
    },
  };
};

// Helper function to extract error message
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return "Unknown error";
};

// Helper function to create empty meal
const createEmptyMeal = (category: string): IMealWithStatus => ({
  _id: new mongoose.Types.ObjectId().toString(),
  name: "No meal planned",
  calories: 0,
  macros: { protein: 0, carbs: 0, fat: 0 },
  category: category as any,
  ingredients: [],
  prepTime: 0,
  done: false,
});

// Helper function to expand mixed vegetables
const expandMixedVegetables = (
  ingredientName: string,
  amount: string,
  mealName?: string
): [string, string][] => {
  const normalizedName = ingredientName.toLowerCase().trim();
  if (
    normalizedName.includes("mixed_vegetable") ||
    normalizedName.includes("mixed_veg") ||
    normalizedName === "mixed vegetables"
  ) {
    const isSalad =
      mealName?.toLowerCase().includes("salad") ||
      mealName?.toLowerCase().includes("green");

    const vegetables = isSalad
      ? ["cucumber", "tomato", "carrot", "bell_pepper", "lettuce"]
      : ["carrot", "broccoli", "cauliflower", "bell_pepper", "zucchini"];

    const amountMatch = amount.match(/(\d+(?:\.\d+)?)\s*(.*)/);
    if (amountMatch) {
      const numericAmount = parseFloat(amountMatch[1]);
      const unit = amountMatch[2] || "";
      const perVeg = numericAmount / vegetables.length;
      return vegetables.map(
        (veg) =>
          [veg, `${perVeg.toFixed(1)} ${unit}`.trim()] as [string, string]
      );
    }

    return vegetables.map((veg) => [veg, amount] as [string, string]);
  }

  return [[ingredientName, amount]];
};

const VALID_CATEGORIES = [
  "Proteins",
  "Vegetables",
  "Fruits",
  "Grains",
  "Dairy",
  "Pantry",
  "Spices",
] as const;

// Helper function to parse ingredients
const parseIngredients = (
  ingredients: (string | [string, string] | [string, string, string?])[],
  mealName?: string
): [string, string, string?][] => {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return [];

  const parsed: [string, string, string?][] = [];

  for (const ing of ingredients) {
    let ingredientName: string;
    let amount: string;
    let category: string | undefined;

    if (Array.isArray(ing)) {
      if (ing.length >= 3) {
        ingredientName = ing[0];
        amount = ing[1];
        category = ing[2];
      } else if (ing.length === 2) {
        ingredientName = ing[0];
        amount = ing[1];
        category = undefined;
      } else {
        continue;
      }
    } else if (typeof ing === "string") {
      let cleanIng = ing.replace(/\([^)]*\)/g, "").trim();
      const parts = cleanIng.split("|").map((p) => p.trim());

      if (parts.length >= 2) {
        ingredientName = parts[0].toLowerCase().replace(/\s+/g, "_");

        if (parts.length >= 4) {
          amount = `${parts[1]} ${parts[2]}`.trim();
          const providedCategory = parts[3];
          category = VALID_CATEGORIES.includes(
            providedCategory as (typeof VALID_CATEGORIES)[number]
          )
            ? providedCategory
            : undefined;
        } else if (parts.length === 3) {
          amount = `${parts[1]} ${parts[2]}`.trim();
        } else {
          amount = parts[1];
        }
      } else {
        const match = ing.match(/(.+?)\s*\(([^)]+)\)/);
        if (match) {
          ingredientName = match[1].trim().toLowerCase().replace(/\s+/g, "_");
          amount = match[2];
        } else {
          ingredientName = ing.toLowerCase().replace(/\s+/g, "_");
          amount = "";
        }
      }
    } else {
      ingredientName = String(ing).toLowerCase().replace(/\s+/g, "_");
      amount = "";
    }

    const expanded = expandMixedVegetables(ingredientName, amount, mealName);

    for (const [expName, expAmount] of expanded) {
      parsed.push([expName, expAmount, category]);
    }
  }

  return parsed;
};

// Helper function to clean meal data
/**
 * Validate and correct meal macros based on calories
 * Ensures calories = (protein×4) + (carbs×4) + (fat×9)
 */
export const validateAndCorrectMealMacros = (
  meal: IAIMealData,
  targetCalories?: number,
  targetMacros?: { protein: number; carbs: number; fat: number }
): IAIMealData => {
  if (!meal || !meal.macros) return meal;

  let { protein, carbs, fat } = meal.macros;
  let calories = meal.calories || 0;

  // Calculate actual calories from macros
  const calculatedCalories = protein * 4 + carbs * 4 + fat * 9;

  // If calories don't match macros, adjust macros proportionally
  if (Math.abs(calculatedCalories - calories) > 10) {
    // Recalculate macros to match calories
    const totalMacroCalories = calculatedCalories || calories;
    if (totalMacroCalories > 0) {
      const proteinRatio = (protein * 4) / totalMacroCalories;
      const carbsRatio = (carbs * 4) / totalMacroCalories;
      const fatRatio = (fat * 9) / totalMacroCalories;

      calories = targetCalories || calories || calculatedCalories;
      protein = Math.round((calories * proteinRatio) / 4);
      carbs = Math.round((calories * carbsRatio) / 4);
      fat = Math.round((calories * fatRatio) / 9);
    }
  }

  // If target macros provided, adjust to be closer to targets
  if (targetMacros && targetCalories) {
    const tolerance = 0.15; // 15% tolerance
    const proteinDiff =
      Math.abs(protein - targetMacros.protein) / targetMacros.protein;
    const carbsDiff = Math.abs(carbs - targetMacros.carbs) / targetMacros.carbs;
    const fatDiff = Math.abs(fat - targetMacros.fat) / targetMacros.fat;

    // If macros are too far from target, adjust proportionally
    if (
      proteinDiff > tolerance ||
      carbsDiff > tolerance ||
      fatDiff > tolerance
    ) {
      const adjustment = 0.7; // 70% towards target, 30% keep current
      protein = Math.round(
        protein * (1 - adjustment) + targetMacros.protein * adjustment
      );
      carbs = Math.round(
        carbs * (1 - adjustment) + targetMacros.carbs * adjustment
      );
      fat = Math.round(fat * (1 - adjustment) + targetMacros.fat * adjustment);

      // Recalculate calories from adjusted macros
      calories = protein * 4 + carbs * 4 + fat * 9;
    }
  }

  return {
    ...meal,
    calories: Math.round(calories),
    macros: {
      protein: Math.max(0, Math.round(protein)),
      carbs: Math.max(0, Math.round(carbs)),
      fat: Math.max(0, Math.round(fat)),
    },
  };
};

export const cleanMealData = (meal: IAIMealData | undefined): IMeal => {
  if (!meal) {
    return {
      _id: new mongoose.Types.ObjectId().toString(),
      name: "No meal",
      calories: 0,
      macros: { protein: 0, carbs: 0, fat: 0 },
      category: "breakfast",
      ingredients: [],
      prepTime: 0,
    };
  }

  const parsedIngredients = parseIngredients(
    meal?.ingredients || [],
    meal?.name
  );

  return {
    _id: meal._id?.toString() || new mongoose.Types.ObjectId().toString(),
    name: meal.name || "Meal",
    category: (meal.category || "breakfast") as any,
    calories: typeof meal.calories === "number" ? meal.calories : 0,
    macros: {
      protein: meal.macros?.protein || 0,
      carbs: meal.macros?.carbs || 0,
      fat: meal.macros?.fat || 0,
    },
    ingredients: parsedIngredients,
    prepTime: parsePrepTime(meal.prepTime),
  };
};

// Default workout templates for different workout types
const defaultWorkoutTemplates = [
  {
    name: "Morning Cardio",
    category: "cardio",
    duration: 30,
    caloriesBurned: 250,
  },
  {
    name: "Strength Training",
    category: "strength",
    duration: 45,
    caloriesBurned: 300,
  },
  { name: "HIIT Session", category: "hiit", duration: 25, caloriesBurned: 350 },
  {
    name: "Yoga & Flexibility",
    category: "yoga",
    duration: 40,
    caloriesBurned: 150,
  },
  { name: "Core Workout", category: "core", duration: 20, caloriesBurned: 150 },
  {
    name: "Full Body Circuit",
    category: "bodyweight",
    duration: 35,
    caloriesBurned: 280,
  },
  {
    name: "Running Session",
    category: "running",
    duration: 30,
    caloriesBurned: 300,
  },
];

// Helper function to distribute workouts evenly across designated workout days
const distributeWorkouts = (
  weeklyPlanArray: any[],
  workoutDays: number[],
  dayToName: Record<number, string>,
  nameToDay: Record<string, number>
): void => {
  if (!workoutDays || workoutDays.length === 0) {
    logger.info(
      `[distributeWorkouts] No workout days specified, skipping distribution`
    );
    return;
  }

  // Collect all workouts from all days
  const allWorkouts: IWorkout[] = [];
  weeklyPlanArray.forEach((day: any) => {
    if (day.workouts && Array.isArray(day.workouts)) {
      allWorkouts.push(...day.workouts);
    }
  });

  logger.info(
    `[distributeWorkouts] Found ${allWorkouts.length} total workouts, ${workoutDays.length} workout days`
  );

  // Clear all workouts from all days first
  weeklyPlanArray.forEach((day: any) => {
    day.workouts = [];
  });

  // Create a map of day number to day object for easy lookup
  const dayMap = new Map<number, any>();
  weeklyPlanArray.forEach((day: any, index: number) => {
    // Try multiple ways to match the day name
    const dayNameLower = (day.day || "").toLowerCase().trim();
    let dayNumber = nameToDay[dayNameLower];

    // If not found, try without spaces and with different formats
    if (dayNumber === undefined) {
      const normalizedDay = dayNameLower.replace(/\s+/g, "");
      dayNumber = nameToDay[normalizedDay];
    }

    // If still not found, try matching by first 3 characters (e.g., "mon" for "monday")
    if (dayNumber === undefined && dayNameLower.length >= 3) {
      const dayPrefix = dayNameLower.substring(0, 3);
      for (const [name, num] of Object.entries(nameToDay)) {
        if (name.startsWith(dayPrefix)) {
          dayNumber = num;
          break;
        }
      }
    }

    // If still not found, try to infer from date if available
    if (dayNumber === undefined && day.date) {
      try {
        const dateObj = new Date(day.date);
        if (!isNaN(dateObj.getTime())) {
          const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, etc.
          // Map JavaScript day (0-6) to our day numbers (0 = Sunday, 1 = Monday, etc.)
          dayNumber = dayOfWeek;
          logger.debug(
            `[distributeWorkouts] Mapped day "${day.day}" to day number ${dayNumber} using date ${day.date}`
          );
        }
      } catch (e) {
        // Ignore date parsing errors
      }
    }

    // Last resort: use array index to infer day (assuming Monday = 0)
    if (dayNumber === undefined && index < 7) {
      // If we have 7 days and they're in order, index 0 = Monday (1), index 1 = Tuesday (2), etc.
      dayNumber = (index + 1) % 7; // Monday = 1, Tuesday = 2, ..., Sunday = 0
      logger.debug(
        `[distributeWorkouts] Mapped day "${day.day}" to day number ${dayNumber} using array index ${index}`
      );
    }

    if (dayNumber !== undefined) {
      dayMap.set(dayNumber, day);
      logger.debug(
        `[distributeWorkouts] Mapped day "${day.day}" (${dayNameLower}) to day number ${dayNumber}`
      );
    } else {
      logger.warn(
        `[distributeWorkouts] Could not map day "${day.day}" to day number. Available days: ${Object.keys(nameToDay).join(", ")}`
      );
    }
  });

  // Log day mapping for debugging
  logger.info(
    `[distributeWorkouts] Day map created with ${dayMap.size} entries. Workout days: ${workoutDays.join(", ")}`
  );

  // If we have collected workouts, distribute them
  if (allWorkouts.length > 0) {
    // Distribute collected workouts across workout days evenly
    // Each workout day should get at least 1 workout, distribute extras evenly
    const baseWorkoutsPerDay = Math.floor(
      allWorkouts.length / workoutDays.length
    );
    const extraWorkouts = allWorkouts.length % workoutDays.length;
    let workoutIndex = 0;

    for (let i = 0; i < workoutDays.length; i++) {
      const dayNumber = workoutDays[i];
      const dayObj = dayMap.get(dayNumber);
      if (dayObj) {
        // Calculate how many workouts this day should get
        // First 'extraWorkouts' days get one extra workout
        const workoutsForThisDay =
          baseWorkoutsPerDay + (i < extraWorkouts ? 1 : 0);
        const dayWorkouts: IWorkout[] = [];

        for (
          let j = 0;
          j < workoutsForThisDay && workoutIndex < allWorkouts.length;
          j++
        ) {
          dayWorkouts.push(allWorkouts[workoutIndex]);
          workoutIndex++;
        }

        dayObj.workouts = dayWorkouts;
        logger.info(
          `[distributeWorkouts] Assigned ${dayWorkouts.length} workout(s) to ${dayToName[dayNumber]} (day ${dayNumber})`
        );
      } else {
        logger.warn(
          `[distributeWorkouts] Could not find day object for ${dayToName[dayNumber]} (day number ${dayNumber})`
        );
        // If day object not found, still consume workouts to avoid assigning them elsewhere
        const workoutsForThisDay =
          baseWorkoutsPerDay + (i < extraWorkouts ? 1 : 0);
        workoutIndex += workoutsForThisDay;
      }
    }

    // Log distribution summary
    logger.info(
      `[distributeWorkouts] Distributed ${allWorkouts.length} workouts across ${workoutDays.length} days: ${workoutDays.map((d) => `${dayToName[d]}(${dayMap.get(d)?.workouts?.length || 0})`).join(", ")}`
    );
  } else {
    // No workouts from AI, generate defaults for each workout day
    logger.info(
      `[distributeWorkouts] No workouts from AI, generating defaults for ${workoutDays.length} days`
    );

    let templateIndex = 0;
    let workoutsGenerated = 0;
    for (const dayNumber of workoutDays) {
      const dayObj = dayMap.get(dayNumber);
      if (dayObj) {
        // Use different workout templates for variety
        const template =
          defaultWorkoutTemplates[
            templateIndex % defaultWorkoutTemplates.length
          ];
        dayObj.workouts = [
          {
            name: template.name,
            category: template.category,
            duration: template.duration,
            caloriesBurned: template.caloriesBurned,
            done: false,
          },
        ];
        templateIndex++;
        workoutsGenerated++;
        logger.info(
          `[distributeWorkouts] Generated default workout "${template.name}" for ${dayToName[dayNumber]}`
        );
      } else {
        logger.warn(
          `[distributeWorkouts] Could not find day object for ${dayToName[dayNumber]} (day number ${dayNumber}), cannot generate workout`
        );
      }
    }

    if (workoutsGenerated === 0) {
      logger.error(
        `[distributeWorkouts] CRITICAL: No workouts were generated! Day map size: ${dayMap.size}, Workout days: ${workoutDays.join(", ")}, Weekly plan array length: ${weeklyPlanArray.length}`
      );
      // Fallback: try to assign workouts to any available days
      if (weeklyPlanArray.length > 0) {
        logger.warn(
          `[distributeWorkouts] Attempting fallback: assigning workouts to first ${Math.min(workoutDays.length, weeklyPlanArray.length)} days`
        );
        let templateIndex = 0;
        for (
          let i = 0;
          i < Math.min(workoutDays.length, weeklyPlanArray.length);
          i++
        ) {
          const day = weeklyPlanArray[i];
          if (day) {
            const template =
              defaultWorkoutTemplates[
                templateIndex % defaultWorkoutTemplates.length
              ];
            day.workouts = [
              {
                name: template.name,
                category: template.category,
                duration: template.duration,
                caloriesBurned: template.caloriesBurned,
                done: false,
              },
            ];
            templateIndex++;
            logger.info(
              `[distributeWorkouts] Fallback: Generated workout "${template.name}" for day at index ${i}`
            );
          }
        }
      }
    }
  }

  // Ensure non-workout days have empty workout arrays
  weeklyPlanArray.forEach((day: any) => {
    const dayNumber = nameToDay[day.day.toLowerCase()];
    if (dayNumber !== undefined && !workoutDays.includes(dayNumber)) {
      day.workouts = [];
    }
  });
};

// Transform weekly plan from AI response to structured format
export const transformWeeklyPlan = async (
  parsedResponse: IParsedWeeklyPlanResponse,
  dayToName: Record<number, string>,
  nameToDay: Record<string, number>,
  dates: Date[],
  activeDays: number[],
  workoutDays: number[],
  planType: "daily" | "weekly",
  language: string,
  weekStartDate: Date
): Promise<MealPlanResponse> => {
  // Validate weekStartDate and use fallback if invalid
  let validWeekStartDate = weekStartDate;
  if (
    !weekStartDate ||
    !(weekStartDate instanceof Date) ||
    isNaN(weekStartDate.getTime())
  ) {
    logger.error(
      `[transformWeeklyPlan] Invalid weekStartDate: ${weekStartDate}`
    );
    // Use today as fallback
    validWeekStartDate = new Date();
    validWeekStartDate.setHours(0, 0, 0, 0);
    logger.warn(
      `[transformWeeklyPlan] Using today as fallback: ${validWeekStartDate.toISOString()}`
    );
  }

  // Validate dates array
  const validDates = dates.filter(
    (date) => date instanceof Date && !isNaN(date.getTime())
  );
  if (validDates.length === 0) {
    logger.error(`[transformWeeklyPlan] All dates in dates array are invalid`);
    throw new Error("Invalid dates array provided to transformWeeklyPlan");
  }
  if (validDates.length !== dates.length) {
    logger.warn(
      `[transformWeeklyPlan] ${dates.length - validDates.length} invalid dates found in dates array`
    );
  }

  const allMeals: {
    name: string;
    category: string;
    calories: number;
    mealData: IAIMealData;
  }[] = [];

  // Handle both array and object formats for weeklyPlan
  let weeklyPlanArray = Array.isArray(parsedResponse.weeklyPlan)
    ? parsedResponse.weeklyPlan
    : Object.values(parsedResponse.weeklyPlan);

  // CRITICAL: Limit to 7 days maximum before processing
  // This prevents the AI from generating more than a week's worth of data
  if (weeklyPlanArray.length > 7) {
    logger.warn(
      `[transformWeeklyPlan] AI returned ${weeklyPlanArray.length} days, limiting to 7. Original days: ${weeklyPlanArray.map((d: any) => d.day || "unknown").join(", ")}`
    );
    weeklyPlanArray = weeklyPlanArray.slice(0, 7);
  }

  // Distribute workouts evenly across designated workout days
  // This fixes the issue where AI sometimes puts all workouts on the first day
  logger.info(
    `[transformWeeklyPlan] Distributing workouts across ${workoutDays.length} workout days: ${workoutDays.map((d) => dayToName[d]).join(", ")}`
  );
  distributeWorkouts(weeklyPlanArray, workoutDays, dayToName, nameToDay);

  weeklyPlanArray.forEach((day: IAIDayData) => {
    if (day.meals.breakfast?.name)
      allMeals.push({
        ...day.meals.breakfast,
        category: "breakfast",
        mealData: day.meals.breakfast,
      });
    if (day.meals.lunch?.name)
      allMeals.push({
        ...day.meals.lunch,
        category: "lunch",
        mealData: day.meals.lunch,
      });
    if (day.meals.dinner?.name)
      allMeals.push({
        ...day.meals.dinner,
        category: "dinner",
        mealData: day.meals.dinner,
      });
    day.meals.snacks?.forEach((snack: IAIMealData) => {
      if (snack?.name)
        allMeals.push({ ...snack, category: "snack", mealData: snack });
    });
  });

  let existingMeals: any[] = [];
  const mealLookup = new Map();

  try {
    const mongooseConnection = mongoose.connection;
    if (mongooseConnection.readyState === 1) {
      const MealModel = getMealModel();
      const findQuery = MealModel.find({
        $or: allMeals.map((meal) => ({
          name: meal.name,
          category: meal.category,
          calories: { $gte: meal.calories - 50, $lte: meal.calories + 50 },
        })),
      }).maxTimeMS(5000);

      const timeoutPromise = new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error("Meal.find() timeout")), 5000)
      );

      try {
        existingMeals = (await Promise.race([
          findQuery.exec(),
          timeoutPromise,
        ])) as any[];

        existingMeals.forEach((meal) => {
          const key = `${meal.name}-${meal.category}-${meal.calories}`;
          mealLookup.set(key, meal);
        });
      } catch (timeoutError: unknown) {
        logger.warn(`Meal query timed out, continuing without lookup`);
      }
    }
  } catch (dbError: unknown) {
    logger.warn(`Failed to query meals: ${getErrorMessage(dbError)}`);
  }

  const newMeals = allMeals.filter((meal) => {
    const key = `${meal.name}-${meal.category}-${meal.calories}`;
    return !mealLookup.has(key);
  });

  if (newMeals.length > 0) {
    try {
      const mongooseConnection = mongoose.connection;
      if (mongooseConnection.readyState === 1) {
        const MealModel = getMealModel();
        const insertPromise = MealModel.insertMany(
          newMeals.map((meal) => ({
            ...meal.mealData,
            category: meal.category,
            done: false,
          }))
        );

        const timeoutPromise = new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error("insertMany timeout")), 5000)
        );

        try {
          const createdMeals = (await Promise.race([
            insertPromise,
            timeoutPromise,
          ])) as any[];

          createdMeals.forEach((meal) => {
            const key = `${meal.name}-${meal.category}-${meal.calories}`;
            mealLookup.set(key, meal);
          });
        } catch (timeoutError: unknown) {
          logger.warn(`Meal insertion timed out`);
        }
      }
    } catch (err: unknown) {
      logger.warn(`Error creating meals: ${getErrorMessage(err)}`);
    }
  }

  allMeals.forEach((meal) => {
    const key = `${meal.name}-${meal.category}-${meal.calories}`;
    if (!mealLookup.has(key)) {
      mealLookup.set(key, {
        ...meal.mealData,
        _id: new mongoose.Types.ObjectId(),
        category: meal.category,
        done: false,
      });
    }
  });

  const transformedWeeklyPlan = await Promise.all(
    weeklyPlanArray.map(async (day: IAIDayData) => {
      const findMeal = (
        mealData: IAIMealData | undefined,
        category: string
      ): IMealWithStatus | null => {
        if (!mealData?.name) return null;
        const key = `${mealData.name}-${category}-${mealData.calories}`;
        const meal = mealLookup.get(key);
        const cleanedMeal = cleanMealData(mealData);
        return meal
          ? {
              ...cleanedMeal,
              _id: meal._id.toString(),
              category: category as "breakfast" | "lunch" | "dinner" | "snack",
              done: false,
            }
          : {
              ...cleanedMeal,
              _id: new mongoose.Types.ObjectId().toString(),
              category: category as "breakfast" | "lunch" | "dinner" | "snack",
              done: false,
            };
      };

      const breakfast = findMeal(day.meals.breakfast, "breakfast");
      const lunch = findMeal(day.meals.lunch, "lunch");
      const dinner = findMeal(day.meals.dinner, "dinner");
      const snacks =
        day.meals.snacks
          ?.map((snack: IAIMealData) => findMeal(snack, "snack"))
          .filter((meal): meal is IMealWithStatus => meal !== null) || [];

      const dayNumber = nameToDay[day.day.toLowerCase()];

      // Determine the date for this day
      // Priority: 1) validDates array (most reliable), 2) day.date from AI, 3) calculate from dayNumber
      let dayDate: Date | undefined;

      // PRIORITY 1: Try to match by day number in activeDays array (uses validDates)
      // This is the most reliable since validDates is pre-calculated correctly
      if (dayNumber !== undefined && validDates.length > 0) {
        const dayIndexInActiveDays = activeDays.indexOf(dayNumber);
        if (
          dayIndexInActiveDays >= 0 &&
          dayIndexInActiveDays < validDates.length
        ) {
          dayDate = validDates[dayIndexInActiveDays];
        } else {
          // If not found by index, find by matching day of week
          for (const date of validDates) {
            if (date.getDay() === dayNumber) {
              dayDate = date;
              break;
            }
          }
        }
      }

      // PRIORITY 2: Try to use date from the day object itself (if not already set)
      // But validate it's within validDates range
      if (!dayDate && day.date) {
        let parsedDate: Date | undefined;
        if (day.date instanceof Date) {
          parsedDate = day.date;
        } else if (typeof day.date === "string") {
          parsedDate = new Date(day.date);
          // Validate the parsed date
          if (isNaN(parsedDate.getTime())) {
            parsedDate = undefined;
          }
        }

        // Only use if it's within validDates range
        if (parsedDate && validDates.length > 0) {
          const dateKey = getLocalDateKey(parsedDate);
          const isValidWeekDate = validDates.some(
            (vd) => getLocalDateKey(vd) === dateKey
          );
          if (isValidWeekDate) {
            dayDate = parsedDate;
          }
        }
      }

      // PRIORITY 3: Calculate from day name and validWeekStartDate (fallback)
      if (!dayDate && dayNumber !== undefined && validDates.length > 0) {
        // Use the first valid date as a base and calculate from there
        const baseDate = validDates[0];
        const currentDayOfWeek = baseDate.getDay();
        const targetDayOfWeek = dayNumber;
        let daysToAdd = targetDayOfWeek - currentDayOfWeek;
        if (daysToAdd < 0) daysToAdd += 7;
        // Ensure we don't go beyond 7 days
        if (daysToAdd < 7) {
          dayDate = new Date(baseDate);
          dayDate.setDate(baseDate.getDate() + daysToAdd);
        }
      }

      // Final fallback: use validWeekStartDate (today or provided start date)
      if (!dayDate || isNaN(dayDate.getTime())) {
        logger.warn(
          `[transformWeeklyPlan] Could not determine date for day ${day.day} (dayNumber: ${dayNumber}), using weekStartDate as fallback`
        );
        dayDate = new Date(validWeekStartDate);
        dayDate.setHours(0, 0, 0, 0);
      }

      return {
        day: day.day.toLowerCase() as any,
        date: dayDate,
        meals: {
          breakfast: breakfast || createEmptyMeal("breakfast"),
          lunch: lunch || createEmptyMeal("lunch"),
          dinner: dinner || createEmptyMeal("dinner"),
          snacks,
        },
        totalCalories:
          (breakfast?.calories || 0) +
          (lunch?.calories || 0) +
          (dinner?.calories || 0) +
          snacks.reduce(
            (sum: number, s: IMealWithStatus) => sum + s.calories,
            0
          ),
        totalProtein:
          (breakfast?.macros.protein || 0) +
          (lunch?.macros.protein || 0) +
          (dinner?.macros.protein || 0) +
          snacks.reduce(
            (sum: number, s: IMealWithStatus) => sum + s.macros.protein,
            0
          ),
        totalCarbs:
          (breakfast?.macros.carbs || 0) +
          (lunch?.macros.carbs || 0) +
          (dinner?.macros.carbs || 0) +
          snacks.reduce(
            (sum: number, s: IMealWithStatus) => sum + s.macros.carbs,
            0
          ),
        totalFat:
          (breakfast?.macros.fat || 0) +
          (lunch?.macros.fat || 0) +
          (dinner?.macros.fat || 0) +
          snacks.reduce(
            (sum: number, s: IMealWithStatus) => sum + s.macros.fat,
            0
          ),
        // Base water intake (8 glasses) + extra water for workouts (capped at 4 glasses)
        // Total maximum: 12 glasses per day
        waterIntake: Math.min(
          12, // Maximum 12 glasses (3L) per day including workout water
          calculateBaseWaterGlasses(day.hydration?.waterTarget) +
            calculateDayWorkoutWater(day.workouts || [])
        ),
        workouts: (day.workouts || []).map((w: IWorkout) => ({
          name: w.name || "Workout",
          category: w.category || "cardio",
          duration: parseDuration(w.duration || 30),
          caloriesBurned: parseCalories(w.caloriesBurned || 250),
          time: w.time,
          done: false,
        })),
        netCalories:
          (breakfast?.calories || 0) +
          (lunch?.calories || 0) +
          (dinner?.calories || 0) +
          snacks.reduce(
            (sum: number, s: IMealWithStatus) => sum + s.calories,
            0
          ),
      };
    })
  );

  const validWeeklyPlan = transformedWeeklyPlan.filter((day) => day !== null);

  if (!validWeeklyPlan || validWeeklyPlan.length === 0) {
    throw new Error("Failed to transform meal plan");
  }

  const weeklyPlanObject: IWeeklyPlanObject = {};

  // Calculate all past days in the current week (before today) and add them as empty
  const startDate = new Date(validWeekStartDate);
  startDate.setHours(0, 0, 0, 0);

  // Validate startDate
  if (isNaN(startDate.getTime())) {
    logger.error(
      `[transformWeeklyPlan] Invalid startDate after conversion: ${weekStartDate}`
    );
    throw new Error("Invalid weekStartDate provided to transformWeeklyPlan");
  }

  const currentDay = startDate.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Calculate Monday of the current week
  const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const mondayDate = new Date(startDate);
  mondayDate.setDate(startDate.getDate() + daysToMonday);

  // Validate mondayDate
  if (isNaN(mondayDate.getTime())) {
    logger.error(
      `[transformWeeklyPlan] Invalid mondayDate calculated from startDate: ${startDate.toISOString()}`
    );
    throw new Error("Failed to calculate valid Monday date");
  }

  // Calculate Sunday of the current week (end of week boundary)
  const sundayDate = new Date(mondayDate);
  sundayDate.setDate(mondayDate.getDate() + 6);
  sundayDate.setHours(23, 59, 59, 999);

  // Create a Set of valid date keys for the week (Monday to Sunday)
  const validWeekDateKeys = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const weekDate = new Date(mondayDate);
    weekDate.setDate(mondayDate.getDate() + i);
    validWeekDateKeys.add(getLocalDateKey(weekDate));
  }

  logger.info(
    `[transformWeeklyPlan] Week boundary: ${getLocalDateKey(mondayDate)} (Monday) to ${getLocalDateKey(sundayDate)} (Sunday). Valid dates: ${Array.from(validWeekDateKeys).sort().join(", ")}`
  );

  const dayToNameMap: Record<number, string> = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
    0: "sunday",
  };

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Helper function to create empty day entry
  const createEmptyDay = (dayNumber: number, date: Date) => {
    // Validate date before using it
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      logger.error(
        `[transformWeeklyPlan] Invalid date in createEmptyDay for day ${dayNumber}: ${date}`
      );
      // Use today as fallback
      date = new Date();
      date.setHours(0, 0, 0, 0);
    }
    const dateKey = getLocalDateKey(date);
    const formattedDate = `${monthNames[date.getMonth()]} ${date.getDate()}`;

    return {
      [dateKey]: {
        day: dayToNameMap[dayNumber],
        date: formattedDate,
        meals: {
          breakfast: {
            _id: new mongoose.Types.ObjectId().toString(),
            name: "No meal planned",
            calories: 0,
            macros: { protein: 0, carbs: 0, fat: 0 },
            category: "breakfast",
            ingredients: [],
            prepTime: 0,
            done: false,
          },
          lunch: {
            _id: new mongoose.Types.ObjectId().toString(),
            name: "No meal planned",
            calories: 0,
            macros: { protein: 0, carbs: 0, fat: 0 },
            category: "lunch",
            ingredients: [],
            prepTime: 0,
            done: false,
          },
          dinner: {
            _id: new mongoose.Types.ObjectId().toString(),
            name: "No meal planned",
            calories: 0,
            macros: { protein: 0, carbs: 0, fat: 0 },
            category: "dinner",
            ingredients: [],
            prepTime: 0,
            done: false,
          },
          snacks: [],
        },
        workouts: [],
        waterIntake: 0,
      },
    };
  };

  // NOTE: We do NOT add empty placeholder days for past dates anymore
  // The plan should only contain days from today through Sunday
  // Past days are irrelevant and just waste data

  // Track used date keys to prevent duplicates
  const usedDateKeys = new Set<string>();

  // Add only the generated days (from today through Sunday)
  validWeeklyPlan.forEach((day: any) => {
    let dateObj: Date;
    if (day.date instanceof Date) {
      dateObj = day.date;
    } else if (typeof day.date === "string") {
      dateObj = new Date(day.date);
    } else {
      logger.error(
        `[transformWeeklyPlan] Invalid date format in day: ${JSON.stringify(day.date)}`
      );
      // Skip this day if date is invalid
      return;
    }

    // Validate date before using it
    if (isNaN(dateObj.getTime())) {
      logger.error(
        `[transformWeeklyPlan] Invalid date value: ${day.date}, skipping day`
      );
      return;
    }

    // CRITICAL: Ensure date is within the week boundary (Monday to Sunday)
    if (dateObj < mondayDate || dateObj > sundayDate) {
      logger.warn(
        `[transformWeeklyPlan] Date ${getLocalDateKey(dateObj)} for day ${day.day} is outside week boundary (${getLocalDateKey(mondayDate)} to ${getLocalDateKey(sundayDate)}). Attempting to fix...`
      );

      // Try to find a valid date within the week based on day name
      const dayNumber = nameToDay[day.day.toLowerCase()];
      if (dayNumber !== undefined) {
        // Calculate the correct date for this day of week within the week boundary
        const targetDate = new Date(mondayDate);
        const daysToAdd = dayNumber === 0 ? 6 : dayNumber - 1; // Sunday is day 0, but we want index 6
        targetDate.setDate(mondayDate.getDate() + daysToAdd);
        dateObj = targetDate;
        logger.info(
          `[transformWeeklyPlan] Fixed date for ${day.day} to ${getLocalDateKey(dateObj)}`
        );
      } else {
        logger.error(
          `[transformWeeklyPlan] Cannot determine day number for ${day.day}, skipping`
        );
        return;
      }
    }

    const dateKey = getLocalDateKey(dateObj);

    // CRITICAL: Validate that dateKey is within valid week dates
    if (!validWeekDateKeys.has(dateKey)) {
      logger.warn(
        `[transformWeeklyPlan] Date key ${dateKey} is not in valid week dates. Skipping day ${day.day}`
      );
      return;
    }

    // CRITICAL: Prevent duplicate dates
    if (usedDateKeys.has(dateKey)) {
      logger.warn(
        `[transformWeeklyPlan] Duplicate date ${dateKey} for day ${day.day}. Skipping duplicate.`
      );
      return;
    }

    usedDateKeys.add(dateKey);
    const formattedDate = `${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}`;

    // Ensure workouts array exists (should have been set by distributeWorkouts)
    let dayWorkouts = day.workouts || [];

    // Post-processing: Ensure workouts are present on workout days
    const dayNumber = nameToDay[day.day.toLowerCase()];
    if (
      dayWorkouts.length === 0 &&
      dayNumber !== undefined &&
      workoutDays.includes(dayNumber)
    ) {
      logger.warn(
        `[transformWeeklyPlan] Day ${day.day} (${dateKey}) is a workout day but has no workouts! Generating default workout. Day number: ${dayNumber}`
      );
      // Generate a default workout for this day
      const templateIndex =
        workoutDays.indexOf(dayNumber) % defaultWorkoutTemplates.length;
      const template = defaultWorkoutTemplates[templateIndex];
      dayWorkouts = [
        {
          name: template.name,
          category: template.category,
          duration: template.duration,
          caloriesBurned: template.caloriesBurned,
          done: false,
        },
      ];
      logger.info(
        `[transformWeeklyPlan] Generated fallback workout "${template.name}" for ${day.day} (${dateKey})`
      );
    }

    weeklyPlanObject[dateKey] = {
      day: day.day,
      date: formattedDate,
      meals: day.meals,
      workouts: dayWorkouts,
      waterIntake: day.waterIntake || 8,
    };
  });

  // CRITICAL VALIDATION: Ensure we never have more than 7 days
  const planDays = Object.keys(weeklyPlanObject);
  if (planDays.length > 7) {
    logger.error(
      `[transformWeeklyPlan] Generated ${planDays.length} days, max is 7! Dates: ${planDays.sort().join(", ")}`
    );
    // Keep only the first 7 days (sorted by date)
    const sortedDays = planDays.sort();
    const daysToKeep = sortedDays.slice(0, 7);
    const daysToRemove = sortedDays.slice(7);
    logger.warn(
      `[transformWeeklyPlan] Removing extra days: ${daysToRemove.join(", ")}`
    );
    for (const dayKey of daysToRemove) {
      delete weeklyPlanObject[dayKey];
    }
  }

  logger.info(
    `[transformWeeklyPlan] Final plan has ${Object.keys(weeklyPlanObject).length} days: ${Object.keys(weeklyPlanObject).sort().join(", ")}`
  );

  return {
    mealPlan: {
      weeklyPlan: weeklyPlanObject,
    },
    planType,
    language,
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Enrich weekly plan with user's favorite meals (20-30% replacement)
 * Uses meals the user has explicitly favorited, filtered by category and calories
 */
export const enrichPlanWithFavoriteMeals = async (
  planResponse: MealPlanResponse,
  userData: IUserData
): Promise<MealPlanResponse> => {
  try {
    const weeklyPlan = planResponse.mealPlan.weeklyPlan as IWeeklyPlanObject;
    if (!weeklyPlan || typeof weeklyPlan !== "object") {
      logger.warn(
        "[enrichPlanWithFavoriteMeals] Invalid weekly plan structure, skipping enrichment"
      );
      return planResponse;
    }

    // Check if user has favorite meals
    const favoriteMealIds = userData.favoriteMeals || [];
    if (!favoriteMealIds || favoriteMealIds.length === 0) {
      logger.info(
        "[enrichPlanWithFavoriteMeals] User has no favorite meals, skipping enrichment"
      );
      return planResponse;
    }

    const mongooseConnection = mongoose.connection;
    if (mongooseConnection.readyState !== 1) {
      logger.warn(
        "[enrichPlanWithFavoriteMeals] MongoDB not connected, skipping enrichment"
      );
      return planResponse;
    }

    const MealModel = getMealModel();

    // Fetch user's favorite meals from database
    const validIds = favoriteMealIds
      .filter((id: any) => id)
      .map((id: any) => {
        try {
          return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
        } catch (e) {
          return null;
        }
      })
      .filter((id: any) => id !== null);

    if (validIds.length === 0) {
      logger.warn(
        "[enrichPlanWithFavoriteMeals] No valid favorite meal IDs found"
      );
      return planResponse;
    }

    const favoriteMeals = await MealModel.find({
      _id: { $in: validIds },
    })
      .lean()
      .exec();

    if (favoriteMeals.length === 0) {
      logger.warn(
        "[enrichPlanWithFavoriteMeals] No favorite meals found in database"
      );
      return planResponse;
    }

    logger.info(
      `[enrichPlanWithFavoriteMeals] Found ${favoriteMeals.length} favorite meals for user`
    );

    // Organize favorite meals by category
    const favoritesByCategory: Record<string, any[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };

    favoriteMeals.forEach((meal: any) => {
      const category = meal.category;
      if (category && favoritesByCategory[category]) {
        favoritesByCategory[category].push(meal);
      }
    });

    // Collect all meals that could be replaced
    const dayKeys = Object.keys(weeklyPlan);
    const mealsToReplace: Array<{
      dateKey: string;
      mealType: "breakfast" | "lunch" | "dinner";
      currentMeal: IMealWithStatus;
      targetCalories: number;
    }> = [];

    dayKeys.forEach((dateKey) => {
      const dayPlan = weeklyPlan[dateKey];
      if (!dayPlan || !dayPlan.meals) return;

      ["breakfast", "lunch", "dinner"].forEach((mealType) => {
        const meal = dayPlan.meals[
          mealType as keyof typeof dayPlan.meals
        ] as IMealWithStatus;
        if (meal && meal.name && meal.calories) {
          mealsToReplace.push({
            dateKey,
            mealType: mealType as "breakfast" | "lunch" | "dinner",
            currentMeal: meal,
            targetCalories: meal.calories,
          });
        }
      });
    });

    if (mealsToReplace.length === 0) {
      logger.warn("[enrichPlanWithFavoriteMeals] No meals found to replace");
      return planResponse;
    }

    // Calculate target replacements (20-30% of meals)
    const totalMeals = mealsToReplace.length;
    const targetReplacements = Math.max(1, Math.floor(totalMeals * 0.25)); // 25% (within 20-30% range)

    logger.info(
      `[enrichPlanWithFavoriteMeals] Planning to replace ${targetReplacements} out of ${totalMeals} meals with favorite meals`
    );

    // Randomly shuffle meals to replace
    const shuffled = [...mealsToReplace].sort(() => Math.random() - 0.5);
    let replacedCount = 0;

    // Replace meals with matching favorite meals
    for (const { dateKey, mealType, targetCalories } of shuffled) {
      if (replacedCount >= targetReplacements) break;

      const categoryFavorites = favoritesByCategory[mealType] || [];
      if (categoryFavorites.length === 0) continue;

      // Filter favorites by calorie range (±150 calories tolerance)
      const calorieTolerance = 150;
      const matchingFavorites = categoryFavorites.filter((fav: any) => {
        const calorieDiff = Math.abs((fav.calories || 0) - targetCalories);
        return calorieDiff <= calorieTolerance;
      });

      if (matchingFavorites.length === 0) continue;

      // Pick a random favorite meal from matches
      const selectedFavorite = matchingFavorites[
        Math.floor(Math.random() * matchingFavorites.length)
      ] as any;

      const dayPlan = weeklyPlan[dateKey];

      // Replace the meal with favorite
      (dayPlan.meals as any)[mealType] = {
        _id: selectedFavorite._id.toString(),
        name: selectedFavorite.name,
        calories: selectedFavorite.calories,
        macros: selectedFavorite.macros || { protein: 0, carbs: 0, fat: 0 },
        category: mealType,
        prepTime: parsePrepTime(selectedFavorite.prepTime),
        ingredients: selectedFavorite.ingredients || [],
        done: false,
      };

      // Update usage count
      try {
        await MealModel.findByIdAndUpdate(selectedFavorite._id, {
          $inc: { "analytics.timesGenerated": 1 },
        });
      } catch (error) {
        // Ignore analytics update errors
      }

      replacedCount++;
      logger.info(
        `[enrichPlanWithFavoriteMeals] Replaced ${mealType} on ${dateKey} with favorite meal: ${selectedFavorite.name}`
      );
    }

    logger.info(
      `[enrichPlanWithFavoriteMeals] Successfully replaced ${replacedCount} meals with favorite meals (${Math.round((replacedCount / totalMeals) * 100)}%)`
    );

    return planResponse;
  } catch (error) {
    logger.error(
      `[enrichPlanWithFavoriteMeals] Error enriching plan with favorite meals: ${error instanceof Error ? error.message : String(error)}`
    );
    // Return original plan if enrichment fails
    return planResponse;
  }
};

/**
 * Replace 20-30% of AI-generated meals with meals from database
 * This saves AI costs and improves consistency by reusing proven meals
 */
export const enrichPlanWithDBMeals = async (
  planResponse: MealPlanResponse,
  userData: IUserData
): Promise<MealPlanResponse> => {
  try {
    const weeklyPlan = planResponse.mealPlan.weeklyPlan as IWeeklyPlanObject;
    if (!weeklyPlan || typeof weeklyPlan !== "object") {
      logger.warn(
        "[enrichPlanWithDBMeals] Invalid weekly plan structure, skipping DB enrichment"
      );
      return planResponse;
    }

    const mongooseConnection = mongoose.connection;
    if (mongooseConnection.readyState !== 1) {
      logger.warn(
        "[enrichPlanWithDBMeals] MongoDB not connected, skipping DB enrichment"
      );
      return planResponse;
    }

    const MealModel = getMealModel();
    const dayKeys = Object.keys(weeklyPlan);
    const totalMeals = dayKeys.length * 3; // breakfast, lunch, dinner (excluding snacks)
    const targetReplacements = Math.max(1, Math.floor(totalMeals * 0.25)); // 25% of meals (20-30% range)

    logger.info(
      `[enrichPlanWithDBMeals] Planning to replace ${targetReplacements} out of ${totalMeals} meals with DB meals`
    );

    // Collect all meals that need potential replacement
    const mealsToReplace: Array<{
      dateKey: string;
      mealType: "breakfast" | "lunch" | "dinner";
      currentMeal: IMealWithStatus;
      targetCalories: number;
    }> = [];

    dayKeys.forEach((dateKey) => {
      const dayPlan = weeklyPlan[dateKey];
      if (!dayPlan || !dayPlan.meals) return;

      ["breakfast", "lunch", "dinner"].forEach((mealType) => {
        const meal = dayPlan.meals[
          mealType as keyof typeof dayPlan.meals
        ] as IMealWithStatus;
        if (meal && meal.name && meal.calories) {
          mealsToReplace.push({
            dateKey,
            mealType: mealType as "breakfast" | "lunch" | "dinner",
            currentMeal: meal,
            targetCalories: meal.calories,
          });
        }
      });
    });

    if (mealsToReplace.length === 0) {
      logger.warn("[enrichPlanWithDBMeals] No meals found to replace");
      return planResponse;
    }

    // Randomly select meals to replace
    const shuffled = [...mealsToReplace].sort(() => Math.random() - 0.5);
    const mealsToActuallyReplace = shuffled.slice(
      0,
      Math.min(targetReplacements, mealsToReplace.length)
    );

    logger.info(
      `[enrichPlanWithDBMeals] Selected ${mealsToActuallyReplace.length} meals to replace with DB meals`
    );

    let replacedCount = 0;

    // Replace each selected meal with a DB meal
    for (const {
      dateKey,
      mealType,
      targetCalories,
    } of mealsToActuallyReplace) {
      try {
        // Query DB for matching meal
        const calorieTolerance = 150;
        const query: any = {
          category: mealType,
          calories: {
            $gte: Math.max(0, targetCalories - calorieTolerance),
            $lte: targetCalories + calorieTolerance,
          },
        };

        // Exclude allergens
        if (userData.allergies && userData.allergies.length > 0) {
          const allergenRegex = new RegExp(userData.allergies.join("|"), "i");
          query.$nor = [
            { name: { $regex: allergenRegex } },
            { "ingredients.0": { $regex: allergenRegex } },
          ];
        }

        // Find a matching meal from DB
        const dbMeals = await MealModel.find(query)
          .sort({ "analytics.timesGenerated": -1 }) // Prioritize popular meals
          .limit(5)
          .lean()
          .exec();

        if (dbMeals.length > 0) {
          // Pick a random meal from top matches
          const selectedMeal = dbMeals[
            Math.floor(Math.random() * dbMeals.length)
          ] as any;
          const dayPlan = weeklyPlan[dateKey];

          // Replace the meal
          (dayPlan.meals as any)[mealType] = {
            _id: selectedMeal._id.toString(),
            name: selectedMeal.name,
            calories: selectedMeal.calories,
            macros: selectedMeal.macros || { protein: 0, carbs: 0, fat: 0 },
            category: mealType,
            prepTime: parsePrepTime(selectedMeal.prepTime),
            ingredients: selectedMeal.ingredients || [],
            done: false,
          };

          // Update usage count
          await MealModel.findByIdAndUpdate(selectedMeal._id, {
            $inc: { "analytics.timesGenerated": 1 },
          });

          replacedCount++;
          logger.info(
            `[enrichPlanWithDBMeals] Replaced ${mealType} on ${dateKey} with DB meal: ${selectedMeal.name}`
          );
        }
      } catch (error) {
        logger.warn(
          `[enrichPlanWithDBMeals] Failed to replace meal for ${dateKey}/${mealType}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    logger.info(
      `[enrichPlanWithDBMeals] Successfully replaced ${replacedCount} meals with DB meals (${Math.round((replacedCount / totalMeals) * 100)}%)`
    );

    return planResponse;
  } catch (error) {
    logger.error(
      `[enrichPlanWithDBMeals] Error enriching plan with DB meals: ${error instanceof Error ? error.message : String(error)}`
    );
    // Return original plan if enrichment fails
    return planResponse;
  }
};
