import { GenerativeModel } from "@google/generative-ai";
import axios from "axios";
import logger from "../utils/logger";
import {
  callGeminiWithRateLimit,
  getErrorMessage as getRateLimitErrorMessage,
  isRateLimitError,
  parseRetryDelay,
} from "../utils/gemini-rate-limiter";
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
  enrichPlanWithFavoriteMeals,
  MealPlanResponse,
  cleanMealData,
  convertAIIngredientsToMealFormat,
  convertMealIngredientsToRecipeFormat,
  MealIngredient,
  cleanIngredientName,
  assignIngredientCategory,
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
  isWeeklyPlan: boolean = false,
): Promise<string> => {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    await axios.get(`${ollamaBaseUrl}/api/tags`, { timeout: 5000 });
  } catch (error) {
    throw new Error(
      `Ollama is not running at ${ollamaBaseUrl}. Start Ollama first with: ollama serve`,
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
      },
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
      { timeout: 5000 },
    );

    const allModels = (response.data.models || [])
      .filter((model: any) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((model: any) => {
        // Extract model name from path like "models/gemini-2.5-flash"
        return model.name.split("/")[1];
      })
      .filter((name: string) => name && name.includes("gemini"));

    // Prioritize lite models for better rate limits on free tier
    const priorityOrder = [
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash-lite",
      "gemini-2.0-flash",
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
      `[Gemini] Could not list available models: ${getErrorMessage(error)}`,
    );
    // Return default models as fallback (prioritize lite for rate limits)
    return [
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ];
  }
};

// Module-level cache for Gemini model list — avoids redundant HTTP calls during parallel day generation
let _cachedGeminiModels: string[] | null = null;
let _modelCacheTimestamp = 0;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const getAvailableGeminiModelsCached = async (
  apiKey: string,
): Promise<string[]> => {
  if (
    _cachedGeminiModels &&
    Date.now() - _modelCacheTimestamp < MODEL_CACHE_TTL_MS
  ) {
    logger.info("[Gemini] Using cached model list");
    return _cachedGeminiModels;
  }
  const models = await getAvailableGeminiModels(apiKey);
  _cachedGeminiModels = models;
  _modelCacheTimestamp = Date.now();
  return models;
};

// Generic retry logic with exponential backoff
const retryWithBackoffGeneric = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = "AI",
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
        `[${context}] Attempt ${attempt + 1} failed (retryable). Waiting ${delay}ms before retry...`,
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
  baseDelay: number = 1000,
): Promise<MealPlanResponse> => {
  return retryWithBackoffGeneric(fn, maxRetries, baseDelay, "Gemini");
};

// Generic AI generation with rate limiting and automatic retry
const generateWithFallback = async <T>(
  prompt: string,
  parseResponse: (text: string) => T,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    context?: string;
  } = {},
): Promise<T> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Reduced defaults for faster response times
  const { timeoutMs = 30000, maxRetries = 3, context = "AI" } = options;

  // Use cached model list to avoid redundant API calls
  const availableModels = await getAvailableGeminiModelsCached(apiKey);

  // Use gemini-2.5-flash-lite for free tier (better rate limits than regular models)
  const preferredModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  const modelsToTry = preferredModels.filter((m) =>
    availableModels.includes(m),
  );

  // Fallback to first available if preferred not found
  if (modelsToTry.length === 0 && availableModels.length > 0) {
    modelsToTry.push(availableModels[0]);
  }

  if (modelsToTry.length === 0) {
    modelsToTry.push("gemini-1.5-flash"); // Last resort default
  }

  const modelName = modelsToTry[0];
  logger.info(`[${context}] Using model: ${modelName}`);

  // Use the centralized rate limiter with automatic retry
  return callGeminiWithRateLimit<T>(
    apiKey,
    modelName,
    async (model: GenerativeModel) => {
      const result = await model.generateContent([
        { text: prompt + "\n\nReturn ONLY JSON. No other text." },
      ]);

      if (!result || !result.response) {
        throw new Error("Empty response from Gemini API");
      }

      const responseText = result.response.text();
      if (!responseText || responseText.trim().length === 0) {
        throw new Error("Gemini returned empty response text");
      }

      logger.info(
        `[${context}] Received response: ${responseText.length} characters`,
      );

      // Clean and parse JSON
      let cleanedJSON = extractAndCleanJSON(responseText);
      cleanedJSON = repairJSON(cleanedJSON);

      return parseResponse(cleanedJSON);
    },
    {
      maxRetries,
      timeoutMs,
      context,
    },
  );
};

// Meal style rotation for variety — all simple, everyday home-cooking styles
const CUISINE_ROTATION = [
  "American home cooking",
  "simple Mediterranean",
  "classic comfort food",
  "simple Asian home cooking",
  "everyday Italian",
  "simple Mexican home cooking",
  "classic homestyle",
];
const PROTEIN_ROTATION = [
  "Chicken",
  "Beef",
  "Eggs",
  "Turkey",
  "Salmon",
  "Tuna",
  "Ground beef",
];

/**
 * Build a compact single-day prompt (~300 tokens vs ~3000 for the full 7-day prompt).
 * Called once per day in parallel, each with a distinct cuisine + protein from the rotation.
 */
