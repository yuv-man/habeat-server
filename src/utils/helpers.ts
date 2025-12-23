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

// Helper to get local date key in YYYY-MM-DD format (avoids timezone issues with toISOString which uses UTC)
const getLocalDateKey = (date: Date): string => {
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
// - Night (after 21:00): 0.5x - don't want too much before bed
export const calculateWorkoutWaterGlasses = (
  caloriesBurned: number,
  time?: string
): number => {
  // Base calculation: 1 glass per 150 calories, minimum 1 for any workout
  const baseGlasses = Math.max(1, Math.ceil(caloriesBurned / 150));

  if (!time) {
    // No time specified, use base calculation
    return baseGlasses;
  }

  // Parse time (HH:MM format)
  const timeParts = time.split(":");
  const hours = parseInt(timeParts[0], 10);

  if (isNaN(hours)) {
    return baseGlasses;
  }

  let multiplier = 1.0;
  if (hours < 9) {
    // Early morning - more time to hydrate throughout the day
    multiplier = 1.5;
  } else if (hours < 12) {
    // Morning
    multiplier = 1.25;
  } else if (hours < 17) {
    // Afternoon - base
    multiplier = 1.0;
  } else if (hours < 21) {
    // Evening - less time remaining
    multiplier = 0.75;
  } else {
    // Night - minimal extra water
    multiplier = 0.5;
  }

  // Apply multiplier and round up, minimum 1 glass
  return Math.max(1, Math.ceil(baseGlasses * multiplier));
};

// Calculate total extra water for all workouts in a day
export const calculateDayWorkoutWater = (
  workouts: Array<{ caloriesBurned?: number; time?: string }>
): number => {
  if (!workouts || workouts.length === 0) return 0;

  return workouts.reduce((total, workout) => {
    const calories = parseCalories(workout.caloriesBurned);
    return total + calculateWorkoutWaterGlasses(calories, workout.time);
  }, 0);
};

// Calculate base water intake from AI response
// Handles different formats: ml (2000), glasses (8), or liters (2.5)
// Returns number of glasses (250ml each)
export const calculateBaseWaterGlasses = (waterTarget: any): number => {
  const DEFAULT_GLASSES = 8; // Default: 8 glasses = 2L
  const MIN_GLASSES = 6;
  const MAX_GLASSES = 12; // Maximum reasonable base intake

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

  // Apply reasonable bounds
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
  weeklyPlanArray.forEach((day: any) => {
    const dayNumber = nameToDay[day.day.toLowerCase()];
    if (dayNumber !== undefined) {
      dayMap.set(dayNumber, day);
    }
  });

  // If we have collected workouts, distribute them
  if (allWorkouts.length > 0) {
    // Distribute collected workouts across workout days evenly
    const workoutsPerDay = Math.ceil(allWorkouts.length / workoutDays.length);
    let workoutIndex = 0;

    for (const dayNumber of workoutDays) {
      const dayObj = dayMap.get(dayNumber);
      if (dayObj) {
        const dayWorkouts: IWorkout[] = [];
        for (
          let i = 0;
          i < workoutsPerDay && workoutIndex < allWorkouts.length;
          i++
        ) {
          dayWorkouts.push(allWorkouts[workoutIndex]);
          workoutIndex++;
        }
        dayObj.workouts = dayWorkouts;
        logger.info(
          `[distributeWorkouts] Assigned ${dayWorkouts.length} workouts to ${dayToName[dayNumber]}`
        );
      }
    }
  } else {
    // No workouts from AI, generate defaults for each workout day
    logger.info(
      `[distributeWorkouts] No workouts from AI, generating defaults for ${workoutDays.length} days`
    );

    let templateIndex = 0;
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
        logger.info(
          `[distributeWorkouts] Generated default workout "${template.name}" for ${dayToName[dayNumber]}`
        );
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
  const weeklyPlanArray = Array.isArray(parsedResponse.weeklyPlan)
    ? parsedResponse.weeklyPlan
    : Object.values(parsedResponse.weeklyPlan);

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
      let dayDate: Date | undefined;

      // First, try to use date from the day object itself (most reliable)
      if (day.date) {
        if (day.date instanceof Date) {
          dayDate = day.date;
        } else if (typeof day.date === "string") {
          dayDate = new Date(day.date);
          // Validate the parsed date
          if (isNaN(dayDate.getTime())) {
            dayDate = undefined;
          }
        }
      }

      // If not found, try to match by day number in activeDays array
      if (!dayDate && dayNumber !== undefined) {
        const dayIndexInActiveDays = activeDays.indexOf(dayNumber);
        if (
          dayIndexInActiveDays >= 0 &&
          dayIndexInActiveDays < validDates.length
        ) {
          dayDate = validDates[dayIndexInActiveDays];
        }
      }

      // If still not found, try to find by matching day of week in dates array
      if (!dayDate && dayNumber !== undefined && validDates.length > 0) {
        // Find a date that matches the day of week
        for (const date of validDates) {
          if (date.getDay() === dayNumber) {
            dayDate = date;
            break;
          }
        }
      }

      // If still no valid date, try to calculate from day name and valid dates
      if (!dayDate && dayNumber !== undefined && validDates.length > 0) {
        // Use the first valid date as a base and calculate from there
        const baseDate = validDates[0];
        const currentDayOfWeek = baseDate.getDay();
        const targetDayOfWeek = dayNumber;
        let daysToAdd = targetDayOfWeek - currentDayOfWeek;
        if (daysToAdd < 0) daysToAdd += 7;
        dayDate = new Date(baseDate);
        dayDate.setDate(baseDate.getDate() + daysToAdd);
      }

      // Final fallback: use today
      if (!dayDate || isNaN(dayDate.getTime())) {
        logger.warn(
          `[transformWeeklyPlan] Could not determine date for day ${day.day} (dayNumber: ${dayNumber}), using today as fallback`
        );
        dayDate = new Date();
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
        // Base water intake + extra water for workouts (capped at reasonable max)
        waterIntake: Math.min(
          16, // Maximum 16 glasses (4L) per day including workout water
          calculateBaseWaterGlasses(day.hydration?.waterTarget) +
            calculateDayWorkoutWater(day.workouts || [])
        ),
        workouts: (day.workouts || []).map((w: IWorkout) => ({
          name: w.name,
          category: w.category || "cardio",
          duration: parseDuration(w.duration),
          caloriesBurned: parseCalories(w.caloriesBurned),
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

    const dateKey = getLocalDateKey(dateObj);
    const formattedDate = `${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}`;

    weeklyPlanObject[dateKey] = {
      day: day.day,
      date: formattedDate,
      meals: day.meals,
      workouts: day.workouts || [],
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
