import { GenerativeModel } from "@google/generative-ai";
import axios from "axios";
import logger from "../utils/logger";
import {
  callGeminiWithRateLimit,
  DAILY_QUOTA_EXHAUSTED,
  isModelExhausted,
} from "../utils/gemini-rate-limiter";
import {
  IUserData,
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
import { loadKnowledge } from "../knowledge/loader";
import {
  transformWeeklyPlan,
  enrichPlanWithFavoriteMeals,
  MealPlanResponse,
  convertMealIngredientsToRecipeFormat,
  MealIngredient,
  cleanIngredientName,
  assignIngredientCategory,
} from "../utils/helpers";
import {
  resolveDietaryConstraints,
  buildDietaryConstraintBlock,
  findPlanViolations,
  describeViolations,
  filterFoodPreferences,
  DietaryConstraints,
} from "../utils/dietary-constraints";
import {
  buildMenuSkeleton,
  buildWeeklyPlanPrompt,
  planSeed,
  MEAL_PLAN_SYSTEM_INSTRUCTION,
} from "./meal-plan-prompt";

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
      // JSON mode constrains decoding at the API level, so prompts no longer
      // need to spend tokens telling the model not to wrap output in markdown —
      // this also mirrors the multi-day plan path, which already relies on it.
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      });

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

// NOTE: the weekly plan's cuisine/protein/method rotation now lives in
// meal-plan-prompt.ts, seeded per user and per week. The flat CUISINE_ROTATION
// that used to sit here was indexed by day number alone, so every user got the
// same seven styles in the same order every single week.

// Shared "no prep-words, use underscores" ingredient-naming rule, reused verbatim
// across every single-meal prompt (generateMeal/Suggestions/RescueMeal/Snack) so
// wording only needs to change in one place.
const INGREDIENT_NAMING_RULES = `- CRITICAL: ingredient name MUST be the RAW ingredient only — no "chopped", "diced", "minced", "fresh", "dried", "sliced", "grated", "crushed", "whole", "ground", "cubed", "julienned"
- Use lowercase with underscores (e.g., "chicken_breast", "olive_oil", "ginger" — NOT "diced chicken breast")`;


/**
 * Parse multi-day response from Gemini.
 * Handles both array format and object with weeklyPlan key.
 *
 * NOTE: extractAndCleanJSON only extracts the FIRST complete JSON object, so if
 * Gemini returns `[{day1},{day2},...]` it would discard all days after day1.
 * We try a direct JSON.parse first (works when responseMimeType:"application/json"),
 * and only fall back to extraction for malformed/markdown-wrapped responses.
 */
/**
 * Pull the first complete JSON array or object out of `text`, ignoring anything
 * before or after it.
 *
 * Models intermittently append a stray token after a perfectly good array
 * ("Unexpected non-whitespace character after JSON at position 10234"), which
 * discarded an entire valid week. Scanning brackets rather than regex-matching
 * avoids being fooled by braces inside string values.
 */
const extractFirstJSONValue = (text: string): string | null => {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null; // unbalanced — genuinely truncated
};

export const parseMultiDayResponse = (text: string): any[] => {
  let parsed: any;

  // 1. Try direct parse first — Gemini JSON-mode returns clean JSON
  try {
    parsed = JSON.parse(text.trim());
  } catch (_) {
    // 2. Trailing/leading junk around an otherwise-valid value is the common
    //    case and is cheap to recover from.
    const extracted = extractFirstJSONValue(text);
    if (extracted) {
      try {
        parsed = JSON.parse(extracted);
      } catch {
        /* fall through to the repair path below */
      }
    }

    // 3. Last resort: markdown-wrapped or structurally malformed responses.
    if (parsed === undefined) {
      let cleanedJSON = extractAndCleanJSON(text);
      cleanedJSON = repairJSON(cleanedJSON);
      parsed = JSON.parse(cleanedJSON);
    }
  }

  // Handle different response formats
  if (Array.isArray(parsed)) return parsed;
  if (parsed.weeklyPlan && Array.isArray(parsed.weeklyPlan)) return parsed.weeklyPlan;
  if (parsed.days && Array.isArray(parsed.days)) return parsed.days;
  if (parsed.date && parsed.meals) return [parsed]; // single day

  throw new Error("Unable to parse multi-day response: unexpected format");
};

/** Error prefix the controller/client can detect for a hard dietary failure. */
export const DIETARY_VIOLATION_ERROR = "DIETARY_CONSTRAINT_VIOLATION";

/**
 * Last line of defence: verify every generated day against the user's hard
 * dietary constraints, re-generating the offending days once with an explicit
 * correction note. If the model still returns a violating meal we throw rather
 * than persist it — serving meat to a vegan (or an allergen to an allergic
 * user) is strictly worse than showing a "try again" error.
 *
 * `regenerateDays` returns fresh day objects for the given dates, or null when
 * the provider cannot retry (in which case the violating days are dropped).
 */
const enforceDietaryConstraints = async (
  days: any[],
  constraints: DietaryConstraints,
  context: string,
  regenerateDays: (violatingDates: string[], repairNote: string) => Promise<any[] | null>,
): Promise<any[]> => {
  if (!constraints.hasConstraints) return days;

  const violations = findPlanViolations(days, constraints);
  if (violations.length === 0) return days;

  logger.error(
    `[${context}] Dietary violations detected — ${describeViolations(violations)}`,
  );

  const violatingDates = Array.from(
    new Set(violations.map((v) => v.date).filter(Boolean)),
  ) as string[];

  const repairNote =
    `PREVIOUS ATTEMPT WAS REJECTED. It included: ${describeViolations(violations)}. ` +
    `Those ingredients are strictly forbidden for this user. Regenerate WITHOUT them.`;

  const repaired = await regenerateDays(violatingDates, repairNote);

  if (repaired && repaired.length > 0) {
    const stillBad = findPlanViolations(repaired, constraints);
    if (stillBad.length === 0) {
      const repairedByDate = new Map(repaired.map((d: any) => [d?.date, d]));
      const merged = days.map((d: any) =>
        repairedByDate.has(d?.date) ? repairedByDate.get(d?.date) : d,
      );
      logger.info(
        `[${context}] Repaired ${violatingDates.length} day(s) that violated dietary constraints`,
      );
      // Any violating day we could not re-generate must still be removed.
      return merged.filter((d: any) => findPlanViolations([d], constraints).length === 0);
    }
    logger.error(
      `[${context}] Repair attempt still violates constraints — ${describeViolations(stillBad)}`,
    );
  }

  // Drop the violating days entirely. If nothing survives, fail loudly.
  const clean = days.filter((d: any) => findPlanViolations([d], constraints).length === 0);

  if (clean.length === 0) {
    throw new Error(
      `${DIETARY_VIOLATION_ERROR}: The generated plan did not respect your dietary restrictions ` +
      `(${constraints.rawRestrictions.join(", ") || constraints.allergies.join(", ")}) and was discarded. ` +
      `Please try generating again.`,
    );
  }

  logger.warn(
    `[${context}] Dropped ${days.length - clean.length} day(s) that could not be made compliant`,
  );
  return clean;
};