const buildDayPrompt = (
  userData: IUserData,
  dateStr: string,
  dayName: string,
  dayIndex: number,
  hasWorkout: boolean,
  targetCalories: number,
  macros: { protein: number; carbs: number; fat: number },
  goalContextStr: string,
): string => {
  const bCal = Math.round(targetCalories * 0.25);
  const lCal = Math.round(targetCalories * 0.35);
  const dCal = Math.round(targetCalories * 0.3);
  const sCal = Math.round(targetCalories * 0.1);
  const cuisine = CUISINE_ROTATION[dayIndex % CUISINE_ROTATION.length];
  const protein = PROTEIN_ROTATION[dayIndex % PROTEIN_ROTATION.length];

  const avoidList =
    [
      ...(userData.allergies || []),
      ...(userData.dietaryRestrictions || []),
      ...(userData.dislikes || []),
    ].join(", ") || "none";

  const preferList = userData.foodPreferences?.join(", ") || "none";

  const workoutLine = hasWorkout
    ? `"workouts":[{"name":"<name>","category":"<cat>","duration":<min>,"caloriesBurned":<cal>}]`
    : `"workouts":[]`;

  return `Generate a single-day meal plan as JSON.
PERSON: ${userData.age}y ${userData.gender} ${userData.height}cm ${userData.weight}kg path=${userData.path}
DAILY TARGETS: ${targetCalories} kcal | P:${macros.protein}g C:${macros.carbs}g F:${macros.fat}g
AVOID: ${avoidList}
PREFER: ${preferList}
${goalContextStr ? `STYLE: ${goalContextStr.substring(0, 200)}` : ""}
DAY: ${dateStr} (${dayName}) | Style: ${cuisine} | Primary protein: ${protein}
${hasWorkout ? "WORKOUT: Include 1 workout today." : "REST DAY: No workout."}
CRITICAL: Use SIMPLE, everyday home-cooked meals that normal people make. Examples: scrambled eggs with toast, oatmeal with banana, grilled chicken with rice and vegetables, pasta with tomato sauce, chicken soup, beef stir-fry with rice, tuna sandwich, turkey wrap. NO exotic restaurant dishes.
MEAL CALORIE TARGETS:
- breakfast: ~${bCal} kcal
- lunch: ~${lCal} kcal
- dinner: ~${dCal} kcal
- snacks[0]: ~${sCal} kcal
INGREDIENT FORMAT: "ingredient_name|amount|unit|category"
- ingredient_name: RAW name only — NO "chopped", "diced", "minced", "fresh", "dried" etc.
- category: one of Proteins/Vegetables/Fruits/Grains/Dairy/Pantry/Spices
- Math: protein*4 + carbs*4 + fat*9 ≈ meal calories
RETURN ONLY THIS JSON (no markdown, no extra text):
{"date":"${dateStr}","day":"${dayName}","meals":{"breakfast":{"name":"...","calories":${bCal},"macros":{"protein":0,"carbs":0,"fat":0},"ingredients":["..."],"prepTime":0},"lunch":{"name":"...","calories":${lCal},"macros":{"protein":0,"carbs":0,"fat":0},"ingredients":["..."],"prepTime":0},"dinner":{"name":"...","calories":${dCal},"macros":{"protein":0,"carbs":0,"fat":0},"ingredients":["..."],"prepTime":0},"snacks":[{"name":"...","calories":${sCal},"macros":{"protein":0,"carbs":0,"fat":0},"ingredients":["..."],"prepTime":0}]},${workoutLine}}`;
};

/**
 * Build a multi-day prompt for batched generation (reduces API calls).
 * Generates 3-4 days per request to stay under rate limits while minimizing total requests.
 */
const buildMultiDayPrompt = (
  userData: IUserData,
  daysData: Array<{
    dateStr: string;
    dayName: string;
    dayIndex: number;
    hasWorkout: boolean;
  }>,
  targetCalories: number,
  macros: { protein: number; carbs: number; fat: number },
  goalContextStr: string,
): string => {
  const bCal = Math.round(targetCalories * 0.25);
  const lCal = Math.round(targetCalories * 0.35);
  const dCal = Math.round(targetCalories * 0.3);
  const sCal = Math.round(targetCalories * 0.1);

  const avoidList =
    [
      ...(userData.allergies || []),
      ...(userData.dietaryRestrictions || []),
      ...(userData.dislikes || []),
    ].join(", ") || "none";

  const preferList = userData.foodPreferences?.join(", ") || "none";

  // Build day specifications with variety enforcement
  const daySpecs = daysData
    .map((d) => {
      const cuisine = CUISINE_ROTATION[d.dayIndex % CUISINE_ROTATION.length];
      const protein = PROTEIN_ROTATION[d.dayIndex % PROTEIN_ROTATION.length];
      const workoutStr = d.hasWorkout ? "WORKOUT" : "REST";
      return `- ${d.dateStr} (${d.dayName}): ${cuisine} cuisine, ${protein} protein, ${workoutStr}`;
    })
    .join("\n");

  // Build expected JSON structure for each day
  const dayStructures = daysData
    .map((d) => {
      const workoutJson = d.hasWorkout
        ? `"workouts":[{"name":"...","category":"...","duration":30,"caloriesBurned":200}]`
        : `"workouts":[]`;
      return `{"date":"${d.dateStr}","day":"${d.dayName}","meals":{"breakfast":{...},"lunch":{...},"dinner":{...},"snacks":[{...}]},${workoutJson}}`;
    })
    .join(",\n    ");

  return `Generate a ${daysData.length}-day meal plan as a JSON array. Each day MUST be unique with different meals.

PERSON: ${userData.age}y ${userData.gender} ${userData.height}cm ${userData.weight}kg path=${userData.path}
DAILY TARGETS: ${targetCalories} kcal | P:${macros.protein}g C:${macros.carbs}g F:${macros.fat}g
AVOID: ${avoidList}
PREFER: ${preferList}
${goalContextStr ? `STYLE: ${goalContextStr.substring(0, 200)}` : ""}

DAYS TO GENERATE (each with DIFFERENT meal style and protein):
${daySpecs}

MEAL CALORIE TARGETS (per day):
- breakfast: ~${bCal} kcal
- lunch: ~${lCal} kcal
- dinner: ~${dCal} kcal
- snacks[0]: ~${sCal} kcal

CRITICAL RULES:
1. NO REPEATED MEALS across days - every breakfast, lunch, dinner must be unique
2. SIMPLE, everyday home-cooked meals only. Examples: scrambled eggs, oatmeal, grilled chicken with rice, pasta with tomato sauce, chicken soup, beef tacos, tuna sandwich, turkey wrap, stir-fry, grilled salmon with vegetables. NO exotic restaurant dishes.
3. Use the specified meal style and protein for each day
4. INGREDIENT FORMAT: "ingredient_name|amount|unit|category"
   - ingredient_name: RAW only (no "chopped", "diced", "minced", "fresh", "dried")
   - category: Proteins/Vegetables/Fruits/Grains/Dairy/Pantry/Spices
5. Macros must add up: protein*4 + carbs*4 + fat*9 ≈ calories

RETURN ONLY THIS JSON ARRAY (no markdown, no extra text):
[
    ${dayStructures}
]

Each meal object structure:
{"name":"Meal Name","calories":${bCal},"macros":{"protein":20,"carbs":40,"fat":10},"ingredients":["chicken_breast|150|g|Proteins","rice|100|g|Grains"],"prepTime":15}`;
};

