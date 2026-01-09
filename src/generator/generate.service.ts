import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import logger from "../utils/logger";
import { enumLanguage } from "../enums/enumLanguage";
import {
  IUserData,
  IParsedWeeklyPlanResponse,
  IMeal,
  IRecipe,
  IGoal,
} from "../types/interfaces";
import mongoose from "mongoose";
import { generateFullWeek } from "../mocks/mockWeeklyPlan";
import {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  calculateMacros,
} from "../utils/healthCalculations";
import { PATH_WORKOUTS_GOAL } from "../enums/enumPaths";
import { pathGuidelines, workoutCategories } from "./helper";
import {
  transformWeeklyPlan,
  MealPlanResponse,
  cleanMealData,
  convertAIIngredientsToMealFormat,
  convertMealIngredientsToRecipeFormat,
  MealIngredient,
} from "../utils/helpers";

// Helper function to extract error message
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return "Unknown error";
};

// Helper to get local date key in YYYY-MM-DD format (avoids timezone issues with toISOString which uses UTC)
const getLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper function to repair common JSON errors from LLM responses
const repairJSON = (jsonString: string): string => {
  let repaired = jsonString;
  repaired = repaired.replace(/\/\/.*$/gm, "");
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, "");
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");
  repaired = repaired.replace(/,(\s*\n\s*[}\]])/g, "$1");
  repaired = repaired.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;

  if (openBraces > closeBraces && openBraces - closeBraces <= 2) {
    repaired += "}".repeat(openBraces - closeBraces);
  }
  if (openBrackets > closeBrackets && openBrackets - closeBrackets <= 2) {
    repaired += "]".repeat(openBrackets - closeBrackets);
  }

  return repaired.trim();
};

