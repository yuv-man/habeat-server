import { Injectable } from "@nestjs/common";
import axios from "axios";
import logger from "../utils/logger";
import { compressImage } from "../utils/imageCompression";
import {
  RecognizedMealResponse,
  NutritionResponse,
} from "./dto/recognize-meal.dto";
import {
  generateVisionWithRateLimit,
  generateTextWithRateLimit,
  getErrorMessage,
} from "../utils/gemini-rate-limiter";

// Helper to extract and clean JSON from LLM response
const extractAndCleanJSON = (text: string): string => {
  let cleaned = text;

  // Try to extract JSON from code blocks
  const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  }

  // Remove any remaining code block markers
  cleaned = cleaned.replace(/```/g, "").trim();

  // Find the JSON object
  const startBrace = cleaned.indexOf("{");
  const endBrace = cleaned.lastIndexOf("}");

  if (startBrace !== -1 && endBrace !== -1 && endBrace > startBrace) {
    cleaned = cleaned.slice(startBrace, endBrace + 1);
  }

  return cleaned.trim();
};

@Injectable()
export class PhotoRecognitionService {
  private readonly USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";
  private readonly apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (this.apiKey) {
      logger.info("[PhotoRecognition] Gemini AI initialized");
    } else {
      logger.warn(
        "[PhotoRecognition] GEMINI_API_KEY not set - photo recognition will not work"
      );
    }
  }

  /**
   * Recognize a meal from a photo using Gemini Vision API
   */
  async recognizeMealFromPhoto(
    imageBase64: string
  ): Promise<RecognizedMealResponse> {
    if (!this.apiKey) {
      logger.error("[PhotoRecognition] Gemini AI not initialized");
      return {
        mealName: "",
        confidence: "none",
        description: "AI service not available. Please enter the meal name manually.",
      };
    }

    try {
      // Compress image before sending to API (max 800x800, 200KB for better recognition)
      const compressedImage = await compressImage(imageBase64, 800, 800, 85, 200);

      // Remove data URI prefix if present
      const base64Data = compressedImage.includes(",")
        ? compressedImage.split(",")[1]
        : compressedImage;

      const prompt = `You are a food recognition expert. Analyze this image and identify the meal/food.

Respond ONLY with a valid JSON object in this exact format (no markdown, no code blocks, no extra text):
{
  "mealName": "Primary name of the dish (e.g., 'Grilled Chicken Salad')",
  "confidence": "high",
  "description": "Brief description of what you see in the image",
  "estimatedCalories": 450,
  "estimatedMacros": {
    "protein": 35,
    "carbs": 20,
    "fat": 15
  }
}

Rules:
1. Be specific with the meal name (e.g., "Caesar Salad with Grilled Chicken" not just "Salad")
2. If you see multiple items, identify the main dish
3. Set confidence to "high" if clearly identifiable, "medium" if somewhat unclear, "low" if very uncertain
4. If you cannot identify food in the image, set confidence to "none" and mealName to empty string
5. Provide reasonable calorie and macro estimates based on a typical serving size
6. ONLY output the JSON, nothing else`;

      // Use rate-limited wrapper with retry logic
      // Using gemini-2.5-flash-lite for better free tier rate limits
      const text = await generateVisionWithRateLimit(
        this.apiKey,
        "gemini-2.5-flash-lite",
        prompt,
        base64Data,
        "image/jpeg",
        {
          maxRetries: 3,
          timeoutMs: 30000,
          context: "PhotoRecognition",
        }
      );

      logger.info(`[PhotoRecognition] Raw Gemini response: ${text.substring(0, 500)}`);

      // Parse the response
      const cleanedJSON = extractAndCleanJSON(text);
      const parsed = JSON.parse(cleanedJSON);

      return {
        mealName: parsed.mealName || "",
        confidence: parsed.confidence || "low",
        description: parsed.description || "Unable to describe the meal",
        aiEstimates: {
          calories: parsed.estimatedCalories || 0,
          macros: {
            protein: parsed.estimatedMacros?.protein || 0,
            carbs: parsed.estimatedMacros?.carbs || 0,
            fat: parsed.estimatedMacros?.fat || 0,
          },
        },
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.error(`[PhotoRecognition] Gemini Vision error: ${errorMsg}`);

      return {
        mealName: "",
        confidence: "none",
        description: `Could not recognize meal: ${errorMsg}. Please enter the name manually.`,
      };
    }
  }

  /**
   * Fetch nutrition data from USDA FoodData Central API
   */
  async getNutritionFromUSDA(mealName: string): Promise<NutritionResponse | null> {
    const apiKey = process.env.USDA_API_KEY;

    if (!apiKey) {
      logger.warn("[PhotoRecognition] USDA_API_KEY not set");
      return null;
    }

    try {
      // Search for the food item
      const searchResponse = await axios.get(`${this.USDA_API_BASE}/foods/search`, {
        params: {
          api_key: apiKey,
          query: mealName,
          pageSize: 5,
          dataType: ["Survey (FNDDS)", "Foundation", "SR Legacy"].join(","),
        },
      });

      let foods = searchResponse.data.foods;

      // If no results, retry with a simplified query (strip connector words like "with", "and")
      if (!foods || foods.length === 0) {
        const simplified = mealName
          .replace(/\b(with|and|&|or|topped|served|on|a|of)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (simplified.toLowerCase() !== mealName.toLowerCase().trim()) {
          logger.info(`[PhotoRecognition] Retrying USDA with simplified query: "${simplified}"`);
          const retryResponse = await axios.get(`${this.USDA_API_BASE}/foods/search`, {
            params: {
              api_key: apiKey,
              query: simplified,
              pageSize: 5,
              dataType: ["Survey (FNDDS)", "Foundation", "SR Legacy"].join(","),
            },
          });
          foods = retryResponse.data.foods;
        }
      }

      if (!foods || foods.length === 0) {
        logger.info(`[PhotoRecognition] No USDA results for: ${mealName}`);
        return null;
      }

      // Get the first (most relevant) result
      const food = foods[0];
      logger.info(`[PhotoRecognition] USDA match: ${food.description} (fdcId: ${food.fdcId})`);

      // Extract nutrients. For Foundation / SR Legacy / FNDDS foods these
      // values are PER 100 g — not per serving. Returning them as-is is what
      // made a beef quesadilla read as ~350 kcal (its per-100g energy) instead
      // of a realistic ~700-900 kcal serving.
      const nutrients = food.foodNutrients || [];

      const findNutrient = (name: string): number => {
        const nutrient = nutrients.find(
          (n: any) =>
            n.nutrientName?.toLowerCase().includes(name.toLowerCase()) ||
            n.nutrientNumber === name
        );
        return nutrient?.value || 0;
      };

      // Nutrient IDs: Energy (1008), Protein (1003), Carbs (1005), Fat (1004)
      const caloriesPer100g =
        findNutrient("energy") || findNutrient("calories") || findNutrient("1008");
      const proteinPer100g = findNutrient("protein") || findNutrient("1003");
      const carbsPer100g =
        findNutrient("carbohydrate") || findNutrient("carbs") || findNutrient("1005");
      const fatPer100g = findNutrient("fat") || findNutrient("total lipid") || findNutrient("1004");

      // How many grams is one serving? Only trust an explicit weight:
      //   - servingSize in g/ml, or
      //   - the largest food portion's gramWeight.
      // A composite prepared dish (e.g. a quesadilla) usually has neither in
      // the search payload — in which case a per-100g number is meaningless as
      // a "meal", so we bail to the AI estimate (which is per serving) rather
      // than report a wrong figure.
      const unit = (food.servingSizeUnit || "").toLowerCase();
      const portionGrams: number | null =
        typeof food.servingSize === "number" && (unit === "g" || unit === "ml")
          ? food.servingSize
          : Array.isArray(food.foodPortions) && food.foodPortions.length
            ? food.foodPortions
                .map((fp: any) => fp?.gramWeight)
                .filter((g: any) => typeof g === "number" && g > 0)
                .sort((a: number, b: number) => b - a)[0] ?? null
            : null;

      if (!portionGrams) {
        logger.info(
          `[PhotoRecognition] USDA match "${food.description}" has no serving weight; per-100g values aren't a serving — deferring to AI estimate.`
        );
        return null;
      }

      const scale = portionGrams / 100;
      const calories = Math.round(caloriesPer100g * scale);

      // Guard against a degenerate match (zero energy) — also defer to AI.
      if (calories <= 0) {
        return null;
      }

      return {
        calories,
        macros: {
          protein: Math.round(proteinPer100g * scale),
          carbs: Math.round(carbsPer100g * scale),
          fat: Math.round(fatPer100g * scale),
        },
        servingSize: `${Math.round(portionGrams)} g`,
        source: "USDA FoodData Central",
        fdcId: food.fdcId?.toString(),
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.error(`[PhotoRecognition] USDA API error: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Estimate nutrition using AI (Gemini) when USDA has no match
   */
  async getNutritionFromAI(mealName: string): Promise<NutritionResponse | null> {
    if (!this.apiKey) {
      logger.warn("[PhotoRecognition] Gemini API key not set, cannot estimate nutrition");
      return null;
    }

    const prompt = `You are a professional nutritionist. Estimate the nutrition for a typical home serving of "${mealName}".

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "calories": 350,
  "macros": {
    "protein": 12,
    "carbs": 45,
    "fat": 8
  },
  "servingSize": "1 serving (approximately 250g)"
}

Base your estimate on a realistic home-cooked serving size. Be accurate — this is for health tracking.`;

    try {
      const text = await generateTextWithRateLimit(
        this.apiKey,
        "gemini-2.5-flash-lite",
        prompt,
        { maxRetries: 2, timeoutMs: 10000, context: "NutritionEstimate" }
      );
      const cleaned = extractAndCleanJSON(text);
      const parsed = JSON.parse(cleaned);
      logger.info(`[PhotoRecognition] AI nutrition estimate for "${mealName}": ${parsed.calories} cal`);
      return {
        calories: Math.round(parsed.calories || 0),
        macros: {
          protein: Math.round(parsed.macros?.protein || 0),
          carbs: Math.round(parsed.macros?.carbs || 0),
          fat: Math.round(parsed.macros?.fat || 0),
        },
        servingSize: parsed.servingSize || "1 serving",
        source: "AI Estimate",
      };
    } catch (error) {
      logger.error(`[PhotoRecognition] AI nutrition estimate failed: ${getErrorMessage(error)}`);
      return null;
    }
  }
}
