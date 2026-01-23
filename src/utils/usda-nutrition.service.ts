import { Injectable } from "@nestjs/common";
import axios from "axios";
import logger from "./logger";

export interface IngredientNutrition {
  ingredient: string;
  amount: string; // e.g., "150g", "1 cup"
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  fdcId?: string;
  source: "USDA" | "estimated";
}

export interface AggregatedNutrition {
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  ingredients: IngredientNutrition[];
  source: "USDA" | "partial" | "estimated";
}

// Cache for USDA lookups (in-memory cache, can be upgraded to Redis)
const ingredientCache = new Map<string, { nutrition: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Helper to parse ingredient amount (e.g., "150g" -> { value: 150, unit: "g" })
function parseIngredientAmount(amount: string): { value: number; unit: string } {
  const match = amount.match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb|cups?|tbsp|tsp|pieces?|slices?)?$/i);
  if (match) {
    return {
      value: parseFloat(match[1]),
      unit: (match[2] || "g").toLowerCase(),
    };
  }
  // Default: assume grams if no unit specified
  const numMatch = amount.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    return { value: parseFloat(numMatch[1]), unit: "g" };
  }
  return { value: 100, unit: "g" }; // Default fallback
}

// Helper to normalize ingredient name for USDA search
function normalizeIngredientName(name: string): string {
  // Remove underscores, convert to lowercase, clean up
  return name
    .replace(/_/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

@Injectable()
export class UsdaNutritionService {
  private readonly USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";
  private readonly apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.USDA_API_KEY;
    if (!this.apiKey) {
      logger.warn("[UsdaNutritionService] USDA_API_KEY not set - USDA lookups will be disabled");
    }
  }

  /**
   * Get nutrition data for a single ingredient from USDA
   */
  async getIngredientNutrition(
    ingredientName: string,
    amount: string = "100g"
  ): Promise<IngredientNutrition | null> {
    if (!this.apiKey) {
      return null;
    }

    const normalizedName = normalizeIngredientName(ingredientName);
    const cacheKey = `${normalizedName}_${amount}`;

    // Check cache
    const cached = ingredientCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug(`[UsdaNutritionService] Cache hit for: ${ingredientName}`);
      return cached.nutrition;
    }

    try {
      // Search USDA database
      const searchResponse = await axios.get(`${this.USDA_API_BASE}/foods/search`, {
        params: {
          api_key: this.apiKey,
          query: normalizedName,
          pageSize: 5,
          dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)"].join(","),
        },
        timeout: 5000,
      });

      const foods = searchResponse.data.foods;
      if (!foods || foods.length === 0) {
        logger.debug(`[UsdaNutritionService] No USDA results for: ${ingredientName}`);
        return null;
      }

      // Get the most relevant result
      const food = foods[0];
      const nutrients = food.foodNutrients || [];

      const findNutrient = (name: string): number => {
        const nutrient = nutrients.find(
          (n: any) =>
            n.nutrientName?.toLowerCase().includes(name.toLowerCase()) ||
            n.nutrientNumber === name
        );
        return nutrient?.value || 0;
      };

      // Get nutrition per 100g (USDA standard)
      const caloriesPer100g =
        findNutrient("energy") || findNutrient("calories") || findNutrient("1008");
      const proteinPer100g = findNutrient("protein") || findNutrient("1003");
      const carbsPer100g =
        findNutrient("carbohydrate") || findNutrient("carbs") || findNutrient("1005");
      const fatPer100g = findNutrient("fat") || findNutrient("total lipid") || findNutrient("1004");

      // Parse amount and calculate nutrition
      const { value, unit } = parseIngredientAmount(amount);
      let multiplier = 1;

      // Convert to grams for calculation
      if (unit === "kg") {
        multiplier = value * 10; // kg to 100g
      } else if (unit === "g") {
        multiplier = value / 100; // g to 100g
      } else if (unit === "ml" || unit === "l") {
        // For liquids, approximate 1ml = 1g (water-based)
        const ml = unit === "l" ? value * 1000 : value;
        multiplier = ml / 100;
      } else {
        // For other units (cups, tbsp, etc.), use a rough estimate
        // This is a simplification - in production, you'd want a conversion table
        multiplier = value / 100; // Default: assume grams
      }

      const nutrition: IngredientNutrition = {
        ingredient: ingredientName,
        amount,
        calories: Math.round(caloriesPer100g * multiplier),
        macros: {
          protein: Math.round(proteinPer100g * multiplier),
          carbs: Math.round(carbsPer100g * multiplier),
          fat: Math.round(fatPer100g * multiplier),
        },
        fdcId: food.fdcId?.toString(),
        source: "USDA",
      };

      // Cache the result
      ingredientCache.set(cacheKey, {
        nutrition,
        expiresAt: Date.now() + CACHE_TTL,
      });

      logger.debug(
        `[UsdaNutritionService] Found USDA data for ${ingredientName}: ${nutrition.calories} cal, ${nutrition.macros.protein}g protein`
      );

      return nutrition;
    } catch (error: any) {
      logger.warn(`[UsdaNutritionService] Error looking up ${ingredientName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate nutrition for a meal from its ingredients
   * Ingredients format: [["ingredient_name", "amount"], ...]
   */
  async calculateMealNutrition(
    ingredients: Array<[string, string]>
  ): Promise<AggregatedNutrition> {
    if (!ingredients || ingredients.length === 0) {
      return {
        calories: 0,
        macros: { protein: 0, carbs: 0, fat: 0 },
        ingredients: [],
        source: "estimated",
      };
    }

    const ingredientNutritions: IngredientNutrition[] = [];
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let usdaCount = 0;
    let estimatedCount = 0;

    // Look up each ingredient
    for (const [ingredientName, amount] of ingredients) {
      const nutrition = await this.getIngredientNutrition(ingredientName, amount);

      if (nutrition && nutrition.source === "USDA") {
        ingredientNutritions.push(nutrition);
        totalCalories += nutrition.calories;
        totalProtein += nutrition.macros.protein;
        totalCarbs += nutrition.macros.carbs;
        totalFat += nutrition.macros.fat;
        usdaCount++;
      } else {
        // Estimate nutrition for missing ingredients
        const estimated = this.estimateIngredientNutrition(ingredientName, amount);
        ingredientNutritions.push(estimated);
        totalCalories += estimated.calories;
        totalProtein += estimated.macros.protein;
        totalCarbs += estimated.macros.carbs;
        totalFat += estimated.macros.fat;
        estimatedCount++;
      }
    }

    // Determine source
    let source: "USDA" | "partial" | "estimated";
    if (usdaCount === ingredients.length) {
      source = "USDA";
    } else if (usdaCount > 0) {
      source = "partial";
    } else {
      source = "estimated";
    }

    return {
      calories: Math.round(totalCalories),
      macros: {
        protein: Math.round(totalProtein),
        carbs: Math.round(totalCarbs),
        fat: Math.round(totalFat),
      },
      ingredients: ingredientNutritions,
      source,
    };
  }

  /**
   * Estimate nutrition for an ingredient when USDA lookup fails
   * Uses common food nutrition averages
   */
  private estimateIngredientNutrition(
    ingredientName: string,
    amount: string
  ): IngredientNutrition {
    const { value, unit } = parseIngredientAmount(amount);
    const name = normalizeIngredientName(ingredientName);

    // Common ingredient estimates (per 100g)
    const estimates: Record<string, { calories: number; protein: number; carbs: number; fat: number }> = {
      // Proteins
      chicken: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
      "chicken breast": { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
      beef: { calories: 250, protein: 26, carbs: 0, fat: 15 },
      pork: { calories: 242, protein: 27, carbs: 0, fat: 14 },
      fish: { calories: 206, protein: 22, carbs: 0, fat: 12 },
      salmon: { calories: 208, protein: 20, carbs: 0, fat: 12 },
      tuna: { calories: 144, protein: 30, carbs: 0, fat: 1 },
      eggs: { calories: 155, protein: 13, carbs: 1.1, fat: 11 },
      tofu: { calories: 76, protein: 8, carbs: 1.9, fat: 4.8 },
      // Carbs
      rice: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
      pasta: { calories: 131, protein: 5, carbs: 25, fat: 1.1 },
      bread: { calories: 265, protein: 9, carbs: 49, fat: 3.2 },
      potato: { calories: 77, protein: 2, carbs: 17, fat: 0.1 },
      sweet: { calories: 86, protein: 1.6, carbs: 20, fat: 0.1 },
      // Vegetables
      lettuce: { calories: 15, protein: 1.4, carbs: 2.9, fat: 0.2 },
      tomato: { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
      onion: { calories: 40, protein: 1.1, carbs: 9.3, fat: 0.1 },
      pepper: { calories: 31, protein: 1, carbs: 7, fat: 0.3 },
      broccoli: { calories: 34, protein: 2.8, carbs: 7, fat: 0.4 },
      spinach: { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
      // Fats
      "olive oil": { calories: 884, protein: 0, carbs: 0, fat: 100 },
      butter: { calories: 717, protein: 0.9, carbs: 0.1, fat: 81 },
      cheese: { calories: 402, protein: 25, carbs: 1.3, fat: 33 },
      // Dairy
      milk: { calories: 42, protein: 3.4, carbs: 5, fat: 1 },
      yogurt: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
    };

    // Find matching estimate
    let estimate = { calories: 100, protein: 3, carbs: 15, fat: 3 }; // Default estimate
    for (const [key, value] of Object.entries(estimates)) {
      if (name.includes(key)) {
        estimate = value;
        break;
      }
    }

    // Calculate multiplier based on amount
    let multiplier = 1;
    if (unit === "kg") {
      multiplier = value * 10;
    } else if (unit === "g") {
      multiplier = value / 100;
    } else if (unit === "ml" || unit === "l") {
      const ml = unit === "l" ? value * 1000 : value;
      multiplier = ml / 100;
    } else {
      multiplier = value / 100; // Default
    }

    return {
      ingredient: ingredientName,
      amount,
      calories: Math.round(estimate.calories * multiplier),
      macros: {
        protein: Math.round(estimate.protein * multiplier),
        carbs: Math.round(estimate.carbs * multiplier),
        fat: Math.round(estimate.fat * multiplier),
      },
      source: "estimated",
    };
  }

  /**
   * Clear the ingredient cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    ingredientCache.clear();
    logger.info("[UsdaNutritionService] Cache cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: ingredientCache.size,
      keys: Array.from(ingredientCache.keys()),
    };
  }
}