/**
 * Parse multi-day response from Gemini.
 * Handles both array format and object with weeklyPlan key.
 *
 * NOTE: extractAndCleanJSON only extracts the FIRST complete JSON object, so if
 * Gemini returns `[{day1},{day2},...]` it would discard all days after day1.
 * We try a direct JSON.parse first (works when responseMimeType:"application/json"),
 * and only fall back to extraction for malformed/markdown-wrapped responses.
 */
const parseMultiDayResponse = (text: string): any[] => {
  let parsed: any;

  // 1. Try direct parse first — Gemini JSON-mode returns clean JSON
  try {
    parsed = JSON.parse(text.trim());
  } catch (_) {
    // 2. Fallback: manual extraction for markdown-wrapped or malformed responses
    let cleanedJSON = extractAndCleanJSON(text);
    cleanedJSON = repairJSON(cleanedJSON);
    parsed = JSON.parse(cleanedJSON);
  }

  // Handle different response formats
  if (Array.isArray(parsed)) return parsed;
  if (parsed.weeklyPlan && Array.isArray(parsed.weeklyPlan)) return parsed.weeklyPlan;
  if (parsed.days && Array.isArray(parsed.days)) return parsed.days;
  if (parsed.date && parsed.meals) return [parsed]; // single day

  throw new Error("Unable to parse multi-day response: unexpected format");
};

/**
 * Generate multiple days in a single API call.
 * Returns array of day objects or empty array on failure.
 */
const generateMultiDayPlan = async (
  apiKey: string,
  modelName: string,
  prompt: string,
  context: string,
  maxRetries: number = 4,
  timeoutMs: number = 60000, // Longer timeout for multi-day requests
): Promise<any[]> => {
  try {
    return await callGeminiWithRateLimit(
      apiKey,
      modelName,
      async (model: GenerativeModel) => {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        });

        const text = result.response.text();
        return parseMultiDayResponse(text);
      },
      {
        maxRetries,
        timeoutMs,
        context,
      },
    );
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    logger.error(`[${context}] Multi-day generation failed: ${errorMsg}`);
    return [];
  }
};

/**
 * Generate one day's meal plan using Gemini with rate limiting and retry logic.
 * Uses the centralized rate limiter to handle rate limits properly.
 */
const generateSingleDayPlan = async (
  apiKey: string,
  modelName: string,
  dayPrompt: string,
  context: string,
  maxRetries: number = 3,
  timeoutMs: number = 25000,
): Promise<any> => {
  try {
    return await callGeminiWithRateLimit(
      apiKey,
      modelName,
      async (model: GenerativeModel) => {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: dayPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        });

        const text = result.response.text();
        return JSON.parse(text);
      },
      {
        maxRetries,
        timeoutMs,
        context,
      },
    );
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    logger.error(`[${context}] Day generation failed: ${errorMsg}`);
    return null;
  }
};

