import { Injectable } from "@nestjs/common";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import logger from "../utils/logger";
import { compressImage } from "../utils/imageCompression";
import {
  RecognizedMealResponse,
  NutritionResponse,
} from "./dto/recognize-meal.dto";

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

// Helper to get error message
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

@Injectable()
export class PhotoRecognitionService {
  private genAI: GoogleGenerativeAI | null = null;
  private readonly USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
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
    if (!this.genAI) {
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

      // Get the model with vision capabilities
      const model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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

      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = result.response;
      const text = response.text();

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

      const foods = searchResponse.data.foods;

      if (!foods || foods.length === 0) {
        logger.info(`[PhotoRecognition] No USDA results for: ${mealName}`);
        return null;
      }

      // Get the first (most relevant) result
      const food = foods[0];
      logger.info(`[PhotoRecognition] USDA match: ${food.description} (fdcId: ${food.fdcId})`);

      // Extract nutrients
      const nutrients = food.foodNutrients || [];

      const findNutrient = (name: string): number => {
        const nutrient = nutrients.find(
          (n: any) =>
            n.nutrientName?.toLowerCase().includes(name.toLowerCase()) ||
            n.nutrientNumber === name
        );
        return Math.round(nutrient?.value || 0);
      };

      // Nutrient IDs: Energy (1008), Protein (1003), Carbs (1005), Fat (1004)
      const calories =
        findNutrient("energy") || findNutrient("calories") || findNutrient("1008");
      const protein = findNutrient("protein") || findNutrient("1003");
      const carbs =
        findNutrient("carbohydrate") || findNutrient("carbs") || findNutrient("1005");
      const fat = findNutrient("fat") || findNutrient("total lipid") || findNutrient("1004");

      // Get serving size info
      const servingSize = food.servingSize
        ? `${food.servingSize} ${food.servingSizeUnit || "g"}`
        : food.householdServingFullText || "100g";

      return {
        calories,
        macros: {
          protein,
          carbs,
          fat,
        },
        servingSize,
        source: "USDA FoodData Central",
        fdcId: food.fdcId?.toString(),
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.error(`[PhotoRecognition] USDA API error: ${errorMsg}`);
      return null;
    }
  }
}