/**
 * Generate multiple days in a single API call, rotating across models.
 *
 * Each Gemini model has its OWN separate free-tier daily quota, so when one
 * model's per-day quota is exhausted we fail over to the next model instead of
 * retrying (which would just burn requests). Returns an array of day objects,
 * or [] for a recoverable failure (parse/transient). Throws a
 * DAILY_QUOTA_EXHAUSTED error only when EVERY candidate model is out of quota,
 * so the caller can fail over to a different provider.
 */
const generateMultiDayPlan = async (
  apiKey: string,
  models: string[],
  prompt: string,
  context: string,
  maxRetries: number = 4,
  timeoutMs: number = 60000, // Longer timeout for multi-day requests
  systemInstruction?: string,
  maxOutputTokens: number = 32768,
): Promise<any[]> => {
  let allExhausted = true;
  let lastError = "";

  // Skip models already known to be out of quota today rather than spending a
  // guaranteed-429 round trip on each of them before every fail-over.
  const available = models.filter((m) => !isModelExhausted(m));
  if (available.length === 0) {
    logger.warn(
      `[${context}] All ${models.length} Gemini models are out of daily quota — going straight to the fallback provider.`,
    );
    throw new Error(`${DAILY_QUOTA_EXHAUSTED} [${context}] all models exhausted today`);
  }
  if (available.length < models.length) {
    logger.info(
      `[${context}] Skipping ${models.length - available.length} model(s) already exhausted today; ${available.length} left.`,
    );
  }

  for (const modelName of available) {
    try {
      return await callGeminiWithRateLimit(
        apiKey,
        modelName,
        async (model: GenerativeModel) => {
          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              // The menu outline already fixes each meal's form and protein, so
              // a higher temperature varies the cooking rather than the
              // structure — this is what stops every week looking alike.
              temperature: 0.9,
              // A full week of meals with ingredient lists runs past the
              // default output cap; the reply then truncates mid-array and the
              // whole batch is discarded as unparseable.
              maxOutputTokens,
            },
          });

          const text = result.response.text();
          return parseMultiDayResponse(text);
        },
        {
          maxRetries,
          timeoutMs,
          context,
          systemInstruction,
        },
      );
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      lastError = errorMsg;
      if (errorMsg.includes(DAILY_QUOTA_EXHAUSTED)) {
        logger.warn(
          `[${context}] ${modelName} daily quota exhausted — trying next model...`,
        );
        continue; // model is done for the day, try the next one
      }
      // Non-quota failure (parse/transient/timeout): this model still has quota,
      // so don't mark everything exhausted — fall through to caller's recovery.
      allExhausted = false;
      logger.error(
        `[${context}] Multi-day generation failed on ${modelName}: ${errorMsg}`,
      );
    }
  }

  // Every model we tried was out of daily quota — signal the caller to switch
  // providers rather than pointlessly attempting single-day generation.
  if (allExhausted) {
    throw new Error(`${DAILY_QUOTA_EXHAUSTED} [${context}] ${lastError}`);
  }

  return [];
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
  systemInstruction?: string,
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
            temperature: 0.9,
            maxOutputTokens: 8192,
          },
        });

        // The day prompt uses the same schema as the batch one, so the model
        // replies with a one-element array. Unwrap it — callers push the result
        // straight into the day list and would otherwise nest an array there.
        const days = parseMultiDayResponse(result.response.text());
        return days[0] ?? null;
      },
      {
        maxRetries,
        timeoutMs,
        context,
        systemInstruction,
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
  moodContext?: string,
  recentMeals: string[] = [], // Dish names to avoid repeating from earlier plans
): Promise<MealPlanResponse> => {
  const models = await getAvailableGeminiModelsCached(apiKey);

  // Ordered fail-over list. Each model has its OWN free-tier daily quota (20
  // requests/day), so when one is exhausted we move to the next — multiplying
  // effective free capacity.
  //
  // Ordered by measured quality-per-second on the eval personas, not by size.
  //
  // "Lite" is generation-specific, and conflating the two cost a lot of time
  // here: gemini-2.5-flash-lite genuinely was the problem (dietary violations
  // for the vegan and gluten-free personas, and calorie figures echoed from the
  // prompt rather than derived from its own ingredients), but the 3.x lites are
  // a different class. Measured:
  //
  //   gemini-3.1-flash-lite   1 day 2.2s | 6 days  9.3s | 0 violations
  //   gemini-3.5-flash-lite   1 day 2.4s | 6 days 10.5s | 1 violation
  //   gemini-3.5-flash                     7 days 60-90s | 0 violations
  //
  // The 3.x lites are ~7x faster at the same quality, which matters because
  // Phase 1 blocks the client. The heavier models stay as fail-over.
  //
  // gemini-2.0-flash and gemini-2.0-flash-lite are deliberately absent: they
  // now report "limit: 0" on the free tier, so every request to them is a
  // guaranteed 429 that only adds latency before the next candidate.
  const MODEL_PRIORITY = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash-lite", // last resort: weakest, but better than no plan
  ];
  const candidateModels = MODEL_PRIORITY.filter((m) => models.includes(m));
  if (candidateModels.length === 0) {
    candidateModels.push(models[0] || "gemini-2.5-flash-lite");
  }
  const modelToUse = candidateModels[0];

  // buildPrompt gives us the full-week context (workout distribution, day names, etc.)
  const { dayToName, nameToDay, dates: fullWeekDates, activeDays, workoutDays } = buildPrompt(
    userData,
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
  const constraints = resolveDietaryConstraints(userData);

  if (constraints.hasConstraints) {
    logger.info(
      `[Gemini] Dietary constraints active: ${constraints.rules.map((r) => r.label).join(", ") || "custom"} | ` +
      `proteins=${constraints.proteinRotation.join("/")}`,
    );
  }

  // Get goal context for prompt
  const goalContextStr = planTemplate
    ? PLAN_TEMPLATE_STYLES[planTemplate] || ""
    : goalAdjustments.goalDescription || "";

  // BATCHED GENERATION STRATEGY:
  // Generate ALL requested days in a SINGLE request. The binding free-tier limit
  // is requests-per-DAY (20/model), not tokens, so minimizing request COUNT is
  // what matters. Phase 1 (today) = 1 request; Phase 2 (rest of week) = 1 request.
  const DAYS_PER_BATCH = datesToGenerate.length;
  const MULTI_DAY_TIMEOUT_MS = 90000; // room for a full 6-day payload in one call

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

    // Code fixes the shape of every meal (form, protein, method, flavour) and
    // the model only cooks it. See meal-plan-prompt.ts for why.
    const skeleton = buildMenuSkeleton(
      batchDaysData,
      constraints,
      targetCalories,
      planSeed(String((userData as any)._id ?? "anon"), getLocalDateKey(weekStartDate)),
      userData.dislikes,
    );

    const multiDayPrompt = buildWeeklyPlanPrompt({
      userData,
      skeleton,
      constraints,
      targetCalories,
      macros,
      recentMeals,
      styleNote: goalContextStr,
      moodContext,
      language,
    });

    // generateMultiDayPlan rotates across candidateModels and throws
    // DAILY_QUOTA_EXHAUSTED only when EVERY model is out of daily quota — in
    // which case we abort Gemini entirely and let the caller fail over to
    // OpenRouter instead of burning more (already-exhausted) requests.
    const batchResults = await generateMultiDayPlan(
      apiKey,
      candidateModels,
      multiDayPrompt,
      `Batch${batchIdx + 1}`,
      4, // maxRetries
      MULTI_DAY_TIMEOUT_MS,
      MEAL_PLAN_SYSTEM_INSTRUCTION,
      outputTokenBudget(batch.length),
    );

    if (batchResults.length > 0) {
      logger.info(
        `[Gemini] Batch ${batchIdx + 1} success: Got ${batchResults.length} days`,
      );
      allDayResults.push(...batchResults);
    } else {
      // Recoverable failure (parse/transient) — the model still has quota, so
      // retry these days individually. Single-day prompts are smaller and more
      // likely to return valid JSON.
      logger.warn(
        `[Gemini] Batch ${batchIdx + 1} failed. Falling back to individual day generation...`,
      );

      for (const dayData of batch) {
        // Same skeleton, one day wide — a fallback day must not fall back to
        // weaker prompting, or the retry quietly reintroduces the problems the
        // rewrite fixed.
        const daySkeleton = buildMenuSkeleton(
          [dayData],
          constraints,
          targetCalories,
          planSeed(
            String((userData as any)._id ?? "anon"),
            getLocalDateKey(weekStartDate),
            dayData.dateStr,
          ),
          userData.dislikes,
        );

        const singleDayPrompt = buildWeeklyPlanPrompt({
          userData,
          skeleton: daySkeleton,
          constraints,
          targetCalories,
          macros,
          recentMeals,
          styleNote: goalContextStr,
          moodContext,
          language,
        });

        const result = await generateSingleDayPlan(
          apiKey,
          modelToUse,
          singleDayPrompt,
          dayData.dayName,
          3,
          30000,
          MEAL_PLAN_SYSTEM_INSTRUCTION,
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
  let weeklyPlanArray = allDayResults.filter((d) => d !== null);

  if (weeklyPlanArray.length === 0) {
    throw new Error("All day generations failed. Check Gemini API quota/rate limits.");
  }

  logger.info(
    `[Gemini] Successfully generated ${weeklyPlanArray.length}/${datesToGenerate.length} days in ${elapsedSec}s`,
  );

  // Verify the model actually honoured the hard dietary constraints.
  weeklyPlanArray = await enforceDietaryConstraints(
    weeklyPlanArray,
    constraints,
    "Gemini",
    async (violatingDates, repairNote) => {
      const repairDays = allDaysData.filter((d) => violatingDates.includes(d.dateStr));
      if (repairDays.length === 0) return null;

      // Re-seed the repair so it cannot re-roll the same forms that just failed.
      const repairSkeleton = buildMenuSkeleton(
        repairDays,
        constraints,
        targetCalories,
        planSeed(
          String((userData as any)._id ?? "anon"),
          getLocalDateKey(weekStartDate),
          "repair",
        ),
        userData.dislikes,
      );

      const repairPrompt = buildWeeklyPlanPrompt({
        userData,
        skeleton: repairSkeleton,
        constraints,
        targetCalories,
        macros,
        recentMeals,
        styleNote: goalContextStr,
        moodContext,
        repairNote,
        language,
      });

      try {
        return await generateMultiDayPlan(
          apiKey,
          candidateModels,
          repairPrompt,
          "DietaryRepair",
          2,
          MULTI_DAY_TIMEOUT_MS,
          MEAL_PLAN_SYSTEM_INSTRUCTION,
          outputTokenBudget(repairDays.length),
        );
      } catch (err) {
        logger.error(`[Gemini] Dietary repair request failed: ${getErrorMessage(err)}`);
        return null;
      }
    },
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

// OpenRouter fallback — used when all Gemini models are rate-limited.
// Uses the OpenAI-compatible chat completions API with free-tier models that
// properly respect dietary restrictions (vegan, allergies, etc.).
/**
 * OpenRouter fail-over, in two tiers.
 *
 * The previous list — llama-3.1-8b:free, mistral-7b:free, gemma-2-9b:free — was
 * entirely dead: all three IDs now return 404 ("no endpoints found" / "not
 * available for free"). So once Gemini's daily quota ran out there was no
 * fallback at all and users got PLAN_GENERATION_UNAVAILABLE.
 *
 * PAID tier first. A week's plan is ~8k output tokens, i.e. roughly $0.02 on
 * gemini-3.5-flash — the same model the Gemini path prefers, so failing over
 * costs cents and does not degrade the plan. Requires credit on the OpenRouter
 * account; without it these 402 and we fall through to the free tier.
 *
 * FREE tier is the safety net when there is no credit. These are real models
 * rather than the 7-9B class that used to be here, but they are slower and
 * rate-limited (~50 requests/day on an uncredited account).
 */
const OPEN_ROUTER_PAID_MODELS = [
  "google/gemini-3.5-flash", // measured best on the eval personas
  "google/gemini-3-flash-preview",
  "deepseek/deepseek-v3.2", // non-Google, in case Google itself is degraded
];

// Ordered by measured latency on a trivial JSON prompt. Deliberately excludes
// nvidia/nemotron-3-super-120b-a12b:free — it is a reasoning model and spent
// 37s thinking about a two-item list, which is far too slow to sit in front of
// a user waiting for today's meals.
const OPEN_ROUTER_FREE_MODELS = [
  "inclusionai/ling-3.0-flash:free",
  "openai/gpt-oss-20b:free",
  "google/gemma-4-26b-a4b-it:free",
];

const OPEN_ROUTER_MODELS = [...OPEN_ROUTER_PAID_MODELS, ...OPEN_ROUTER_FREE_MODELS];

/**
 * True when OpenRouter rejected a request for lack of credit. Checked so the
 * whole paid tier can be skipped for the rest of the process instead of
 * spending one doomed round trip per paid model on every generation.
 */
export const isOutOfCreditError = (err: unknown): boolean => {
  const status = (err as any)?.response?.status;
  const msg = String(
    (err as any)?.response?.data?.error?.message ?? getErrorMessage(err),
  ).toLowerCase();
  return (
    status === 402 ||
    msg.includes("402") ||
    msg.includes("insufficient credit") ||
    msg.includes("requires more credits") ||
    msg.includes("can only afford")
  );
};

/** Set once the account is known to have no credit; resets on process restart. */
let paidTierUnavailable = false;

/**
 * Output-token budget for a plan of `dayCount` days.
 *
 * Sized rather than fixed-large for two reasons: too small truncates the reply
 * mid-array and the whole batch is discarded, while too large is actively
 * harmful on OpenRouter, which reserves credit against `max_tokens` up front and
 * rejects the request outright ("you requested up to 32768 tokens, but can only
 * afford 4444") even when the real reply would have cost a fraction of that.
 *
 * A day of four meals with ingredient lists measures at roughly 1.5k tokens.
 *
 * The floor is deliberately well above one day's worth: Gemini 3.x models spend
 * output budget on internal reasoning before emitting anything, so a tight cap
 * gets consumed by thinking and the reply truncates mid-JSON. A 4.5k budget made
 * gemini-3-flash-preview and gemini-2.5-flash fail on a single day.
 */
export const outputTokenBudget = (dayCount: number): number =>
  Math.min(32768, Math.max(8192, 4000 + Math.max(1, dayCount) * 2200));

const generateMealPlanWithOpenRouter = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly",
  language: string,
  apiKey: string,
  goals: IGoal[] = [],
  planTemplate?: string,
  datesOverride?: Date[],
  moodContext?: string,
  recentMeals: string[] = [],
): Promise<MealPlanResponse> => {
  logger.info("[OpenRouter] Starting generation...");

  // Reuse the same date/workout scheduling logic from buildPrompt
  const { dayToName, nameToDay, dates: fullWeekDates, workoutDays } = buildPrompt(
    userData, goals, planTemplate,
  );

  const datesToGenerate = datesOverride?.length ? datesOverride : fullWeekDates;

  const goalAdjustments = planTemplate
    ? getGoalBasedAdjustments([])
    : getGoalBasedAdjustments(goals);
  const bmr = calculateBMR(userData.weight, userData.height, userData.age, userData.gender);
  const tdee = calculateTDEE(bmr, goalAdjustments.workoutFrequency ?? userData.workoutFrequency);
  const targetCalories = Math.max(
    1200,
    calculateTargetCalories(tdee, userData.path) + goalAdjustments.calorieAdjustment,
  );
  const macros = calculateMacros(targetCalories, userData.path);
  const workoutDayNums = new Set(workoutDays);
  const constraints = resolveDietaryConstraints(userData);
  const goalContextStr = planTemplate
    ? PLAN_TEMPLATE_STYLES[planTemplate] || ""
    : goalAdjustments.goalDescription || "";

  // Single-request batching (mirrors the Gemini path): all requested days in one
  // call minimizes request count against the fallback provider's limits too.
  const DAYS_PER_BATCH = datesToGenerate.length;

  const allDaysData = datesToGenerate.map((date, idx) => ({
    date,
    dateStr: getLocalDateKey(date),
    dayName: dayToName[date.getDay()],
    dayIndex: idx,
    hasWorkout: workoutDayNums.has(date.getDay()),
  }));

  const batches: typeof allDaysData[] = [];
  for (let i = 0; i < allDaysData.length; i += DAYS_PER_BATCH) {
    batches.push(allDaysData.slice(i, i + DAYS_PER_BATCH));
  }

  const allDayResults: any[] = [];

  // Single prompt → first model that returns parseable days wins. Paid models
  // are tried first and skipped wholesale once the account is known to be out
  // of credit, so an uncredited deployment still reaches the free tier fast.
  const runOpenRouterPrompt = async (
    prompt: string,
    label: string,
    dayCount: number,
  ): Promise<any[]> => {
    const models = paidTierUnavailable ? OPEN_ROUTER_FREE_MODELS : OPEN_ROUTER_MODELS;
    if (paidTierUnavailable) {
      logger.info(`[OpenRouter] No credit on this account — using free models only.`);
    }

    for (const model of models) {
      // The flag can flip partway through the paid tier; skip whatever is left
      // of it rather than collecting an identical 402 from each one.
      if (paidTierUnavailable && OPEN_ROUTER_PAID_MODELS.includes(model)) continue;

      try {
        logger.info(`[OpenRouter] Trying model ${model} for ${label}...`);
        const response = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model,
            messages: [
              { role: "system", content: MEAL_PLAN_SYSTEM_INSTRUCTION },
              { role: "user", content: `${prompt}\n\nReturn ONLY a JSON array. No markdown, no explanation.` },
            ],
            temperature: 0.9,
            // Same truncation risk as the Gemini path, but sized: OpenRouter
            // reserves credit against max_tokens, so asking for far more than
            // the reply needs gets the request rejected on a small balance.
            max_tokens: outputTokenBudget(dayCount),
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": process.env.PROD_CLIENT_SITE || "https://habeat.app",
              "X-Title": "Habeat",
              "Content-Type": "application/json",
            },
            timeout: 90000,
          },
        );

        // OpenRouter pads long-running requests with keep-alive lines
        // (": OPENROUTER PROCESSING") ahead of the body. Axios then fails to
        // auto-parse and hands back a raw string, which would look to us like
        // an empty response and silently burn the model — so recover it.
        let payload: any = response.data;
        if (typeof payload === "string") {
          const start = payload.search(/[[{]/);
          if (start === -1) throw new Error("No JSON in OpenRouter response");
          payload = JSON.parse(payload.slice(start));
        }

        const text: string = payload?.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty response from OpenRouter");

        const results = parseMultiDayResponse(text);
        if (results.length > 0) {
          logger.info(`[OpenRouter] ${label} success with ${model}: ${results.length} days`);
          return results;
        }
      } catch (err) {
        // No credit is an account-level fact, not a per-model one: remember it
        // and drop to the free tier immediately rather than 402-ing once per
        // paid model on this and every later generation.
        if (isOutOfCreditError(err) && !paidTierUnavailable) {
          paidTierUnavailable = true;
          logger.warn(
            `[OpenRouter] Account has no credit — disabling the paid tier for this process and continuing on free models. ` +
              `Add credit at https://openrouter.ai/credits to restore full-quality fail-over.`,
          );
          continue;
        }
        logger.warn(`[OpenRouter] Model ${model} ${label} failed: ${getErrorMessage(err)}`);
      }
    }
    return [];
  };

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchDaysData = batch.map(d => ({
      dateStr: d.dateStr, dayName: d.dayName, dayIndex: d.dayIndex, hasWorkout: d.hasWorkout,
    }));

    const skeleton = buildMenuSkeleton(
      batchDaysData,
      constraints,
      targetCalories,
      planSeed(String((userData as any)._id ?? "anon"), getLocalDateKey(weekStartDate)),
      userData.dislikes,
    );

    const prompt = buildWeeklyPlanPrompt({
      userData, skeleton, constraints, targetCalories, macros,
      recentMeals, styleNote: goalContextStr, moodContext, language,
    });

    const batchResults = await runOpenRouterPrompt(
      prompt,
      `batch ${batchIdx + 1}/${batches.length}`,
      batch.length,
    );

    if (batchResults.length > 0) {
      allDayResults.push(...batchResults);
    } else {
      logger.error(`[OpenRouter] All models failed for batch ${batchIdx + 1}`);
    }
  }

  if (allDayResults.length === 0) {
    throw new Error("OpenRouter: all models failed to produce any days");
  }

  logger.info(`[OpenRouter] Generated ${allDayResults.length}/${datesToGenerate.length} days`);

  // Small free-tier models are the most likely to drift off a restriction, so
  // the same verification runs here before anything reaches the user.
  const verifiedDays = await enforceDietaryConstraints(
    allDayResults,
    constraints,
    "OpenRouter",
    async (violatingDates, repairNote) => {
      const repairDays = allDaysData.filter((d) => violatingDates.includes(d.dateStr));
      if (repairDays.length === 0) return null;

      const repairSkeleton = buildMenuSkeleton(
        repairDays,
        constraints,
        targetCalories,
        planSeed(String((userData as any)._id ?? "anon"), getLocalDateKey(weekStartDate), "repair"),
        userData.dislikes,
      );

      const repairPrompt = buildWeeklyPlanPrompt({
        userData, skeleton: repairSkeleton, constraints, targetCalories, macros,
        recentMeals, styleNote: goalContextStr, moodContext, repairNote, language,
      });

      const repaired = await runOpenRouterPrompt(
        repairPrompt,
        "dietary repair",
        repairDays.length,
      );
      return repaired.length > 0 ? repaired : null;
    },
  );

  const parsedResponse = { weeklyPlan: verifiedDays };
  const transformedPlan = await transformWeeklyPlan(
    parsedResponse, dayToName, nameToDay, datesToGenerate,
    datesToGenerate.map(d => d.getDay()), workoutDays,
    planType, language, weekStartDate,
  );
  return await enrichPlanWithFavoriteMeals(transformedPlan, userData);
};

// MAIN: Try Gemini → OpenRouter → fail with clear error (never fall back to a model
// that might ignore dietary restrictions like vegan/allergies).
const generateMealPlanWithAI = async (
  userData: IUserData,
  weekStartDate: Date,
  planType: "daily" | "weekly" = "daily",
  language: string = "en",
  useMock: boolean = false,
  goals: IGoal[] = [],
  planTemplate?: string,
  datesOverride?: Date[], // Optional: generate only these specific dates
  moodContext?: string | null,
  recentMeals: string[] = [], // Dish names from earlier plans, to avoid repeats
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

    // ── PRIMARY: Gemini ─────────────────────────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        logger.info("=== ATTEMPTING GEMINI (PRIMARY) ===");
        return await generateMealPlanWithGemini(
          userData, weekStartDate, planType, language, geminiKey,
          goals, planTemplate, datesOverride, moodContext ?? undefined, recentMeals,
        );
      } catch (geminiError: unknown) {
        logger.warn(`[AI] Gemini failed: ${getErrorMessage(geminiError)}. Trying OpenRouter...`);
      }
    } else {
      logger.warn("[AI] GEMINI_API_KEY not configured, trying OpenRouter directly");
    }

    // ── FALLBACK: OpenRouter ────────────────────────────────────────────────
    // OpenRouter routes to real LLMs that respect dietary restrictions.
    // We never fall back to Ollama/Llama because small local models frequently
    // ignore constraints like vegan, allergies, etc. — which is dangerous.
    const openRouterKey = process.env.OPEN_ROUTER_KEY;
    if (openRouterKey) {
      try {
        logger.info("=== ATTEMPTING OPENROUTER (FALLBACK) ===");
        return await generateMealPlanWithOpenRouter(
          userData, weekStartDate, planType, language, openRouterKey,
          goals, planTemplate, datesOverride, moodContext ?? undefined, recentMeals,
        );
      } catch (openRouterError: unknown) {
        logger.warn(`[AI] OpenRouter failed: ${getErrorMessage(openRouterError)}`);
      }
    } else {
      logger.warn("[AI] OPEN_ROUTER_KEY not configured, no fallback available");
    }

    // ── ALL PROVIDERS FAILED ────────────────────────────────────────────────
    // Throw a specific error that the client can detect and display clearly.
    // Do NOT fall back to a mock/wrong plan — dietary restrictions must be respected.
    throw new Error(
      "PLAN_GENERATION_UNAVAILABLE: Our AI services are temporarily busy due to high demand. " +
      "Your dietary preferences and restrictions will be fully respected when you try again. " +
      "Please wait a few minutes and try again.",
    );
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

const buildLearningProfileSection = (userData: IUserData): string => {
  const profile = (userData as any).mealLearningProfile;
  if (!profile) return "";

  const completed: Array<{ name: string; count: number }> = profile.completedMeals || [];
  const swapped: Array<{ name: string; count: number }> = profile.swappedMeals || [];
  const scores: Record<string, number> =
    profile.cuisineScores instanceof Map
      ? Object.fromEntries(profile.cuisineScores)
      : profile.cuisineScores || {};

  const hasData =
    completed.length > 0 ||
    swapped.length > 0 ||
    Object.keys(scores).length > 0;

  if (!hasData) return "";

  const topCompleted = [...completed]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((m) => m.name)
    .join(", ");

  const topSwapped = [...swapped]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((m) => m.name)
    .join(", ");

  const topCuisines = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([c, s]) => `${c}: ${s.toFixed(1)}`)
    .join(", ");

  return `
LEARNED PREFERENCES (from actual usage — treat as strong signals):
- Enjoyed meals (completed regularly): ${topCompleted || "none yet"}
- Meals to avoid (frequently swapped): ${topSwapped || "none yet"}
- Cuisine affinity: ${topCuisines || "none yet"}

Rules:
- Never suggest a meal from the avoid list.
- Occasionally include meals similar to the enjoyed list (not a copy, a variation).
- Weight cuisine affinity scores alongside stated preferences — higher score = more inspired by that cuisine.
- Avoid list is a hard constraint. Enjoy list is a soft suggestion.
`;
};