// Gemini generation — batched multi-day calls for free tier efficiency
const generateMealPlanWithGemini = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly",
  language: string,
  apiKey: string,
  goals: IGoal[] = [],
  planTemplate?: string,
  datesOverride?: Date[], // Optional: generate only these specific dates (two-phase support)
): Promise<MealPlanResponse> => {
  const models = await getAvailableGeminiModelsCached(apiKey);

  // Use gemini-2.5-flash-lite for better free tier rate limits
  const modelToUse = models.includes("gemini-2.5-flash-lite")
    ? "gemini-2.5-flash-lite"
    : models.includes("gemini-2.5-flash")
      ? "gemini-2.5-flash"
      : models[0];

  // buildPrompt gives us the full-week context (workout distribution, day names, etc.)
  const { dayToName, nameToDay, dates: fullWeekDates, activeDays, workoutDays } = buildPrompt(
    userData,
    planType,
    language,
    weekStartDate,
    goals,
    planTemplate,
  );

  // datesOverride lets callers generate a specific subset (e.g., just today, or remaining days).
  // Workout distribution is still derived from the full-week schedule for correctness.
  const datesToGenerate = (datesOverride && datesOverride.length > 0)
    ? datesOverride
    : fullWeekDates;

  // Pre-calculate targets once
  const goalAdjustments = planTemplate
    ? getGoalBasedAdjustments([])
    : getGoalBasedAdjustments(goals);
  const bmr = calculateBMR(
    userData.weight,
    userData.height,
    userData.age,
    userData.gender,
  );
  const tdee = calculateTDEE(
    bmr,
    goalAdjustments.workoutFrequency ?? userData.workoutFrequency,
  );
  const targetCalories = Math.max(
    1200,
    calculateTargetCalories(tdee, userData.path) +
      goalAdjustments.calorieAdjustment,
  );
  const macros = calculateMacros(targetCalories, userData.path);
  const workoutDayNums = new Set(workoutDays);

  // Get goal context for prompt
  const goalContextStr = planTemplate
    ? PLAN_TEMPLATE_STYLES[planTemplate] || ""
    : goalAdjustments.goalDescription || "";

  // BATCHED GENERATION STRATEGY:
  // Batch up to 4 days per request — reduces total API calls, stays well under 15 RPM.
  const DAYS_PER_BATCH = Math.min(4, datesToGenerate.length);
  const MULTI_DAY_TIMEOUT_MS = 60000;

  // Prepare day data for batching
  const allDaysData = datesToGenerate.map((date, idx) => ({
    date,
    dateStr: getLocalDateKey(date),
    dayName: dayToName[date.getDay()],
    dayIndex: idx,
    hasWorkout: workoutDayNums.has(date.getDay()),
  }));

  // Split into batches
  const batches: typeof allDaysData[] = [];
  for (let i = 0; i < allDaysData.length; i += DAYS_PER_BATCH) {
    batches.push(allDaysData.slice(i, i + DAYS_PER_BATCH));
  }

  logger.info(
    `[Gemini] Starting batched generation via ${modelToUse} (${datesToGenerate.length} days in ${batches.length} batches, ~${DAYS_PER_BATCH} days/batch)...`,
  );

  const startTime = Date.now();
  const allDayResults: any[] = [];

  // Process each batch sequentially (rate limiter handles throttling between batches)
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchDaysData = batch.map((d) => ({
      dateStr: d.dateStr,
      dayName: d.dayName,
      dayIndex: d.dayIndex,
      hasWorkout: d.hasWorkout,
    }));

    logger.info(
      `[Gemini] Batch ${batchIdx + 1}/${batches.length}: Generating ${batch.length} days (${batch.map((d) => d.dayName).join(", ")})...`,
    );

    const multiDayPrompt = buildMultiDayPrompt(
      userData,
      batchDaysData,
      targetCalories,
      macros,
      goalContextStr,
    );

    const batchResults = await generateMultiDayPlan(
      apiKey,
      modelToUse,
      multiDayPrompt,
      `Batch${batchIdx + 1}`,
      4, // maxRetries
      MULTI_DAY_TIMEOUT_MS,
    );

    if (batchResults.length > 0) {
      logger.info(
        `[Gemini] Batch ${batchIdx + 1} success: Got ${batchResults.length} days`,
      );
      allDayResults.push(...batchResults);
    } else {
      // Fallback: Try individual day generation for failed batch
      logger.warn(
        `[Gemini] Batch ${batchIdx + 1} failed. Falling back to individual day generation...`,
      );

      for (const dayData of batch) {
        const singleDayPrompt = buildDayPrompt(
          userData,
          dayData.dateStr,
          dayData.dayName,
          dayData.dayIndex,
          dayData.hasWorkout,
          targetCalories,
          macros,
          goalContextStr,
        );

        const result = await generateSingleDayPlan(
          apiKey,
          modelToUse,
          singleDayPrompt,
          dayData.dayName,
          3,
          30000,
        );

        if (result !== null) {
          allDayResults.push(result);
        } else {
          logger.warn(`[Gemini] Individual fallback for ${dayData.dayName} also failed`);
        }
      }
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const weeklyPlanArray = allDayResults.filter((d) => d !== null);

  if (weeklyPlanArray.length === 0) {
    throw new Error("All day generations failed. Check Gemini API quota/rate limits.");
  }

  logger.info(
    `[Gemini] Successfully generated ${weeklyPlanArray.length}/${datesToGenerate.length} days in ${elapsedSec}s`,
  );

  const parsedResponse = { weeklyPlan: weeklyPlanArray };

  // Transform to final format — pass only the dates we actually generated
  const transformedPlan = await transformWeeklyPlan(
    parsedResponse,
    dayToName,
    nameToDay,
    datesToGenerate,
    datesToGenerate.map((d) => d.getDay()),
    workoutDays,
    planType,
    language,
    weekStartDate,
  );

  return await enrichPlanWithFavoriteMeals(transformedPlan, userData);
};

// MAIN: Try Gemini first, fallback to Llama
const generateMealPlanWithAI = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly" = "daily",
  language: string = "en",
  useMock: boolean = false,
  goals: IGoal[] = [],
  planTemplate?: string,
  datesOverride?: Date[], // Optional: generate only these specific dates
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
        }, 3000),
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
          goals,
          planTemplate,
          datesOverride,
        );
      } catch (geminiError: unknown) {
        logger.warn(
          `Gemini failed: ${getErrorMessage(geminiError)}. Falling back to Llama...`,
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
        goals,
        planTemplate,
      );
    } catch (llamaError: unknown) {
      throw new Error(
        `Both Gemini and Llama failed. Llama: ${getErrorMessage(llamaError)}`,
      );
    }
  } catch (error: unknown) {
    logger.error("Meal plan generation failed:", error);
    throw error;
  }
};