// Helper function to extract and clean JSON from LLM response
const extractAndCleanJSON = (text: string): string => {
  let cleaned = text;
  const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  }

  cleaned = cleaned.replace(/```/g, "").trim();
  cleaned = cleaned.replace(/^\s*\w+\s*=\s*\{/gm, "{");
  cleaned = cleaned.replace(/^\s*\w+\s*=\s*\[/gm, "[");

  const lines = cleaned.split("\n");
  let jsonStartLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*\w+\s*=/.test(lines[i]) ||
      /^\s*#/.test(lines[i]) ||
      /^\s*\/\//.test(lines[i])
    ) {
      continue;
    }
    if (lines[i].includes("{") || lines[i].includes("[")) {
      jsonStartLine = i;
      break;
    }
  }

  if (jsonStartLine >= 0) {
    cleaned = lines.slice(jsonStartLine).join("\n");
  }

  let braceCount = 0;
  let jsonStart = -1;
  let jsonEnd = -1;

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (braceCount === 0) {
        jsonStart = i;
      }
      braceCount++;
    } else if (cleaned[i] === "}") {
      braceCount--;
      if (braceCount === 0 && jsonStart >= 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd);
  } else {
    let bracketCount = 0;
    let arrayStart = -1;
    let arrayEnd = -1;

    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === "[") {
        if (bracketCount === 0) {
          arrayStart = i;
        }
        bracketCount++;
      } else if (cleaned[i] === "]") {
        bracketCount--;
        if (bracketCount === 0 && arrayStart >= 0) {
          arrayEnd = i + 1;
          break;
        }
      }
    }

    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      cleaned = cleaned.slice(arrayStart, arrayEnd);
    }
  }

  cleaned = repairJSON(cleaned);
  return cleaned;
};

// Helper function to call Ollama API
const callOllama = async (
  prompt: string,
  model: string = "phi",
  isWeeklyPlan: boolean = false
): Promise<string> => {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    await axios.get(`${ollamaBaseUrl}/api/tags`, { timeout: 5000 });
  } catch (error) {
    throw new Error(
      `Ollama is not running at ${ollamaBaseUrl}. Start Ollama first with: ollama serve`
    );
  }

  try {
    const timeout = isWeeklyPlan ? 600000 : 300000;

    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          num_predict: isWeeklyPlan ? 8000 : 4000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: timeout,
      }
    );

    if (response.data && response.data.response) {
      return response.data.response;
    }
    throw new Error("Invalid response from Ollama API");
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    throw new Error(`Ollama API error: ${errorMsg}`);
  }
};

// Check which Gemini models are available
const getAvailableGeminiModels = async (apiKey: string): Promise<string[]> => {
  try {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
      { timeout: 5000 }
    );

    const allModels = (response.data.models || [])
      .filter((model: any) =>
        model.supportedGenerationMethods?.includes("generateContent")
      )
      .map((model: any) => {
        // Extract model name from path like "models/gemini-2.5-flash"
        return model.name.split("/")[1];
      })
      .filter((name: string) => name && name.includes("gemini"));

    // Prioritize better models
    const priorityOrder = [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
      "gemini-2.5-flash-lite",
    ];

    const sortedModels = allModels.sort((a: string, b: string) => {
      const indexA = priorityOrder.indexOf(a);
      const indexB = priorityOrder.indexOf(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    logger.info(`[Gemini] Available models: ${sortedModels.join(", ")}`);
    return sortedModels;
  } catch (error: unknown) {
    logger.warn(
      `[Gemini] Could not list available models: ${getErrorMessage(error)}`
    );
    // Return default models as fallback
    return [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
    ];
  }
};

// Generic retry logic with exponential backoff
const retryWithBackoffGeneric = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = "AI"
): Promise<T> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger.info(`[${context}] Attempt ${attempt + 1}/${maxRetries}...`);
      return await fn();
    } catch (err: unknown) {
      const errorMsg = getErrorMessage(err);
      const isRetryable =
        errorMsg.includes("503") ||
        errorMsg.includes("overloaded") ||
        errorMsg.includes("429") ||
        errorMsg.includes("500") ||
        errorMsg.includes("502") ||
        errorMsg.includes("504") ||
        errorMsg.includes("timed out");

      if (!isRetryable || attempt === maxRetries - 1) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(
        `[${context}] Attempt ${attempt + 1} failed (retryable). Waiting ${delay}ms before retry...`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`[${context}] Max retries exceeded`);
};

// Backward compatible wrapper for MealPlanResponse
const retryWithBackoff = async (
  fn: () => Promise<MealPlanResponse>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<MealPlanResponse> => {
  return retryWithBackoffGeneric(fn, maxRetries, baseDelay, "Gemini");
};

// Generic AI generation with model fallback and timeout
const generateWithFallback = async <T>(
  prompt: string,
  parseResponse: (text: string) => T,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    context?: string;
  } = {}
): Promise<T> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const { timeoutMs = 60000, maxRetries = 3, context = "AI" } = options;

  const genAI = new GoogleGenerativeAI(apiKey);

  // Get available models
  const availableModels = await getAvailableGeminiModels(apiKey);
  const modelsToTry =
    availableModels.length > 0
      ? availableModels
      : ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

  logger.info(`[${context}] Will try models: ${modelsToTry.join(", ")}`);

  const callModelWithTimeout = async (modelName: string): Promise<T> => {
    logger.info(
      `[${context}] Calling ${modelName} (timeout: ${timeoutMs / 1000}s)`
    );

    const model = genAI.getGenerativeModel({ model: modelName });

    // Create timeout promise
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `[${context}] Request to ${modelName} timed out after ${timeoutMs / 1000}s`
          )
        );
      }, timeoutMs);
    });

    try {
      const resultPromise = (async () => {
        const result = await model.generateContent([
          { text: prompt + "\n\nReturn ONLY JSON. No other text." },
        ]);

        clearTimeout(timeoutHandle!);

        if (!result || !result.response) {
          throw new Error("Empty response from Gemini API");
        }

        const responseText = result.response.text();
        if (!responseText || responseText.trim().length === 0) {
          throw new Error("Gemini returned empty response text");
        }

        logger.info(
          `[${context}] Received response: ${responseText.length} characters`
        );

        // Clean and parse JSON
        let cleanedJSON = extractAndCleanJSON(responseText);
        cleanedJSON = repairJSON(cleanedJSON);

        return parseResponse(cleanedJSON);
      })();

      return await Promise.race([resultPromise, timeoutPromise]);
    } catch (error: unknown) {
      clearTimeout(timeoutHandle!);
      const errorMsg = getErrorMessage(error);

      if (
        errorMsg.includes("401") ||
        errorMsg.includes("403") ||
        errorMsg.includes("API_KEY_INVALID")
      ) {
        throw new Error(`Invalid Gemini API key: ${errorMsg}`);
      }
      if (errorMsg.includes("429") || errorMsg.includes("quota")) {
        throw new Error(`Gemini quota exceeded: ${errorMsg}`);
      }

      throw error;
    }
  };

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      return await retryWithBackoffGeneric(
        () => callModelWithTimeout(modelName),
        maxRetries,
        2000,
        context
      );
    } catch (error: unknown) {
      lastError =
        error instanceof Error ? error : new Error(getErrorMessage(error));
      logger.warn(
        `[${context}] Model ${modelName} failed: ${getErrorMessage(error)}`
      );

      if (modelsToTry.indexOf(modelName) < modelsToTry.length - 1) {
        logger.info(`[${context}] Trying next model...`);
      }
    }
  }

  throw (
    lastError ||
    new Error(
      `[${context}] All models failed. Tried: ${modelsToTry.join(", ")}`
    )
  );
};

// Gemini generation with timeout
const generateMealPlanWithGemini = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly",
  language: string,
  apiKey: string,
  goals: IGoal[] = []
): Promise<MealPlanResponse> => {
  if (!apiKey.startsWith("AIza") || apiKey.length < 39) {
    logger.warn(
      `GEMINI_API_KEY format may be invalid. Expected format: "AIza..." with length 39+. Current length: ${apiKey.length}`
    );
  }

  let genAI: GoogleGenerativeAI;
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    logger.info("Gemini API client initialized");
  } catch (error: unknown) {
    throw new Error(`Failed to initialize Gemini: ${getErrorMessage(error)}`);
  }

  // Get available models for this API key
  logger.info("[Gemini] Checking available models...");
  const availableModels = await getAvailableGeminiModels(apiKey);

  // Use available models, or fallback to known working models
  const modelsToTry =
    availableModels.length > 0
      ? availableModels
      : [
          "gemini-2.5-flash",
          "gemini-2.5-pro",
          "gemini-2.0-flash",
          "gemini-2.0-flash-001",
        ];

  if (modelsToTry.length === 0) {
    throw new Error(
      "No Gemini models available. Please check your API key and quota."
    );
  }

  logger.info(`[Gemini] Will try models in order: ${modelsToTry.join(", ")}`);

  const { prompt, dayToName, nameToDay, dates, activeDays, workoutDays } =
    buildPrompt(userData, planType, language, weekStartDate, goals);

  // Helper to get day name from date string
  const getDayNameFromDate = (dateStr: string): string => {
    try {
      if (!dateStr || typeof dateStr !== "string") {
        return "monday";
      }
      const date = new Date(dateStr);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        logger.warn(
          `[Gemini] Invalid date string: ${dateStr}, defaulting to monday`
        );
        return "monday";
      }
      const dayNum = date.getDay();
      return dayToName[dayNum] || "monday";
    } catch (error) {
      logger.warn(
        `[Gemini] Error parsing date string "${dateStr}": ${getErrorMessage(error)}, defaulting to monday`
      );
      return "monday";
    }
  };

  const callModelWithTimeout = async (
    modelName: string,
    timeoutMs: number = 120000
  ): Promise<MealPlanResponse> => {
    logger.info(
      `[Gemini] Calling ${modelName} (timeout: ${timeoutMs / 1000}s)`
    );

    let model;
    try {
      model = genAI.getGenerativeModel({ model: modelName });
    } catch (error: unknown) {
      throw new Error(
        `Failed to initialize model ${modelName}: ${getErrorMessage(error)}`
      );
    }

    // Create timeout that rejects after timeoutMs
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `[Gemini] Request to ${modelName} timed out after ${timeoutMs / 1000}s. Service may be overloaded.`
          )
        );
      }, timeoutMs);
    });

    try {
      logger.info(`[Gemini] Sending request to ${modelName}...`);

      const resultPromise = (async () => {
        const result = await model.generateContent([
          {
            text:
              prompt +
              "\n\nCRITICAL REQUIREMENTS:\n" +
              "1. You MUST generate meal plans for ALL 7 DAYS\n" +
              "2. Each day MUST include: breakfast, lunch, dinner, snacks, hydration, workouts\n" +
              "3. Return ONLY valid JSON\n" +
              "4. No markdown formatting or explanations\n\n",
          },
          {
            text: "Remember: Return ONLY the JSON object. No other text.",
          },
        ]);

        clearTimeout(timeoutHandle!);

        if (!result || !result.response) {
          throw new Error("Empty response from Gemini API");
        }

        const responseText = result.response.text();

        if (!responseText || responseText.trim().length === 0) {
          throw new Error("Gemini returned empty response text");
        }

        logger.info(
          `[Gemini] Received response from ${modelName}: ${responseText.length} characters`
        );

        return responseText;
      })();

      const responseText = await Promise.race([resultPromise, timeoutPromise]);

      // Use the same JSON extraction logic as Llama for consistency
      let cleanedJSON: string;
      try {
        cleanedJSON = extractAndCleanJSON(responseText);
      } catch (error: unknown) {
        logger.error(
          `[Gemini] Failed to extract JSON. Raw response (first 1000 chars): ${responseText.substring(0, 1000)}`
        );
        throw new Error(
          `Failed to extract JSON from Gemini response: ${getErrorMessage(error)}`
        );
      }

      if (!cleanedJSON || cleanedJSON.trim().length === 0) {
        logger.error(
          `[Gemini] Empty JSON after extraction. Raw response (first 1000 chars): ${responseText.substring(0, 1000)}`
        );
        throw new Error("Failed to extract JSON from Gemini response");
      }

      logger.info(`[Gemini] Parsing JSON from response...`);
      logger.debug(
        `[Gemini] Extracted JSON preview (first 500 chars): ${cleanedJSON.substring(0, 500)}...`
      );

      let parsedResponse: any;
      try {
        parsedResponse = JSON.parse(cleanedJSON);
      } catch (parseError: unknown) {
        logger.error(
          `[Gemini] JSON parse error. Extracted JSON (first 2000 chars): ${cleanedJSON.substring(0, 2000)}`
        );
        throw new Error(
          `Failed to parse Gemini JSON: ${getErrorMessage(parseError)}`
        );
      }

      // Check if weeklyPlan exists at root or nested in mealPlan
      let weeklyPlan = parsedResponse?.weeklyPlan;
      if (!weeklyPlan && parsedResponse?.mealPlan?.weeklyPlan) {
        weeklyPlan = parsedResponse.mealPlan.weeklyPlan;
        logger.info(
          `[Gemini] Found weeklyPlan nested in mealPlan object, using it`
        );
      }

      // If weeklyPlan doesn't exist, check if days are at root level (monday, tuesday, etc.)
      // and convert them to date-keyed format
      if (!weeklyPlan) {
        const responseKeys = Object.keys(parsedResponse || {});
        const dayNames = [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ];

        // Check if response has day names as keys
        const hasDayKeys = dayNames.some((day) => responseKeys.includes(day));

        if (hasDayKeys) {
          logger.info(
            `[Gemini] Found days at root level, converting to date-keyed weeklyPlan object`
          );
          // Convert day-keyed object to date-keyed object
          const dateKeyedPlan: { [date: string]: any } = {};

          dayNames.forEach((dayName) => {
            if (parsedResponse[dayName]) {
              const dayData = parsedResponse[dayName];
              // Use the date from dayData, or calculate from dates array
              const dayIndex = dayNames.indexOf(dayName);
              let dateKey = dayData.date;

              // If no date in dayData, try to get it from dates array
              if (!dateKey && dates[dayIndex]) {
                try {
                  const date = dates[dayIndex];
                  // Validate date before getting local date key
                  if (date instanceof Date && !isNaN(date.getTime())) {
                    dateKey = getLocalDateKey(date);
                  } else {
                    logger.warn(
                      `[Gemini] Invalid date at index ${dayIndex} for ${dayName}, skipping`
                    );
                  }
                } catch (error) {
                  logger.warn(
                    `[Gemini] Error formatting date for ${dayName}: ${getErrorMessage(error)}`
                  );
                }
              }

              if (dateKey) {
                dateKeyedPlan[dateKey] = {
                  day: dayName,
                  date: dateKey,
                  ...dayData,
                };
              }
            }
          });

          weeklyPlan = dateKeyedPlan;
        }
      }

      if (!weeklyPlan) {
        const responseKeys = Object.keys(parsedResponse || {});
        const responsePreview = JSON.stringify(parsedResponse).substring(
          0,
          2000
        );
        const errorMsg = `Missing weeklyPlan in response. Response keys: ${responseKeys.join(", ")}. Response preview: ${responsePreview}`;
        logger.error(`[Gemini] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // weeklyPlan can be either array or object (date-keyed)
      // If it's an object, we need to convert it to array format for transformWeeklyPlan
      let weeklyPlanArray: any[] = [];

      if (Array.isArray(weeklyPlan)) {
        weeklyPlanArray = weeklyPlan;
      } else if (typeof weeklyPlan === "object") {
        // Convert date-keyed object to array format
        weeklyPlanArray = Object.entries(weeklyPlan).map(
          ([dateKey, dayData]: [string, any]) => ({
            day: dayData.day || getDayNameFromDate(dateKey),
            date: dateKey,
            ...dayData,
          })
        );
      } else {
        const errorMsg = `weeklyPlan is neither array nor object. Type: ${typeof weeklyPlan}, Value: ${JSON.stringify(weeklyPlan).substring(0, 500)}`;
        logger.error(`[Gemini] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (weeklyPlanArray.length === 0) {
        throw new Error("weeklyPlan is empty");
      }

      // Update parsedResponse to have weeklyPlan as array for transformWeeklyPlan
      parsedResponse = { weeklyPlan: weeklyPlanArray } as {
        weeklyPlan: Array<any>;
      };

      logger.info(
        `[Gemini] Successfully parsed ${parsedResponse.weeklyPlan.length} days`
      );

      return await transformWeeklyPlan(
        parsedResponse,
        dayToName,
        nameToDay,
        dates,
        activeDays,
        workoutDays,
        planType,
        language,
        weekStartDate
      );
    } catch (error: unknown) {
      clearTimeout(timeoutHandle!);

      const errorMsg = getErrorMessage(error);

      if (
        errorMsg.includes("401") ||
        errorMsg.includes("403") ||
        errorMsg.includes("API_KEY_INVALID")
      ) {
        throw new Error(`Invalid Gemini API key: ${errorMsg}`);
      }

      if (errorMsg.includes("429") || errorMsg.includes("quota")) {
        throw new Error(`Gemini quota exceeded: ${errorMsg}`);
      }

      if (errorMsg.includes("503") || errorMsg.includes("overloaded")) {
        throw new Error(`Gemini model overloaded: ${errorMsg}`);
      }

      throw new Error(`Gemini error: ${errorMsg}`);
    }
  };

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      logger.info(`[Gemini] Attempting model: ${modelName}`);
      return await retryWithBackoff(
        () => callModelWithTimeout(modelName, 120000),
        3,
        2000
      );
    } catch (error: unknown) {
      lastError =
        error instanceof Error ? error : new Error(getErrorMessage(error));
      const errorMsg = getErrorMessage(error);

      logger.warn(`[Gemini] Model ${modelName} failed: ${errorMsg}`);

      if (modelsToTry.indexOf(modelName) < modelsToTry.length - 1) {
        logger.info(`[Gemini] Trying next model...`);
      }
    }
  }

  throw (
    lastError ||
    new Error(
      `All available Gemini models failed. Tried: ${modelsToTry.join(", ")}`
    )
  );
};

// MAIN: Try Gemini first, fallback to Llama
const generateMealPlanWithAI = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly" = "daily",
  language: string = "en",
  useMock: boolean = false,
  goals: IGoal[] = []
): Promise<MealPlanResponse> => {
  try {
    if (useMock) {
      logger.info("Using mock data as requested");
      const mockPlan = generateFullWeek();
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve({
            mealPlan: { weeklyPlan: mockPlan },
            planType,
            language,
            generatedAt: new Date().toISOString(),
            fallbackModel: "mock",
          });
        }, 3000)
      );
    }

    // TRY GEMINI FIRST
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        logger.info("=== ATTEMPTING GEMINI (PRIMARY) ===");
        return await generateMealPlanWithGemini(
          userData,
          weekStartDate,
          planType,
          language,
          apiKey,
          goals
        );
      } catch (geminiError: unknown) {
        logger.warn(
          `Gemini failed: ${getErrorMessage(geminiError)}. Falling back to Llama...`
        );
      }
    } else {
      logger.warn("GEMINI_API_KEY not configured, using Llama");
    }

    // FALLBACK TO LLAMA
    try {
      logger.info("=== ATTEMPTING LLAMA (FALLBACK) ===");
      return await generateMealPlanWithLlama2(
        userData,
        weekStartDate,
        planType,
        language,
        false,
        goals
      );
    } catch (llamaError: unknown) {
      throw new Error(
        `Both Gemini and Llama failed. Llama: ${getErrorMessage(llamaError)}`
      );
    }
  } catch (error: unknown) {
    logger.error("Meal plan generation failed:", error);
    throw error;
  }
};

// Helper function to determine goal-based adjustments
const getGoalBasedAdjustments = (
  goals: IGoal[]
): {
  workoutTypes: string[];
  calorieAdjustment: number;
  macroAdjustments?: { protein?: number; carbs?: number; fat?: number };
  workoutFrequency?: number;
  goalDescription: string;
} => {
  if (!goals || goals.length === 0) {
    return {
      workoutTypes: [],
      calorieAdjustment: 0,
      goalDescription: "",
    };
  }

  // Analyze goals to determine adjustments
  const goalKeywords = goals.map((g) => ({
    title: g.title.toLowerCase(),
    description: g.description.toLowerCase(),
    unit: g.unit.toLowerCase(),
  }));

  let workoutTypes: string[] = [];
  let calorieAdjustment = 0;
  let macroAdjustments: { protein?: number; carbs?: number; fat?: number } = {};
  let workoutFrequency: number | undefined;
  const goalDescriptions: string[] = [];

  goalKeywords.forEach((goal, index) => {
    const fullText = `${goal.title} ${goal.description}`;
    goalDescriptions.push(
      `${goals[index].title}: ${goals[index].description} (Target: ${goals[index].target} ${goals[index].unit})`
    );

    // Marathon/Running goals
    if (
      fullText.includes("marathon") ||
      fullText.includes("run") ||
      goal.unit.includes("km") ||
      goal.unit.includes("mile")
    ) {
      workoutTypes.push("running", "endurance", "cardio");
      calorieAdjustment += 400; // Extra calories for endurance training (marathon training is very demanding)
      macroAdjustments.carbs = (macroAdjustments.carbs || 0) + 15; // Increase carbs significantly for endurance (carbs are primary fuel)
      macroAdjustments.protein = (macroAdjustments.protein || 0) + 5; // Slight protein increase for recovery
      workoutFrequency = Math.max(workoutFrequency || 0, 5); // More frequent training (5-6x/week for marathon prep)
    }

    // Strength/Muscle goals
    if (
      fullText.includes("muscle") ||
      fullText.includes("strength") ||
      fullText.includes("lift") ||
      fullText.includes("weight")
    ) {
      workoutTypes.push("strength", "weights", "bodyweight");
      calorieAdjustment += 500; // Extra calories for muscle building (need surplus)
      macroAdjustments.protein = (macroAdjustments.protein || 0) + 20; // Significant protein increase (1.6-2.2g per kg bodyweight)
      macroAdjustments.carbs = (macroAdjustments.carbs || 0) + 10; // Increase carbs for training energy
      workoutFrequency = Math.max(workoutFrequency || 0, 4); // 4-6x/week for muscle building
    }

    // Weight loss goals
    if (
      fullText.includes("lose") ||
      fullText.includes("weight") ||
      fullText.includes("fat")
    ) {
      workoutTypes.push("cardio", "hiit", "strength");
      calorieAdjustment -= 300; // Moderate deficit for weight loss
      macroAdjustments.protein = (macroAdjustments.protein || 0) + 15; // Higher protein for satiety and muscle preservation
      workoutFrequency = Math.max(workoutFrequency || 0, 5); // 5-6x/week for weight loss
    }

    // Flexibility/Yoga goals
    if (
      fullText.includes("flexibility") ||
      fullText.includes("yoga") ||
      fullText.includes("stretch")
    ) {
      workoutTypes.push("yoga", "flexibility", "stretching");
      workoutFrequency = Math.max(workoutFrequency || 0, 3);
    }
  });

  // Remove duplicates
  workoutTypes = [...new Set(workoutTypes)];

  return {
    workoutTypes,
    calorieAdjustment,
    macroAdjustments:
      Object.keys(macroAdjustments).length > 0 ? macroAdjustments : undefined,
    workoutFrequency,
    goalDescription: goalDescriptions.join("; "),
  };
};

const buildPrompt = (
  userData: IUserData,
  planType: "daily" | "weekly",
  language: string,
  weekStartDate: Date,
  goals: IGoal[] = []
): {
  prompt: string;
  dayToName: Record<number, string>;
  nameToDay: Record<string, number>;
  dates: Date[];
  activeDays: number[];
  workoutDays: number[];
} => {
  // --- 1. CALCULATIONS & SETUP ---
  const goalAdjustments = getGoalBasedAdjustments(goals);

  const bmr = calculateBMR(
    userData.weight,
    userData.height,
    userData.age,
    userData.gender
  );

  // Balance workout frequency
  const userWorkoutFrequency = userData.workoutFrequency;
  const goalWorkoutFrequency = goalAdjustments.workoutFrequency;
  const effectiveWorkoutFrequency =
    goalWorkoutFrequency && userWorkoutFrequency
      ? Math.max(goalWorkoutFrequency, userWorkoutFrequency)
      : goalWorkoutFrequency || userWorkoutFrequency;

  const tdee = calculateTDEE(bmr, effectiveWorkoutFrequency);

  // Calorie & Macro Math
  const baseTargetCalories = calculateTargetCalories(tdee, userData.path);
  const targetCalories = Math.max(
    1200,
    baseTargetCalories + goalAdjustments.calorieAdjustment
  );

  let macros = calculateMacros(targetCalories, userData.path);
  if (goalAdjustments.macroAdjustments) {
    macros = {
      protein: Math.max(
        0,
        macros.protein + (goalAdjustments.macroAdjustments.protein || 0)
      ),
      carbs: Math.max(
        0,
        macros.carbs + (goalAdjustments.macroAdjustments.carbs || 0)
      ),
      fat: Math.max(
        0,
        macros.fat + (goalAdjustments.macroAdjustments.fat || 0)
      ),
    };
  }

  // --- 2. DATE & DAY GENERATION ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const actualStartDate = today;
  const currentDay = actualStartDate.getDay();

  const daysToGenerate: number[] = [];
  const dates: Date[] = [];

  // Generate logic (Monday-Sunday logic)
  if (currentDay === 0) {
    daysToGenerate.push(0);
    dates.push(new Date(actualStartDate));
  } else {
    for (let day = currentDay; day <= 6; day++) {
      daysToGenerate.push(day);
      const date = new Date(actualStartDate);
      date.setDate(actualStartDate.getDate() + (day - currentDay));
      dates.push(date);
    }
    daysToGenerate.push(0);
    const sundayDate = new Date(actualStartDate);
    sundayDate.setDate(actualStartDate.getDate() + (7 - currentDay));
    dates.push(sundayDate);
  }

  // --- 3. WORKOUT DISTRIBUTION LOGIC (FIXED) ---
  const dayToName: Record<number, string> = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
    0: "sunday",
  };
  const nameToDay: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  };

  const defaultWorkoutsPerWeek =
    PATH_WORKOUTS_GOAL[userData.path as keyof typeof PATH_WORKOUTS_GOAL];
  const totalWorkoutsPerWeek =
    effectiveWorkoutFrequency ??
    userData.workoutFrequency ??
    defaultWorkoutsPerWeek;

  const daysLeft = daysToGenerate.length;
  const workoutsToInclude = Math.min(totalWorkoutsPerWeek, daysLeft);

  // Calculate specific INDICES for workouts to distribute them evenly
  const workoutIndices = Array.from({ length: workoutsToInclude }, (_, i) =>
    Math.floor((i * daysLeft) / workoutsToInclude)
  );

  // Map indices to actual Day Numbers
  const workoutDays = workoutIndices.map((i) => daysToGenerate[i]);

  // activeDays represents all days that will have meal plans
  const activeDays = daysToGenerate;

  // Create a Set of Date Strings that MUST have workouts
  // This explicitly binds the workout to a specific YYYY-MM-DD
  const workoutDatesSet = new Set(
    workoutIndices.map((i) => getLocalDateKey(dates[i]))
  );

  // --- 4. PROMPT CONSTRUCTION ---

  // Generate a rigid schedule map for the prompt to follow
  const dailyScheduleManifest = dates
    .map((date) => {
      const dateKey = getLocalDateKey(date);
      const dayName = dayToName[date.getDay()];
      const hasWorkout = workoutDatesSet.has(dateKey);
      return `- ${dateKey} (${dayName}): ${hasWorkout ? "MUST INCLUDE WORKOUT" : "Rest Day (No Workout)"}`;
    })
    .join("\n  ");

  const pathGuideline =
    pathGuidelines[userData.path as keyof typeof pathGuidelines] ||
    pathGuidelines.custom;

  // Goal & Preference Sections
  const goalContext = goalAdjustments.goalDescription
    ? `ACTIVE GOAL: ${goalAdjustments.goalDescription}\n  (Adjust meals/macros/workouts to achieve this)`
    : "GOAL: Maintain healthy lifestyle";

  const foodPrefs = userData.foodPreferences?.length
    ? `PREFERENCES: ${userData.foodPreferences.join(", ")}`
    : "No specific preferences";

  const dislikes = userData.dislikes?.length
    ? `AVOID: ${userData.dislikes.join(", ")}`
    : "No specific dislikes";

  const workoutFocus =
    goalAdjustments.workoutTypes.length > 0
      ? `FOCUS: ${goalAdjustments.workoutTypes.join(", ")}`
      : `FOCUS: ${Object.keys(workoutCategories).join(", ")}`;

  // Calculate meal-specific targets for better macro distribution
  const breakfastTarget = Math.round(targetCalories * 0.25); // ~25% of daily calories
  const lunchTarget = Math.round(targetCalories * 0.35); // ~35% of daily calories
  const dinnerTarget = Math.round(targetCalories * 0.3); // ~30% of daily calories
  const snackTarget = Math.round(targetCalories * 0.1); // ~10% of daily calories per snack

  const breakfastMacros = {
    protein: Math.round(macros.protein * 0.2),
    carbs: Math.round(macros.carbs * 0.5),
    fat: Math.round(macros.fat * 0.3),
  };
  const lunchMacros = {
    protein: Math.round(macros.protein * 0.3),
    carbs: Math.round(macros.carbs * 0.4),
    fat: Math.round(macros.fat * 0.3),
  };
  const dinnerMacros = {
    protein: Math.round(macros.protein * 0.35),
    carbs: Math.round(macros.carbs * 0.35),
    fat: Math.round(macros.fat * 0.3),
  };
  const snackMacros = {
    protein: Math.round(macros.protein * 0.15),
    carbs: Math.round(macros.carbs * 0.5),
    fat: Math.round(macros.fat * 0.25),
  };

  // THE OPTIMIZED PROMPT
  const prompt = `
You are a precision nutritionist and structured data generator. Create a highly varied ${planType} plan for a ${userData.age}y ${userData.gender} (${userData.height}cm/${userData.weight}kg).

====== CRITICAL VARIETY ENFORCEMENT ======
The user will reject this plan if meals are repeated. 
1. **NO REPEATS:** You must generate 21 unique distinct meals (7 breakfasts, 7 lunches, 7 dinners).
2. **PROTEIN ROTATION:** You must use a different primary protein source for every Lunch and Dinner (e.g., Mon=Chicken, Tue=Beef, Wed=Tofu, Thu=Fish, etc.).
3. **CUISINE ROTATION:** Every day must feature a different flavor profile (e.g., Mon=Italian, Tue=Mexican, Wed=Asian, etc.).

====== USER PROFILE & CONSTRAINTS ======
TARGETS:
- Daily Calories: ${targetCalories} kcal (±5%)
- Macros: P:${macros.protein}g, C:${macros.carbs}g, F:${macros.fat}g (±10%)
- Goal: ${goalContext}
- Path: ${userData.path}

DIETARY RULES:
- Allergies: ${userData.allergies ? userData.allergies.join(", ") : "None"}
- Restrictions: ${userData.dietaryRestrictions ? userData.dietaryRestrictions.join(", ") : "None"}
- Dislikes: ${dislikes}
- Food Preferences: ${foodPrefs}

MEAL FRAMEWORKS (Approximate):
- Breakfast: ~${breakfastTarget} kcal (P:${breakfastMacros.protein}g, C:${breakfastMacros.carbs}g, F:${breakfastMacros.fat}g)
- Lunch: ~${lunchTarget} kcal (P:${lunchMacros.protein}g, C:${lunchMacros.carbs}g, F:${lunchMacros.fat}g)
- Dinner: ~${dinnerTarget} kcal (P:${dinnerMacros.protein}g, C:${dinnerMacros.carbs}g, F:${dinnerMacros.fat}g)
- Snacks: ~${snackTarget} kcal (P:${snackMacros.protein}g, C:${snackMacros.carbs}g, F:${snackMacros.fat}g)

====== DATA STRUCTURE RULES ======
1. Return ONLY valid JSON. Do not include markdown formatting (like \`\`\`json).
2. Follow this schedule keys exactly: ${dailyScheduleManifest}
3. INGREDIENTS: Format as "ingredient|amount|unit|category" using RAW amounts.
4. MATH: Ensure (Protein*4 + Carbs*4 + Fat*9) matches the calorie total for each meal.

====== OUTPUT SCHEMA ======
{
  "weeklyPlan": {
    "YYYY-MM-DD": {
      "day": "string",
      "date": "YYYY-MM-DD",
      "variety_check": "Short string describing the cuisine/protein (e.g., 'Italian Chicken')", 
      "meals": {
        "breakfast": { 
          "name": "string", 
          "calories": number, 
          "macros": { "protein": number, "carbs": number, "fat": number }, 
          "ingredients": ["string"], 
          "prepTime": number 
        },
        "lunch": { ...same structure },
        "dinner": { ...same structure },
        "snacks": [{ ...same structure }]
      },
      "hydration": { "waterTarget": number, "recommendations": ["string"] },
      "workouts": [{ "name": "string", "category": "string", "duration": number, "caloriesBurned": number }]
    }
  }
}
`;

  return { prompt, dayToName, nameToDay, dates, activeDays, workoutDays };
};

const generateMealPlanWithLlama2 = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly" = "daily",
  language: string = "en",
  useMock: boolean = false,
  goals: IGoal[] = []
): Promise<MealPlanResponse> => {
  try {
    if (useMock) {
      const mockPlan = generateFullWeek();
      return {
        mealPlan: { weeklyPlan: mockPlan },
        planType,
        language,
        generatedAt: new Date().toISOString(),
        fallbackModel: "mock",
      };
    }

    const { prompt, dayToName, nameToDay, dates, activeDays, workoutDays } =
      buildPrompt(userData, planType, language, weekStartDate, goals);

    const ollamaModel = process.env.OLLAMA_MODEL || "phi";
    logger.info(`[Llama] Using model: ${ollamaModel}`);

    const fullPrompt =
      prompt +
      "\n\nReturn ONLY valid JSON. No variable assignments, code, or explanations.";

    const isWeeklyPlan = planType === "weekly";
    const generatedText = await callOllama(
      fullPrompt,
      ollamaModel,
      isWeeklyPlan
    );

    let cleanedJSON = extractAndCleanJSON(generatedText);

    if (!cleanedJSON || cleanedJSON.trim().length === 0) {
      throw new Error("Failed to extract JSON from Llama response");
    }

    let mealPlanData: IParsedWeeklyPlanResponse;
    try {
      mealPlanData = JSON.parse(cleanedJSON) as IParsedWeeklyPlanResponse;
    } catch (parseError: unknown) {
      throw new Error(
        `Failed to parse Llama JSON: ${getErrorMessage(parseError)}`
      );
    }

    // Use the same transformation as Gemini to ensure consistent format
    const transformedPlan = await transformWeeklyPlan(
      mealPlanData,
      dayToName,
      nameToDay,
      dates,
      activeDays,
      workoutDays,
      planType,
      language,
      weekStartDate
    );

    logger.info("[Llama] Meal plan generated successfully");

    return transformedPlan;
  } catch (error: unknown) {
    logger.error("[Llama] Generation failed:", error);
    throw new Error(`Llama failed: ${getErrorMessage(error)}`);
  }
};

const generateRecipeDetails = async (
  dishName: string,
  category: string,
  targetCalories: number,
  ingredients: MealIngredient[],
  dietaryRestrictions: string[] = [],
  servings: number,
  language: string = "en"
): Promise<IRecipe> => {
  // Convert meal ingredients directly to recipe format for the prompt
  // MealIngredient: [name, "200 g", "Proteins"] -> RecipeIngredient: { name, amount: "200", unit: "g" }
  const recipeIngredients = convertMealIngredientsToRecipeFormat(ingredients);

  // Create readable list for the prompt
  const ingredientsList = recipeIngredients
    .map((ing) => `${ing.name} (${ing.amount} ${ing.unit})`.trim())
    .join(", ");

  // Format ingredients as JSON for the recipe response
  const ingredientsJson = JSON.stringify(recipeIngredients, null, 2);

  const prompt = `Generate a detailed recipe for "${dishName}" in ${language}.

## Input Parameters:
- Dish Name: ${dishName}
- Category: ${category}
- Target Calories: approximately ${targetCalories} per serving
- Servings: ${servings}
- Available Ingredients: ${ingredientsList}
${dietaryRestrictions.length ? `- Dietary Restrictions (MUST follow): ${dietaryRestrictions.join(", ")}` : ""}

## Response Format:
Return ONLY valid JSON matching this EXACT structure:
{
  "mealName": "${dishName}",
  "mealId": "unique_meal_id_string",
  "description": "A brief description of the dish (max 500 chars)",
  "category": "${category}",
  "servings": ${servings},
  "prepTime": 15,
  "cookTime": 30,
  "difficulty": "easy|medium|hard",
  "macros": {
    "calories": ${targetCalories},
    "protein": 30,
    "carbs": 50,
    "fat": 15
  },
  "ingredients": ${ingredientsJson},
  "instructions": [
    {
      "step": 1,
      "instruction": "Preheat oven to 180°C",
      "time": 5,
      "temperature": 180
    },
    {
      "step": 2,
      "instruction": "Mix ingredients in a bowl",
      "time": 10,
      "temperature": null
    }
  ],
  "equipment": ["pan", "oven"],
  "tags": ["healthy", "quick"],
  "dietaryInfo": {
    "isVegetarian": false,
    "isVegan": false,
    "isGlutenFree": false,
    "isDairyFree": false,
    "isKeto": false,
    "isLowCarb": false
  },
  "language": "${language}",
  "usageCount": 1,
  "notes": "Additional notes about the recipe"
}

## Rules:
1. "mealName" - use the dish name provided: "${dishName}"
2. "mealId" - generate a unique lowercase snake_case identifier
3. "description" - brief appetizing description (max 500 characters)
4. "category" - must be exactly: "${category}"
5. "servings" - must be: ${servings}
6. "prepTime" - preparation time in minutes (integer, min 0)
7. "cookTime" - cooking time in minutes (integer, min 0)
8. "difficulty" - must be one of: "easy", "medium", "hard"
9. "macros" - all values in integers, calories should be close to ${targetCalories}
10. "ingredients" - array of objects with { "name": string, "amount": string, "unit": string }
11. "instructions" - array of step objects: { "step": number, "instruction": string, "time": number (minutes), "temperature": number (degrees in °C) or null if no cooking required }
12. "equipment" - array of required kitchen equipment
13. "tags" - relevant recipe tags
14. "dietaryInfo" - set boolean flags based on recipe characteristics${dietaryRestrictions.length ? ` and dietary restrictions: ${dietaryRestrictions.join(", ")}` : ""}
15. "language" - must be: "${language}"
16. "usageCount" - always 1 for new recipes
17. "notes" - additional notes about the recipe (max 500 characters)`;

  const parseResponse = (jsonText: string) => {
    const recipeData = JSON.parse(jsonText);
    return {
      _id: new mongoose.Types.ObjectId(),
      ...recipeData,
      generatedAt: new Date().toISOString(),
    };
  };

  return generateWithFallback(prompt, parseResponse, {
    timeoutMs: 60000,
    maxRetries: 3,
    context: "RecipeDetails",
  });
};

const generateMeal = async (
  mealName: string,
  targetCalories: number,
  category: string,
  dietaryRestrictions: string[] = [],
  preferences: string[] = [],
  dislikes: string[] = [],
  language: string = "en",
  aiRules?: string
): Promise<any> => {
  const prompt = `Generate a ${category} meal "${mealName}" in ${language}.

## Requirements:
- Target calories: ${targetCalories}
- Category: ${category}
${dietaryRestrictions.length ? `- Dietary restrictions: ${dietaryRestrictions.join(", ")}` : ""}
${preferences.length ? `- Preferences (try to include): ${preferences.join(", ")}` : ""}
${dislikes.length ? `- Dislikes (MUST avoid): ${dislikes.join(", ")}` : ""}
${aiRules ? `- Additional rules: ${aiRules}` : ""}

## Response Format:
{
  "name": "Meal Name",
  "calories": ${targetCalories},
  "macros": {"protein": 30, "carbs": 50, "fat": 15},
  "category": "${category}",
  "ingredients": [["ingredient_name", "100 g"]],
  "prepTime": 20
}`;

  const parseResponse = (jsonText: string) => {
    const mealData = JSON.parse(jsonText);
    return {
      _id: new mongoose.Types.ObjectId(),
      ...mealData,
      isCustom: true,
      generatedAt: new Date().toISOString(),
    };
  };

  return generateWithFallback(prompt, parseResponse, {
    timeoutMs: 60000,
    maxRetries: 3,
    context: "GenerateMeal",
  });
};

const generateMealSuggestions = async (
  mealCriteria: {
    category: "breakfast" | "lunch" | "dinner" | "snack";
    targetCalories?: number;
    dietaryRestrictions?: string[];
    preferences?: string[];
    dislikes?: string[];
    numberOfSuggestions?: number;
    aiRules?: string;
  },
  language: string = "en"
): Promise<IMeal[]> => {
  const numberOfSuggestions = mealCriteria.numberOfSuggestions || 3;
  const targetCalories = mealCriteria.targetCalories || 500;

  const prompt = `You are a professional nutritionist. Generate exactly ${numberOfSuggestions} unique ${mealCriteria.category} meal suggestions.

## Requirements:
- Category: ${mealCriteria.category}
- Target calories per meal: approximately ${targetCalories} calories (±10%)
- Language for meal names and ingredients: ${language}
${mealCriteria.dietaryRestrictions?.length ? `- Dietary restrictions (MUST follow): ${mealCriteria.dietaryRestrictions.join(", ")}` : ""}
${mealCriteria.preferences?.length ? `- Preferences (try to include): ${mealCriteria.preferences.join(", ")}` : ""}
${mealCriteria.dislikes?.length ? `- Dislikes (MUST avoid): ${mealCriteria.dislikes.join(", ")}` : ""}
${mealCriteria.aiRules ? `- Additional rules: ${mealCriteria.aiRules}` : ""}

## Response Format:
Return a JSON object with a "meals" array containing exactly ${numberOfSuggestions} meal objects.

Each meal MUST have ALL these fields:
{
  "meals": [
    {
      "name": "Meal Name",
      "calories": 500,
      "macros": {
        "protein": 30,
        "carbs": 50,
        "fat": 15
      },
      "category": "${mealCriteria.category}",
      "ingredients": [
        ["ingredient_name_with_underscores", "100 g"],
        ["another_ingredient", "50 ml"]
      ],
      "prepTime": 20
    }
  ]
}

## Rules:
1. "name" - descriptive meal name in ${language}
   - MUST use spaces between words (e.g., "Stuffed Bell Peppers", "Grilled Chicken Salad")
   - MUST use proper capitalization (Title Case, e.g., "Stuffed Bell Peppers" NOT "stuffed_bell_peppers")
   - DO NOT use underscores in meal names
2. "calories" - integer, close to ${targetCalories}
3. "macros" - protein, carbs, fat in grams (integers), must add up reasonably to calories
4. "category" - must be "${mealCriteria.category}"
5. "ingredients" - array of [name, amount] tuples
   - name: lowercase with underscores (e.g., "chicken_breast", "olive_oil")
   - amount: number followed by unit (e.g., "200 g", "50 ml", "2 pieces")
   - NOTE: Ingredient names use underscores, but meal names use spaces!
6. "prepTime" - preparation time in minutes (integer)`;

  // Helper function to normalize meal names (convert underscores to spaces and proper capitalization)
  const normalizeMealName = (name: string): string => {
    if (!name) return "Unnamed Meal";
    // Replace underscores with spaces
    let normalized = name.replace(/_/g, " ");
    // Convert to Title Case (capitalize first letter of each word)
    normalized = normalized
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
    return normalized;
  };

  const parseResponse = (jsonText: string): IMeal[] => {
    const parsed = JSON.parse(jsonText);
    const meals = parsed.meals || parsed;

    return (Array.isArray(meals) ? meals : [meals])
      .slice(0, numberOfSuggestions)
      .map((meal: any) => ({
        _id: new mongoose.Types.ObjectId().toString(),
        name: normalizeMealName(meal.name),
        calories: Math.round(meal.calories || targetCalories),
        macros: {
          protein: Math.round(meal.macros?.protein || 0),
          carbs: Math.round(meal.macros?.carbs || 0),
          fat: Math.round(meal.macros?.fat || 0),
        },
        category: mealCriteria.category,
        ingredients: Array.isArray(meal.ingredients)
          ? meal.ingredients.map((ing: any) => {
              if (Array.isArray(ing)) {
                return [String(ing[0] || ""), String(ing[1] || "")];
              }
              return [String(ing), ""];
            })
          : [],
        prepTime: Math.round(meal.prepTime || 30),
      }));
  };

  const meals = await generateWithFallback<IMeal[]>(prompt, parseResponse, {
    timeoutMs: 60000,
    maxRetries: 3,
    context: "MealSuggestions",
  });

  logger.info(
    `[generateMealSuggestions] Generated ${meals.length} meal suggestions for ${mealCriteria.category}`
  );

  return meals;
};

const generateSnack = async (
  snackName: string,
  dietaryRestrictions: string[] = [],
  language: string = "en"
): Promise<IMeal> => {
  const prompt = `Generate a snack "${snackName}" in ${language}.

## Requirements:
- Dietary restrictions (MUST follow): ${dietaryRestrictions.join(", ")}

## Response Format:
Return ONLY valid JSON matching this EXACT structure:
{
  "name": "Snack Name",
  "calories": 100,
  "macros": {
    "protein": 10,
    "carbs": 10,
    "fat": 10
  },
  "ingredients": [
    ["ingredient_name_with_underscores", "100 g", "Proteins"],
    ["another_ingredient", "50 ml", "Fruits"]
  ]
  "prepTime": 10
}

## Rules:
1. "name" - descriptive snack name in ${language}
2. "calories" - integer, close to 100
3. "macros" - protein, carbs, fat in grams (integers), must add up reasonably to calories
4. "ingredients" - array of [name, amount, category?] tuples
   - name: lowercase with underscores (e.g., "chicken_breast", "olive_oil")
   - amount: number followed by unit (e.g., "200 g", "50 ml", "2 pieces")
   - category: optional shopping bag category (e.g., "Proteins", "Grains", "Fruits")
5. "prepTime" - (integer, should be 0)`;

  const parseResponse = (jsonText: string) => {
    const snackData = JSON.parse(jsonText);
    return {
      _id: new mongoose.Types.ObjectId(),
      ...snackData,
    };
  };

  return generateWithFallback(prompt, parseResponse, {
    timeoutMs: 60000,
    maxRetries: 3,
    context: "GenerateSnack",
  });
};

const generateGoal = async (
  title: string,
  description: string,
  numberOfWorkouts: number,
  dietType: string,
  timeframe: string = "3 months",
  language: string = "en",
  startDate?: Date
): Promise<{
  title: string;
  description: string;
  target: number;
  unit: string;
  icon: string;
  milestones: Array<{
    id: string;
    title: string;
    targetValue: number;
    completed: boolean;
  }>;
  startDate: string;
  targetDate: string;
}> => {
  const prompt = `You are a fitness and nutrition coach. Generate a structured goal based on the following criteria:

## User Requirements:
- Goal title: ${title}
- Goal description: ${description}
- Number of workouts per week: ${numberOfWorkouts}
- Diet type: ${dietType}
- Timeframe: ${timeframe}
- Language: ${language}

## Response Format (JSON):
Return ONLY valid JSON matching this EXACT structure:
{
  "title": "Goal title (e.g., 'Run 5K', 'Lose 10kg', 'Build Muscle')",
  "description": "Detailed description of the goal",
  "target": <number>,
  "unit": "Unit of measurement (e.g., 'km', 'kg', 'lbs', 'reps', 'minutes')",
  "icon": "Icon name (e.g., 'run', 'weight', 'muscle', 'heart')",
  "milestones": [
    {
      "id": "m1",
      "title": "First milestone description",
      "targetValue": <number>,
      "completed": false
    },
    {
      "id": "m2",
      "title": "Second milestone description",
      "targetValue": <number>,
      "completed": false
    }
  ]
}

## Guidelines:
- Create 3-5 meaningful milestones that break down the main goal
- Milestones should be progressive (each one harder than the previous)
- Target value should be realistic based on the goal description
- Unit should match the goal type (km for running, kg for weight, etc.)
- Icon should be relevant to the goal type
- All milestone IDs should be unique (m1, m2, m3, etc.)
- All milestones should have completed: false initially

Return ONLY valid JSON, no additional text.`;

  // Helper function to parse timeframe and calculate target date
  const calculateTargetDate = (timeframe: string, startDate: Date): Date => {
    const start = new Date(startDate);
    const timeframeLower = timeframe.toLowerCase().trim();

    // Parse timeframe string (e.g., "3 months", "6 weeks", "30 days")
    const monthsMatch = timeframeLower.match(/(\d+)\s*(?:month|months|mo)/);
    const weeksMatch = timeframeLower.match(/(\d+)\s*(?:week|weeks|w)/);
    const daysMatch = timeframeLower.match(/(\d+)\s*(?:day|days|d)/);

    if (monthsMatch) {
      const months = parseInt(monthsMatch[1], 10);
      start.setMonth(start.getMonth() + months);
    } else if (weeksMatch) {
      const weeks = parseInt(weeksMatch[1], 10);
      start.setDate(start.getDate() + weeks * 7);
    } else if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      start.setDate(start.getDate() + days);
    } else {
      // Default to 3 months if can't parse
      start.setMonth(start.getMonth() + 3);
    }

    return start;
  };

  const parseResponse = (jsonText: string) => {
    const goalData = JSON.parse(jsonText);
    const actualStartDate = startDate || new Date();
    const targetDate = calculateTargetDate(timeframe, actualStartDate);

    return {
      title: goalData.title,
      description: goalData.description,
      target: goalData.target,
      unit: goalData.unit,
      icon: goalData.icon || "target",
      milestones: (goalData.milestones || []).map((m: any, index: number) => ({
        id: m.id || `m${index + 1}`,
        title: m.title,
        targetValue: m.targetValue,
        completed: false,
      })),
      startDate: actualStartDate.toISOString().split("T")[0],
      targetDate: targetDate.toISOString().split("T")[0],
    };
  };

  return generateWithFallback(prompt, parseResponse, {
    timeoutMs: 60000,
    maxRetries: 3,
    context: "GenerateGoal",
  });
};

const aiService = {
  generateMealPlanWithAI,
  generateRecipeDetails,
  generateMeal,
  generateMealPlanWithLlama2,
  generateMealSuggestions,
  generateSnack,
  generateGoal,
};

export default aiService;