// Builds the week's date/workout schedule shared by every meal-plan generation
// path (Gemini and OpenRouter both call this purely for dayToName/nameToDay/
// dates/activeDays/workoutDays — actual prompts are built separately by
// buildDayPrompt/buildMultiDayPrompt).
const buildPrompt = (
  userData: IUserData,
  goals: IGoal[] = [],
  planTemplate?: string,
): {
  dayToName: Record<number, string>;
  nameToDay: Record<string, number>;
  dates: Date[];
  activeDays: number[];
  workoutDays: number[];
} => {
  // For predefined plans, skip goal-based adjustments
  const goalAdjustments = planTemplate
    ? getGoalBasedAdjustments([])
    : getGoalBasedAdjustments(goals);

  // Balance workout frequency
  const userWorkoutFrequency = userData.workoutFrequency;
  const goalWorkoutFrequency = goalAdjustments.workoutFrequency;
  const effectiveWorkoutFrequency =
    goalWorkoutFrequency && userWorkoutFrequency
      ? Math.max(goalWorkoutFrequency, userWorkoutFrequency)
      : goalWorkoutFrequency || userWorkoutFrequency;

  // --- DATE & DAY GENERATION ---
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

  return { dayToName, nameToDay, dates, activeDays, workoutDays };
};

const generateRecipeDetails = async (
  dishName: string,
  category: string,
  targetCalories: number,
  ingredients: MealIngredient[],
  dietaryRestrictions: string[] = [],
  servings: number,
  language: string = "en",
  allergies: string[] = [],
): Promise<IRecipe> => {
  // Convert meal ingredients directly to recipe format — this is already-known
  // data (from the meal plan), so the model is never asked to regenerate it.
  const recipeIngredients = convertMealIngredientsToRecipeFormat(ingredients);

  const ingredientsList = recipeIngredients
    .map((ing) => `${ing.name} (${ing.amount} ${ing.unit})`.trim())
    .join(", ");

  const constraints = resolveDietaryConstraints({ dietaryRestrictions, allergies });
  const constraintBlock = buildDietaryConstraintBlock(constraints);

  const prompt = `Generate cooking instructions for "${dishName}" in ${language}.

## Input:
- Dish: ${dishName} | Category: ${category} | Servings: ${servings} | Target: ~${targetCalories} kcal/serving
- Ingredients (fixed — do not add, remove, or rename): ${ingredientsList}
${constraintBlock ? `${constraintBlock}\n` : ""}
## Response Format:
{
  "mealName": "${dishName}",
  "mealId": "unique_snake_case_id",
  "description": "brief appetizing description, max 500 chars",
  "category": "${category}",
  "servings": ${servings},
  "prepTime": 15,
  "cookTime": 30,
  "difficulty": "easy|medium|hard",
  "macros": {"calories": ${targetCalories}, "protein": 30, "carbs": 50, "fat": 15},
  "instructions": [
    {"step": 1, "instruction": "Preheat oven to 180°C", "time": 5, "temperature": 180},
    {"step": 2, "instruction": "Mix ingredients in a bowl", "time": 10, "temperature": null}
  ],
  "equipment": ["pan", "oven"],
  "tags": ["healthy", "quick"],
  "dietaryInfo": {"isVegetarian": false, "isVegan": false, "isGlutenFree": false, "isDairyFree": false, "isKeto": false, "isLowCarb": false}
}

## Rules:
1. Do NOT include an "ingredients" field — the fixed list above is attached automatically after generation.
2. "difficulty" must be exactly one of: easy, medium, hard.
3. "temperature" is in °C, or null for steps with no cooking/heating.
4. "dietaryInfo" flags must reflect this recipe's actual ingredients${dietaryRestrictions.length ? ` and the stated restrictions` : ""}.`;

  const parseResponse = (jsonText: string) => {
    const recipeData = JSON.parse(jsonText);
    return {
      _id: new mongoose.Types.ObjectId(),
      ...recipeData,
      ingredients: recipeIngredients,
      language,
      usageCount: 1,
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
  _preferences: string[] = [], // intentionally excluded from prompt — preferences must not override a named meal
  dislikes: string[] = [],
  language: string = "en",
  aiRules?: string,
  allergies: string[] = [],
): Promise<any> => {
  const constraints = resolveDietaryConstraints({ dietaryRestrictions, allergies });
  const constraintBlock = buildDietaryConstraintBlock(constraints);

  const prompt = `Generate a ${category} meal named exactly "${mealName}" in ${language}.
${constraintBlock ? `${constraintBlock}\n` : ""}
## CRITICAL: The meal name is "${mealName}". You MUST use this exact name. Do NOT rename it or blend other ingredients into the name.

## Requirements:
- Target calories: ${targetCalories}
- Category: ${category}
${dislikes.length ? `- Dislikes (avoid if possible): ${dislikes.join(", ")}` : ""}
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
${INGREDIENT_NAMING_RULES}`;

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
    allergies?: string[];
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

  // Load knowledge for grounding (dietary paths + slot rules only — keep suggestions fast)
  const suggestionKnowledge = loadKnowledge("meal-generator", {
    maxTokens: 700,
    topics: ["dietary-paths", "meal-slot-rules"],
  });

  const constraints = resolveDietaryConstraints({
    dietaryRestrictions: mealCriteria.dietaryRestrictions,
    allergies: mealCriteria.allergies,
  });
  const constraintBlock = buildDietaryConstraintBlock(constraints);

  // Variation mode ignores preferences entirely (the requested meal name is the
  // only signal that matters), so there's nothing to conflict-check there.
  const { allowed: allowedPreferences, removed: removedPreferences } =
    isVariationRequest
      ? { allowed: [], removed: [] }
      : filterFoodPreferences(mealCriteria.preferences || [], constraints);
  if (removedPreferences.length) {
    logger.warn(
      `[MealSuggestions] Dropped preferences conflicting with dietary restrictions: ${removedPreferences.join(", ")}`,
    );
  }

  const focusBlock =
    isVariationRequest && requestedMeal
      ? `Generate exactly ${numberOfSuggestions} UNIQUE VARIATIONS of "${requestedMeal}". Each meal name MUST include "${requestedMeal}" or a clear reference to it (e.g. "Grilled ${requestedMeal}", "${requestedMeal} with Herbs") — never invent an unrelated meal.
If "${requestedMeal}" is not a typical ${mealCriteria.category} food (e.g. steak for breakfast), keep its flavor/protein profile but reshape it into a ${mealCriteria.category}-appropriate dish (a "sirloin steak" breakfast variation becomes a high-protein breakfast bowl with beef, not a steak dish) — do not force the literal dinner dish into the wrong slot.`
      : `Generate exactly ${numberOfSuggestions} unique ${mealCriteria.category} meal suggestions.`;

  const needsEnglishName = language.toLowerCase() !== "en";

  const prompt = `You are a professional nutritionist. ${focusBlock}

${suggestionKnowledge ? `${suggestionKnowledge}\n\n` : ""}CATEGORY: ${mealCriteria.category.toUpperCase()} — every suggestion must fit this slot; it overrides food preferences.
- breakfast: morning foods only (eggs, oatmeal, yogurt, toast, smoothies, granola, pancakes)
- lunch: midday meals (salads, sandwiches, soups, wraps, light hot dishes)
- dinner: evening meals (proteins with sides, pasta, rice dishes, stews, grilled mains)
- snack: small bites (fruit, nuts, hummus, protein bars)
Never place a dinner-type food (pasta, rice bowls, steak, curry, heavy proteins) at breakfast, or a breakfast food at dinner.

## Requirements:
- Target calories per meal: ~${targetCalories} (±10%)
- Language: ${language}
${constraintBlock ? `${constraintBlock}\n` : ""}${allowedPreferences.length ? `- Food preferences (inspiration for lunch/dinner; for breakfast adapt the flavor/protein rather than forcing the literal dish): ${allowedPreferences.join(", ")}` : ""}
${mealCriteria.dislikes?.length ? `- Dislikes (avoid if possible): ${mealCriteria.dislikes.join(", ")}` : ""}
- Cooking level: home cooking, simple everyday methods only (boiling, frying, baking, grilling, sautéing)
${mealCriteria.aiRules && !isVariationRequest ? `- Additional rules: ${mealCriteria.aiRules}` : ""}

## Response Format:
Return a JSON object with a "meals" array containing exactly ${numberOfSuggestions} meal objects:
{
  "meals": [
    {
      "name": "Meal Name",
      "calories": 500,
      "macros": {"protein": 30, "carbs": 50, "fat": 15},
      "category": "${mealCriteria.category}",
      "ingredients": [["ingredient_name_with_underscores", "100 g"]],
      "prepTime": 20${needsEnglishName ? `,\n      "nameEn": "Plain English name of the same dish"` : ""}
    }
  ]
}

## Rules:
1. "name" - Title Case, spaces not underscores (e.g. "Stuffed Bell Peppers")${isVariationRequest && requestedMeal ? ` — MUST include "${requestedMeal}"` : ""}
2. "calories" - integer, close to ${targetCalories}
3. "macros" - protein/carbs/fat in grams (integers), must add up reasonably to calories
4. "category" - must be "${mealCriteria.category}"
5. "ingredients" - [name, amount] tuples
${INGREDIENT_NAMING_RULES}
6. "prepTime" - preparation time in minutes (integer)${needsEnglishName ? `\n7. "nameEn" - REQUIRED: the plain English name of the same dish (e.g. "name":"סלט יווני" → "nameEn":"Greek Salad"). Used only to look up a photo, never shown to the user.` : ""}`;

  const parseResponse = (jsonText: string): IMeal[] => {
    const parsed = JSON.parse(jsonText);
    const meals = parsed.meals || parsed;

    return (Array.isArray(meals) ? meals : [meals])
      .slice(0, numberOfSuggestions)
      .map((meal: any) => ({
        _id: new mongoose.Types.ObjectId().toString(),
        name: normalizeMealName(meal.name),
        nameEn: normalizeMealName(meal.nameEn || meal.name),
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
    allergies?: string[];
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

  const constraints = resolveDietaryConstraints({
    dietaryRestrictions: mealCriteria.dietaryRestrictions,
    allergies: mealCriteria.allergies,
  });
  const constraintBlock = buildDietaryConstraintBlock(constraints);

  const { allowed: allowedPreferences, removed: removedPreferences } =
    filterFoodPreferences(mealCriteria.preferences || [], constraints);
  if (removedPreferences.length) {
    logger.warn(
      `[RescueMeal] Dropped preferences conflicting with dietary restrictions: ${removedPreferences.join(", ")}`,
    );
  }

  const needsEnglishName = language.toLowerCase() !== "en";

  const prompt = `You are a professional nutritionist. Generate ONE quick "rescue meal" for someone who is tired and has no time to cook.

## CRITICAL REQUIREMENTS:
- Preparation time: MAXIMUM 10 minutes (quick assembly, minimal cooking)
- Category: ${category}
- Target calories: approximately ${targetCalories} calories (±15%)
- Target macros (±20% tolerance): Protein: ${defaultMacros.protein}g, Carbs: ${defaultMacros.carbs}g, Fat: ${defaultMacros.fat}g
- Language for meal name and ingredients: ${language}
${constraintBlock ? `${constraintBlock}\n` : ""}${allowedPreferences.length ? `- Preferences (try to include if it fits a quick meal): ${allowedPreferences.join(", ")}` : ""}
${mealCriteria.dislikes?.length ? `- Dislikes (avoid if possible): ${mealCriteria.dislikes.join(", ")}` : ""}

## MEAL CHARACTERISTICS:
- Simple, commonly available ingredients; minimal cooking (microwave, toaster, no-cook preferred)
- Quick assembly (sandwiches, wraps, bowls, smoothies, salads)
- NO restaurant/takeout suggestions — must be home-preparable

## QUICK MEAL IDEAS BY CATEGORY:
- Breakfast: overnight oats (pre-made), yogurt parfait, toast with toppings, smoothie, cereal with fruit
- Lunch: wrap/sandwich, salad bowl, hummus plate, leftover reheating, deli meat roll-ups
- Dinner: rotisserie chicken + sides, pasta with jarred sauce, stir-fry with pre-cut veggies, quesadilla, eggs + toast

## Response Format:
{
  "name": "Quick Meal Name",
  "calories": ${targetCalories},
  "macros": {"protein": ${defaultMacros.protein}, "carbs": ${defaultMacros.carbs}, "fat": ${defaultMacros.fat}},
  "category": "${category}",
  "ingredients": [["ingredient_name", "100 g"]],
  "prepTime": 10${needsEnglishName ? `,\n  "nameEn": "Plain English name of the same dish"` : ""}
}

## Rules:
1. "name" - appetizing Title Case meal name using spaces (e.g., "Greek Yogurt Power Bowl")
2. "prepTime" - MUST be 10 or less (this is critical!)
${INGREDIENT_NAMING_RULES}${needsEnglishName ? `\n3. "nameEn" - REQUIRED: the plain English name of the same dish. Used only to look up a photo, never shown to the user.` : ""}`;

  const parseResponse = (jsonText: string) => {
    const mealData = JSON.parse(jsonText);

    // Ensure prepTime is <= 10 minutes (critical for rescue meals)
    const prepTime = Math.min(mealData.prepTime || 10, 10);

    return {
      _id: new mongoose.Types.ObjectId().toString(),
      name: normalizeMealName(mealData.name),
      nameEn: normalizeMealName(mealData.nameEn || mealData.name),
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
  allergies: string[] = [],
): Promise<IMeal> => {
  const constraints = resolveDietaryConstraints({ dietaryRestrictions, allergies });
  const constraintBlock = buildDietaryConstraintBlock(constraints);

  const prompt = `Generate a snack "${snackName}" in ${language}.
${constraintBlock ? `\n${constraintBlock}\n` : ""}
## Response Format:
{
  "name": "Snack Name",
  "calories": 100,
  "macros": {"protein": 10, "carbs": 10, "fat": 10},
  "ingredients": [
    ["ingredient_name_with_underscores", "100 g", "Proteins"],
    ["another_ingredient", "50 ml", "Fruits"]
  ],
  "prepTime": 10
}

## Rules:
1. "name" - descriptive snack name in ${language}
2. "calories" - integer, close to 100
3. "macros" - protein, carbs, fat in grams (integers), must add up reasonably to calories
4. "ingredients" - [name, amount, category?] tuples; category is an optional shopping-bag label (e.g. "Proteins", "Grains", "Fruits")
${INGREDIENT_NAMING_RULES}
5. "prepTime" - integer, should be 0`;

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
  generateMealSuggestions,
  generateRescueMeal,
  generateSnack,
  generateGoal,
};

export default aiService;