// Helper function to determine goal-based adjustments
const getGoalBasedAdjustments = (
  goals: IGoal[],
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
      `${goals[index].title}: ${goals[index].description} (Target: ${goals[index].target} ${goals[index].unit})`,
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

// Predefined plan template prompt styles
const PLAN_TEMPLATE_STYLES: Record<string, string> = {
  "red-carpet-balance": `PLAN STYLE: Red Carpet Balance
- Focus on balanced whole foods with flexibility (80/20 approach)
- Include satisfying, feel-good meals that are still nutritious
- Allow room for comfort/social meals
- Balance carbs, protein, and fats evenly
- Simple breakfasts, satisfying dinners
- No extreme restrictions or rigid rules`,

  "high-performance-fuel": `PLAN STYLE: High-Performance Fuel
- Emphasize higher protein in every meal
- Use complex carbs for sustained energy
- Include energy-focused snacks (pre/post workout style)
- Recovery-friendly dinners with protein + anti-inflammatory foods
- Nutrient timing: carb-heavier meals around active hours
- Performance-driven ingredient choices`,

  "plant-forward-glow": `PLAN STYLE: Plant-Forward Glow
- Center meals around vegetables, fruits, grains, legumes, plant proteins
- Prioritize fiber-rich, colorful meals
- Include anti-inflammatory ingredients (turmeric, ginger, leafy greens, berries)
- Light but filling recipes
- Optional dairy/eggs allowed unless restricted
- Minimize processed foods`,

  "mindful-living": `PLAN STYLE: Mindful Living
- Focus on gentle, nourishing, easy-to-digest foods
- Comfort-focused meals with simple ingredients
- Routine-friendly portions (consistent meal sizes)
- Avoid heavy, complex, or overly rich meals
- Include calming foods (warm soups, whole grains, herbal-friendly pairings)
- Support digestive health`,

  "modern-comfort": `PLAN STYLE: Modern Comfort
- Familiar, comforting meals made with healthier swaps
- No "forbidden foods" — include pizza, burgers, pasta etc. in healthier versions
- Focus on familiar flavors and accessible ingredients
- Zero food guilt approach
- Comfort food with better nutritional balance
- Simple cooking methods, no exotic ingredients`,
};

const buildPrompt = (
  userData: IUserData,
  planType: "daily" | "weekly",
  language: string,
  weekStartDate: Date,
  goals: IGoal[] = [],
  planTemplate?: string,
): {
  prompt: string;
  dayToName: Record<number, string>;
  nameToDay: Record<string, number>;
  dates: Date[];
  activeDays: number[];
  workoutDays: number[];
} => {
  // --- 1. CALCULATIONS & SETUP ---
  // For predefined plans, skip goal-based adjustments
  const goalAdjustments = planTemplate
    ? getGoalBasedAdjustments([])
    : getGoalBasedAdjustments(goals);

  const bmr = calculateBMR(
    userData.weight,
    userData.height,
    userData.age,
    userData.gender,
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
    baseTargetCalories + goalAdjustments.calorieAdjustment,
  );

  let macros = calculateMacros(targetCalories, userData.path);
  if (goalAdjustments.macroAdjustments) {
    macros = {
      protein: Math.max(
        0,
        macros.protein + (goalAdjustments.macroAdjustments.protein || 0),
      ),
      carbs: Math.max(
        0,
        macros.carbs + (goalAdjustments.macroAdjustments.carbs || 0),
      ),
      fat: Math.max(
        0,
        macros.fat + (goalAdjustments.macroAdjustments.fat || 0),
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
    Math.floor((i * daysLeft) / workoutsToInclude),
  );

  // Map indices to actual Day Numbers
  const workoutDays = workoutIndices.map((i) => daysToGenerate[i]);

  // activeDays represents all days that will have meal plans
  const activeDays = daysToGenerate;

  // Create a Set of Date Strings that MUST have workouts
  // This explicitly binds the workout to a specific YYYY-MM-DD
  const workoutDatesSet = new Set(
    workoutIndices.map((i) => getLocalDateKey(dates[i])),
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
  // For predefined plans, use the plan template style instead of goal context
  const goalContext =
    planTemplate && PLAN_TEMPLATE_STYLES[planTemplate]
      ? PLAN_TEMPLATE_STYLES[planTemplate]
      : goalAdjustments.goalDescription
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

DIETARY RULES (STRICTLY ENFORCE):
- Allergies: ${userData.allergies ? userData.allergies.join(", ") : "None"}
- Restrictions: ${userData.dietaryRestrictions ? userData.dietaryRestrictions.join(", ") : "None"}
- Dislikes: ${dislikes}
- Food Preferences (MUST INCORPORATE): ${foodPrefs}
  ${userData.foodPreferences?.length ? `*** CRITICAL: You MUST incorporate these food preferences into the meal plan. At least 50% of meals should feature or include these preferred foods/cuisines. For example, if "Japanese food" is preferred, include meals like sushi, ramen, teriyaki, miso soup, etc. throughout the week. ***` : ""}

MEAL FRAMEWORKS (Approximate):
- Breakfast: ~${breakfastTarget} kcal (P:${breakfastMacros.protein}g, C:${breakfastMacros.carbs}g, F:${breakfastMacros.fat}g)
- Lunch: ~${lunchTarget} kcal (P:${lunchMacros.protein}g, C:${lunchMacros.carbs}g, F:${lunchMacros.fat}g)
- Dinner: ~${dinnerTarget} kcal (P:${dinnerMacros.protein}g, C:${dinnerMacros.carbs}g, F:${dinnerMacros.fat}g)
- Snacks: ~${snackTarget} kcal (P:${snackMacros.protein}g, C:${snackMacros.carbs}g, F:${snackMacros.fat}g)

====== DATA STRUCTURE RULES ======
1. Return ONLY valid JSON. Do not include markdown formatting (like \`\`\`json).
2. Follow this schedule keys exactly: ${dailyScheduleManifest}
3. INGREDIENTS: Format as "ingredient|amount|unit|category" using RAW ingredient names and amounts.
   - CRITICAL: ingredient name MUST be RAW only (no preparation words)
   - DO NOT include: "chopped", "diced", "minced", "fresh", "dried", "sliced", "grated", "crushed", "whole", "ground", "cubed", "julienned"
   - Examples: "ginger" (NOT "chopped fresh ginger"), "chicken_breast" (NOT "diced chicken breast"), "onion" (NOT "sliced onion")
   - Category must be one of: Proteins, Vegetables, Fruits, Grains, Dairy, Pantry, Spices
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
  goals: IGoal[] = [],
  planTemplate?: string,
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
      buildPrompt(
        userData,
        planType,
        language,
        weekStartDate,
        goals,
        planTemplate,
      );

    const ollamaModel = process.env.OLLAMA_MODEL || "phi";
    logger.info(`[Llama] Using model: ${ollamaModel}`);

    const fullPrompt =
      prompt +
      "\n\nReturn ONLY valid JSON. No variable assignments, code, or explanations.";

    const isWeeklyPlan = planType === "weekly";
    const generatedText = await callOllama(
      fullPrompt,
      ollamaModel,
      isWeeklyPlan,
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
        `Failed to parse Llama JSON: ${getErrorMessage(parseError)}`,
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
      weekStartDate,
    );

    // Enrich plan with user's favorite meals (20-30% replacement)
    const enrichedPlan = await enrichPlanWithFavoriteMeals(
      transformedPlan,
      userData,
    );

    logger.info("[Llama] Meal plan generated successfully");

    return enrichedPlan;
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
  language: string = "en",
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
    timeoutMs: 25000, // Reduced for faster UX
    maxRetries: 2,
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
  aiRules?: string,
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
}

## Ingredient Rules:
- CRITICAL: ingredient_name MUST be the RAW ingredient name only (no preparation words)
- DO NOT include words like: "chopped", "diced", "minced", "fresh", "dried", "sliced", "grated", "crushed", "whole", "ground", "cubed", "julienned"
- Examples:
  * CORRECT: "ginger" (NOT "chopped fresh ginger")
  * CORRECT: "chicken_breast" (NOT "diced chicken breast")
  * CORRECT: "onion" (NOT "sliced onion")
  * CORRECT: "garlic" (NOT "minced garlic")
- Use lowercase with underscores (e.g., "chicken_breast", "olive_oil", "ginger")`;

  const parseResponse = (jsonText: string) => {
    const mealData = JSON.parse(jsonText);

    // Clean ingredients if they exist
    if (mealData.ingredients && Array.isArray(mealData.ingredients)) {
      mealData.ingredients = mealData.ingredients.map((ing: any) => {
        if (Array.isArray(ing)) {
          const rawName = String(ing[0] || "");
          const amount = String(ing[1] || "");
          const cleanedName = cleanIngredientName(rawName);
          const category = assignIngredientCategory(cleanedName);
          return category
            ? [cleanedName, amount, category]
            : [cleanedName, amount];
        }
        const cleanedName = cleanIngredientName(String(ing));
        const category = assignIngredientCategory(cleanedName);
        return category ? [cleanedName, "", category] : [cleanedName, ""];
      });
    }

    return {
      _id: new mongoose.Types.ObjectId(),
      ...mealData,
      isCustom: true,
      generatedAt: new Date().toISOString(),
    };
  };

  return generateWithFallback(prompt, parseResponse, {
    timeoutMs: 20000, // Reduced for faster UX
    maxRetries: 2,
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
  language: string = "en",
): Promise<IMeal[]> => {
  const numberOfSuggestions = mealCriteria.numberOfSuggestions || 3;
  const targetCalories = mealCriteria.targetCalories || 500;

  // Check if aiRules contains a meal name request (variations request)
  const isVariationRequest =
    mealCriteria.aiRules?.includes("variations of") ||
    mealCriteria.aiRules?.includes("variation of") ||
    (mealCriteria.aiRules &&
      mealCriteria.aiRules.length < 50 &&
      !mealCriteria.aiRules.toLowerCase().includes("make") &&
      !mealCriteria.aiRules.toLowerCase().includes("create") &&
      !mealCriteria.aiRules.toLowerCase().includes("generate"));

  // Extract meal name if it's a variation request
  let requestedMeal: string | undefined;
  if (isVariationRequest && mealCriteria.aiRules) {
    const mealNameMatch =
      mealCriteria.aiRules.match(/variations? of ["']?([^"']+)["']?/i) ||
      mealCriteria.aiRules.match(/["']?([^"']+)["']?/);
    requestedMeal = mealNameMatch
      ? mealNameMatch[1]
      : mealCriteria.aiRules.trim();
  }

  // Build prompt with priority handling for meal name requests
  let prompt = "";

  if (isVariationRequest && requestedMeal) {
    // PRIORITY MODE: User requested specific meal variations
    prompt = `You are a professional nutritionist. Generate exactly ${numberOfSuggestions} UNIQUE VARIATIONS of "${requestedMeal}".

====== CRITICAL REQUIREMENT ======
ALL ${numberOfSuggestions} meals MUST be variations of "${requestedMeal}".
Each meal name MUST include "${requestedMeal}" or clearly reference it.
Examples of valid variations:
- "Grilled ${requestedMeal}"
- "Pan-Seared ${requestedMeal}"
- "${requestedMeal} with Herbs"
- "Garlic ${requestedMeal}"
- "Spicy ${requestedMeal}"
- "${requestedMeal} and Vegetables"

DO NOT generate meals that don't include "${requestedMeal}" in the name.
DO NOT generate completely different meals.
ALL meals must be variations of "${requestedMeal}".

## Requirements:
- Category: ${mealCriteria.category}
- Target calories per meal: approximately ${targetCalories} calories (±10%)
- Language for meal names and ingredients: ${language}
${mealCriteria.dietaryRestrictions?.length ? `- Dietary restrictions (MUST follow): ${mealCriteria.dietaryRestrictions.join(", ")}` : ""}
${mealCriteria.preferences?.length ? `- Food Preferences (MUST INCORPORATE): ${mealCriteria.preferences.join(", ")} - *** CRITICAL: Incorporate these preferences into the variations where possible. ***` : ""}
${mealCriteria.dislikes?.length ? `- Dislikes (MUST avoid): ${mealCriteria.dislikes.join(", ")}` : ""}

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
   ${isVariationRequest && requestedMeal ? `- CRITICAL: MUST include "${requestedMeal}" in the name (e.g., "Grilled ${requestedMeal}", "Pan-Seared ${requestedMeal}")` : ""}
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
  } else {
    // STANDARD MODE: General meal suggestions
    prompt = `You are a professional nutritionist. Generate exactly ${numberOfSuggestions} unique ${mealCriteria.category} meal suggestions.

## Requirements:
- Category: ${mealCriteria.category}
- Target calories per meal: approximately ${targetCalories} calories (±10%)
- Language for meal names and ingredients: ${language}
${mealCriteria.dietaryRestrictions?.length ? `- Dietary restrictions (MUST follow): ${mealCriteria.dietaryRestrictions.join(", ")}` : ""}
${mealCriteria.preferences?.length ? `- Food Preferences (MUST INCORPORATE): ${mealCriteria.preferences.join(", ")} - *** CRITICAL: ALL meals should feature or be inspired by these preferences. For example, if "Japanese food" is preferred, generate meals like sushi, ramen, teriyaki, miso soup, etc. ***` : ""}
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
   - CRITICAL: name MUST be the RAW ingredient name only (no preparation words)
   - DO NOT include words like: "chopped", "diced", "minced", "fresh", "dried", "sliced", "grated", "crushed", "whole", "ground", "cubed", "julienned"
   - Examples:
     * CORRECT: "ginger" (NOT "chopped fresh ginger")
     * CORRECT: "chicken_breast" (NOT "diced chicken breast")
     * CORRECT: "onion" (NOT "sliced onion")
     * CORRECT: "garlic" (NOT "minced garlic")
   - name: lowercase with underscores (e.g., "chicken_breast", "olive_oil", "ginger")
   - amount: number followed by unit (e.g., "200 g", "50 ml", "2 pieces")
   - NOTE: Ingredient names use underscores, but meal names use spaces!
6. "prepTime" - preparation time in minutes (integer)`;
  }

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
                const rawName = String(ing[0] || "");
                const amount = String(ing[1] || "");

                // Clean ingredient name (remove preparation words)
                const cleanedName = cleanIngredientName(rawName);

                // Assign category based on ingredient name
                const category = assignIngredientCategory(cleanedName);

                // Return with category if assigned
                return category
                  ? [cleanedName, amount, category]
                  : [cleanedName, amount];
              }
              // Handle string format
              const cleanedName = cleanIngredientName(String(ing));
              const category = assignIngredientCategory(cleanedName);
              return category ? [cleanedName, "", category] : [cleanedName, ""];
            })
          : [],
        prepTime: Math.round(meal.prepTime || 30),
      }));
  };

  const meals = await generateWithFallback<IMeal[]>(prompt, parseResponse, {
    timeoutMs: 25000, // Reduced for faster UX
    maxRetries: 2,
    context: "MealSuggestions",
  });

  logger.info(
    `[generateMealSuggestions] Generated ${meals.length} meal suggestions for ${mealCriteria.category}`,
  );

  return meals;
};

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

/**
 * Generate a quick "rescue meal" for the "I'm Tired" feature
 * - Maximum 10 minute prep time
 * - Matches target macros (±20% tolerance)
 * - Uses simple, commonly available ingredients
 * - Minimal cooking required
 */
const generateRescueMeal = async (
  mealCriteria: {
    category: "breakfast" | "lunch" | "dinner";
    targetCalories: number;
    targetMacros?: { protein: number; carbs: number; fat: number };
    dietaryRestrictions?: string[];
    preferences?: string[];
    dislikes?: string[];
  },
  language: string = "en",
): Promise<IMeal> => {
  const { category, targetCalories, targetMacros } = mealCriteria;

  // Calculate default macros if not provided (based on typical meal distribution)
  const defaultMacros = targetMacros || {
    protein: Math.round((targetCalories * 0.25) / 4), // 25% from protein
    carbs: Math.round((targetCalories * 0.45) / 4), // 45% from carbs
    fat: Math.round((targetCalories * 0.3) / 9), // 30% from fat
  };

  const prompt = `You are a professional nutritionist. Generate ONE quick "rescue meal" for someone who is tired and has no time to cook.

## CRITICAL REQUIREMENTS:
- Preparation time: MAXIMUM 10 minutes (quick assembly, minimal cooking)
- Category: ${category}
- Target calories: approximately ${targetCalories} calories (±15%)
- Target macros (±20% tolerance): Protein: ${defaultMacros.protein}g, Carbs: ${defaultMacros.carbs}g, Fat: ${defaultMacros.fat}g
- Language for meal name and ingredients: ${language}
${mealCriteria.dietaryRestrictions?.length ? `- Dietary restrictions (MUST follow): ${mealCriteria.dietaryRestrictions.join(", ")}` : ""}
${mealCriteria.preferences?.length ? `- Preferences (try to include): ${mealCriteria.preferences.join(", ")}` : ""}
${mealCriteria.dislikes?.length ? `- Dislikes (MUST avoid): ${mealCriteria.dislikes.join(", ")}` : ""}

## MEAL CHARACTERISTICS:
- Should use simple, commonly available ingredients
- Minimal cooking required (microwave, toaster, no-cook preferred)
- Can be assembled quickly (sandwiches, wraps, bowls, smoothies, salads, etc.)
- Still nutritious and satisfying despite being quick
- NO restaurant/takeout suggestions - must be home-preparable

## QUICK MEAL IDEAS BY CATEGORY:
- Breakfast: overnight oats (pre-made), yogurt parfait, toast with toppings, smoothie, cereal with fruit
- Lunch: wrap/sandwich, salad bowl, hummus plate, leftover reheating, deli meat roll-ups
- Dinner: rotisserie chicken + sides, pasta with jarred sauce, stir-fry with pre-cut veggies, quesadilla, eggs + toast

## Response Format:
Return ONLY valid JSON:
{
  "name": "Quick Meal Name",
  "calories": ${targetCalories},
  "macros": {"protein": ${defaultMacros.protein}, "carbs": ${defaultMacros.carbs}, "fat": ${defaultMacros.fat}},
  "category": "${category}",
  "ingredients": [["ingredient_name", "100 g"]],
  "prepTime": 10
}

## Rules:
1. "name" - appetizing meal name using spaces (Title Case, e.g., "Greek Yogurt Power Bowl")
2. "prepTime" - MUST be 10 or less (this is critical!)
3. "ingredients" - use underscores for ingredient names (e.g., "greek_yogurt", "mixed_berries")`;

  const parseResponse = (jsonText: string) => {
    const mealData = JSON.parse(jsonText);

    // Ensure prepTime is <= 10 minutes (critical for rescue meals)
    const prepTime = Math.min(mealData.prepTime || 10, 10);

    return {
      _id: new mongoose.Types.ObjectId().toString(),
      name: normalizeMealName(mealData.name),
      calories: Math.round(mealData.calories || targetCalories),
      macros: {
        protein: Math.round(mealData.macros?.protein || defaultMacros.protein),
        carbs: Math.round(mealData.macros?.carbs || defaultMacros.carbs),
        fat: Math.round(mealData.macros?.fat || defaultMacros.fat),
      },
      category,
      ingredients: Array.isArray(mealData.ingredients)
        ? mealData.ingredients.map((ing: any) => {
            if (Array.isArray(ing)) {
              const rawName = String(ing[0] || "");
              const amount = String(ing[1] || "");
              const cleanedName = cleanIngredientName(rawName);
              const category = assignIngredientCategory(cleanedName);
              return category
                ? [cleanedName, amount, category]
                : [cleanedName, amount];
            }
            const cleanedName = cleanIngredientName(String(ing));
            const category = assignIngredientCategory(cleanedName);
            return category ? [cleanedName, "", category] : [cleanedName, ""];
          })
        : [],
      prepTime,
      done: false,
    };
  };

  logger.info(
    `[generateRescueMeal] Generating rescue meal for ${category} (${targetCalories} kcal)`,
  );

  const meal = await generateWithFallback<IMeal>(prompt, parseResponse, {
    timeoutMs: 30000, // Shorter timeout for faster UX
    maxRetries: 2, // Fewer retries for speed
    context: "RescueMeal",
  });

  logger.info(
    `[generateRescueMeal] Generated: ${meal.name} (${meal.prepTime} min prep)`,
  );

  return meal;
};

const generateSnack = async (
  snackName: string,
  dietaryRestrictions: string[] = [],
  language: string = "en",
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
    timeoutMs: 15000, // Snacks are simple, fast timeout
    maxRetries: 2,
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
  startDate?: Date,
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
    timeoutMs: 20000, // Reduced for faster UX
    maxRetries: 2,
    context: "GenerateGoal",
  });
};

const aiService = {
  generateMealPlanWithAI,
  generateRecipeDetails,
  generateMeal,
  generateMealPlanWithLlama2,
  generateMealSuggestions,
  generateRescueMeal,
  generateSnack,
  generateGoal,
};

export default aiService;
