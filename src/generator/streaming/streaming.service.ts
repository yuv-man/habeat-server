import { Injectable } from "@nestjs/common";
import { GenerativeModel } from "@google/generative-ai";
import logger from "../../utils/logger";
import { callGeminiWithRateLimit } from "../../utils/gemini-rate-limiter";
import {
  IUserData,
  IGoal,
} from "../../types/interfaces";
import {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  calculateMacros,
} from "../../utils/healthCalculations";
import { PATH_WORKOUTS_GOAL } from "../../enums/enumPaths";
import {
  SkeletonDay,
  FullDay,
  PlanSkeletonPayload,
  PlanProgressPayload,
  PlanCompletePayload,
} from "./streaming.types";
import {
  transformWeeklyPlan,
  enrichPlanWithFavoriteMeals,
  MealPlanResponse,
} from "../../utils/helpers";

// Re-use helpers from generate.service
const getLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

// Variety rotation for unique meals
const CUISINE_ROTATION = [
  "Mediterranean", "Mexican", "Asian", "Italian",
  "Middle Eastern", "Indian", "Japanese",
];
const PROTEIN_ROTATION = [
  "Chicken", "Beef", "Salmon", "Tofu",
  "Turkey", "Shrimp", "Eggs",
];

interface StreamCallbacks {
  onSkeleton: (payload: PlanSkeletonPayload) => void;
  onProgress: (payload: PlanProgressPayload) => void;
  onComplete: (payload: PlanCompletePayload) => void;
  onError: (error: string, phase: string, recoverable: boolean, partialData?: any) => void;
}

@Injectable()
export class StreamingGeneratorService {
  private activeGenerations: Map<string, { cancelled: boolean }> = new Map();

  /**
   * Cancel an active generation
   */
  cancelGeneration(generationId: string): boolean {
    const generation = this.activeGenerations.get(generationId);
    if (generation) {
      generation.cancelled = true;
      this.activeGenerations.delete(generationId);
      return true;
    }
    return false;
  }

  /**
   * Generate a weekly plan with streaming updates
   * Phase 1: Generate skeleton (just meal names) - fast
   * Phase 2: Fill in details (ingredients, macros) - background
   */
  async generateWithStreaming(
    userData: IUserData,
    callbacks: StreamCallbacks,
    options: {
      generationId: string;
      weekStartDate?: Date;
      planType?: "daily" | "weekly";
      language?: string;
      goals?: IGoal[];
      planTemplate?: string;
    },
  ): Promise<void> {
    const {
      generationId,
      weekStartDate = new Date(),
      planType = "weekly",
      language = "en",
      goals = [],
      planTemplate,
    } = options;

    const startTime = Date.now();
    const generationState = { cancelled: false };
    this.activeGenerations.set(generationId, generationState);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      callbacks.onError("GEMINI_API_KEY not configured", "skeleton", false);
      return;
    }

    try {
      // Calculate targets
      const { dates, dayToName, nameToDay, workoutDays, activeDays } =
        this.calculateDates(userData, weekStartDate);
      const { targetCalories, macros } = this.calculateTargets(userData, goals, planTemplate);
      const workoutDayNums = new Set(workoutDays);

      // Check for cancellation
      if (generationState.cancelled) {
        logger.info(`[Streaming] Generation ${generationId} cancelled before skeleton`);
        return;
      }

      // === PHASE 1: Generate Skeleton (fast) ===
      logger.info(`[Streaming] Phase 1: Generating skeleton for ${dates.length} days...`);
      const skeletonStartTime = Date.now();

      const skeleton = await this.generateSkeleton(
        apiKey,
        userData,
        dates,
        dayToName,
        workoutDayNums,
        targetCalories,
      );

      if (generationState.cancelled) {
        logger.info(`[Streaming] Generation ${generationId} cancelled after skeleton`);
        return;
      }

      const skeletonTime = Date.now() - skeletonStartTime;
      logger.info(`[Streaming] Skeleton generated in ${skeletonTime}ms`);

      // Emit skeleton to client
      callbacks.onSkeleton({
        status: "skeleton",
        weeklyPlan: skeleton,
        estimatedCompletionMs: 20000, // Estimate for full details
        message: `Generated meal names in ${(skeletonTime / 1000).toFixed(1)}s. Filling in details...`,
      });

      // === PHASE 2: Generate Full Details (background) ===
      logger.info(`[Streaming] Phase 2: Generating full details...`);
      const detailsStartTime = Date.now();

      const fullDays = await this.generateDetails(
        apiKey,
        userData,
        skeleton,
        dates,
        dayToName,
        workoutDayNums,
        targetCalories,
        macros,
        generationState,
        (completedDays, updatedDays) => {
          // Progress callback
          callbacks.onProgress({
            status: "progress",
            phase: "details",
            completedDays,
            totalDays: dates.length,
            updatedDays,
            percentComplete: Math.round((completedDays / dates.length) * 80), // 80% is details
            message: `Generated details for ${completedDays}/${dates.length} days`,
          });
        },
      );

      if (generationState.cancelled) {
        logger.info(`[Streaming] Generation ${generationId} cancelled during details`);
        return;
      }

      // === PHASE 3: Transform and Enrich ===
      logger.info(`[Streaming] Phase 3: Transforming and enriching...`);

      callbacks.onProgress({
        status: "progress",
        phase: "enrichment",
        completedDays: dates.length,
        totalDays: dates.length,
        updatedDays: fullDays,
        percentComplete: 90,
        message: "Enriching with favorite meals...",
      });

      // Cast to any to handle internal type differences - transformWeeklyPlan handles normalization
      const parsedResponse = { weeklyPlan: fullDays } as any;
      const transformedPlan = await transformWeeklyPlan(
        parsedResponse,
        dayToName,
        nameToDay,
        dates,
        activeDays,
        workoutDays,
        planType,
        language,
        weekStartDate,
      );

      const enrichedPlan = await enrichPlanWithFavoriteMeals(transformedPlan, userData) as MealPlanResponse;

      const totalTime = Date.now() - startTime;
      logger.info(`[Streaming] Generation complete in ${totalTime}ms`);

      // Emit completion
      callbacks.onComplete({
        status: "complete",
        mealPlan: enrichedPlan.mealPlan as any,
        planType: enrichedPlan.planType,
        language: enrichedPlan.language,
        generatedAt: enrichedPlan.generatedAt,
        totalTimeMs: totalTime,
        message: `Plan generated in ${(totalTime / 1000).toFixed(1)}s`,
      });

    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.error(`[Streaming] Generation failed: ${errorMsg}`);
      callbacks.onError(errorMsg, "unknown", false);
    } finally {
      this.activeGenerations.delete(generationId);
    }
  }

  /**
   * Calculate dates and workout distribution
   */
  private calculateDates(userData: IUserData, weekStartDate: Date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentDay = today.getDay();

    const daysToGenerate: number[] = [];
    const dates: Date[] = [];

    if (currentDay === 0) {
      daysToGenerate.push(0);
      dates.push(new Date(today));
    } else {
      for (let day = currentDay; day <= 6; day++) {
        daysToGenerate.push(day);
        const date = new Date(today);
        date.setDate(today.getDate() + (day - currentDay));
        dates.push(date);
      }
      daysToGenerate.push(0);
      const sundayDate = new Date(today);
      sundayDate.setDate(today.getDate() + (7 - currentDay));
      dates.push(sundayDate);
    }

    const dayToName: Record<number, string> = {
      1: "monday", 2: "tuesday", 3: "wednesday", 4: "thursday",
      5: "friday", 6: "saturday", 0: "sunday",
    };
    const nameToDay: Record<string, number> = {
      monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
      friday: 5, saturday: 6, sunday: 0,
    };

    // Workout distribution
    const defaultWorkoutsPerWeek =
      PATH_WORKOUTS_GOAL[userData.path as keyof typeof PATH_WORKOUTS_GOAL] || 3;
    const totalWorkoutsPerWeek = userData.workoutFrequency ?? defaultWorkoutsPerWeek;
    const workoutsToInclude = Math.min(totalWorkoutsPerWeek, daysToGenerate.length);

    const workoutIndices = Array.from({ length: workoutsToInclude }, (_, i) =>
      Math.floor((i * daysToGenerate.length) / workoutsToInclude),
    );
    const workoutDays = workoutIndices.map((i) => daysToGenerate[i]);

    return {
      dates,
      dayToName,
      nameToDay,
      workoutDays,
      activeDays: daysToGenerate,
    };
  }

  /**
   * Calculate calorie and macro targets
   */
  private calculateTargets(userData: IUserData, goals: IGoal[], planTemplate?: string) {
    const bmr = calculateBMR(userData.weight, userData.height, userData.age, userData.gender);
    const tdee = calculateTDEE(bmr, userData.workoutFrequency);
    const targetCalories = Math.max(1200, calculateTargetCalories(tdee, userData.path));
    const macros = calculateMacros(targetCalories, userData.path);

    return { targetCalories, macros };
  }

  /**
   * PHASE 1: Generate skeleton (just meal names) - single fast API call
   */
  private async generateSkeleton(
    apiKey: string,
    userData: IUserData,
    dates: Date[],
    dayToName: Record<number, string>,
    workoutDayNums: Set<number>,
    targetCalories: number,
  ): Promise<SkeletonDay[]> {
    const daysList = dates.map((date, idx) => {
      const dayName = dayToName[date.getDay()];
      const cuisine = CUISINE_ROTATION[idx % CUISINE_ROTATION.length];
      const protein = PROTEIN_ROTATION[idx % PROTEIN_ROTATION.length];
      const hasWorkout = workoutDayNums.has(date.getDay());
      return `- ${getLocalDateKey(date)} (${dayName}): ${cuisine}, ${protein}${hasWorkout ? ", WORKOUT" : ""}`;
    }).join("\n");

    const prompt = `Generate ONLY meal names for a ${dates.length}-day meal plan. Return minimal JSON.

PERSON: ${userData.age}y ${userData.gender}, ${userData.path} path
CALORIES: ~${targetCalories}/day
AVOID: ${[...(userData.allergies || []), ...(userData.dislikes || [])].join(", ") || "none"}
PREFER: ${userData.foodPreferences?.join(", ") || "none"}

DAYS (use the cuisine/protein specified):
${daysList}

CRITICAL: Each meal name must be UNIQUE. No repeats across days.

Return ONLY this JSON structure (no markdown):
[
  {
    "date": "YYYY-MM-DD",
    "day": "dayname",
    "meals": {
      "breakfast": {"name": "Meal Name", "calories": ${Math.round(targetCalories * 0.25)}},
      "lunch": {"name": "Meal Name", "calories": ${Math.round(targetCalories * 0.35)}},
      "dinner": {"name": "Meal Name", "calories": ${Math.round(targetCalories * 0.3)}},
      "snacks": [{"name": "Snack Name", "calories": ${Math.round(targetCalories * 0.1)}}]
    },
    "hasWorkout": true/false
  }
]`;

    return callGeminiWithRateLimit<SkeletonDay[]>(
      apiKey,
      "gemini-2.5-flash-lite",
      async (model: GenerativeModel) => {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        });

        const text = result.response.text();
        const parsed = JSON.parse(text);

        // Normalize to array
        if (Array.isArray(parsed)) return parsed;
        if (parsed.weeklyPlan) return parsed.weeklyPlan;
        if (parsed.days) return parsed.days;
        return [parsed];
      },
      {
        maxRetries: 3,
        timeoutMs: 30000,
        context: "Skeleton",
      },
    );
  }

  /**
   * PHASE 2: Generate full details for each day (batched for efficiency)
   */
  private async generateDetails(
    apiKey: string,
    userData: IUserData,
    skeleton: SkeletonDay[],
    dates: Date[],
    dayToName: Record<number, string>,
    workoutDayNums: Set<number>,
    targetCalories: number,
    macros: { protein: number; carbs: number; fat: number },
    generationState: { cancelled: boolean },
    onProgress: (completedDays: number, updatedDays: FullDay[]) => void,
  ): Promise<FullDay[]> {
    const fullDays: FullDay[] = [];

    // Process in batches of 3-4 days
    const BATCH_SIZE = 3;

    for (let i = 0; i < skeleton.length; i += BATCH_SIZE) {
      if (generationState.cancelled) break;

      const batch = skeleton.slice(i, i + BATCH_SIZE);
      const batchDates = dates.slice(i, i + BATCH_SIZE);

      const batchPrompt = this.buildDetailsBatchPrompt(
        userData,
        batch,
        batchDates,
        dayToName,
        workoutDayNums,
        targetCalories,
        macros,
      );

      try {
        const batchResults = await callGeminiWithRateLimit<any[]>(
          apiKey,
          "gemini-2.5-flash-lite",
          async (model: GenerativeModel) => {
            const result = await model.generateContent({
              contents: [{ role: "user", parts: [{ text: batchPrompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.7,
              },
            });

            const text = result.response.text();
            const parsed = JSON.parse(text);
            return Array.isArray(parsed) ? parsed : [parsed];
          },
          {
            maxRetries: 3,
            timeoutMs: 60000,
            context: `DetailsBatch${Math.floor(i / BATCH_SIZE) + 1}`,
          },
        );

        fullDays.push(...batchResults);
        onProgress(fullDays.length, batchResults);

      } catch (error) {
        logger.error(`[Streaming] Batch ${i / BATCH_SIZE + 1} failed: ${getErrorMessage(error)}`);
        // Continue with next batch, add placeholder for failed days
        for (const skelDay of batch) {
          fullDays.push(this.skeletonToFullDay(skelDay));
        }
        onProgress(fullDays.length, []);
      }
    }

    return fullDays;
  }

  /**
   * Build prompt for details batch
   */
  private buildDetailsBatchPrompt(
    userData: IUserData,
    batch: SkeletonDay[],
    dates: Date[],
    dayToName: Record<number, string>,
    workoutDayNums: Set<number>,
    targetCalories: number,
    macros: { protein: number; carbs: number; fat: number },
  ): string {
    const mealsToFill = batch.map((skelDay, idx) => {
      const hasWorkout = workoutDayNums.has(dates[idx]?.getDay() || 0);
      return `
Day: ${skelDay.date} (${skelDay.day})
- Breakfast: "${skelDay.meals.breakfast.name}" (~${skelDay.meals.breakfast.calories} kcal)
- Lunch: "${skelDay.meals.lunch.name}" (~${skelDay.meals.lunch.calories} kcal)
- Dinner: "${skelDay.meals.dinner.name}" (~${skelDay.meals.dinner.calories} kcal)
- Snack: "${skelDay.meals.snacks[0]?.name || "Healthy Snack"}" (~${skelDay.meals.snacks[0]?.calories || 150} kcal)
- Workout: ${hasWorkout ? "Include 1 workout" : "Rest day"}`;
    }).join("\n");

    return `Fill in nutritional details for these meals. Keep the EXACT meal names provided.

PERSON: ${userData.age}y ${userData.gender}, daily targets: ${targetCalories} kcal, P:${macros.protein}g C:${macros.carbs}g F:${macros.fat}g
AVOID: ${[...(userData.allergies || []), ...(userData.dislikes || [])].join(", ") || "none"}

MEALS TO FILL:
${mealsToFill}

Return JSON array with full details for each day:
[
  {
    "date": "YYYY-MM-DD",
    "day": "dayname",
    "meals": {
      "breakfast": {
        "name": "EXACT NAME FROM ABOVE",
        "calories": 450,
        "macros": {"protein": 25, "carbs": 50, "fat": 15},
        "ingredients": ["chicken_breast|150|g|Proteins", "rice|100|g|Grains"],
        "prepTime": 15
      },
      "lunch": {...same structure},
      "dinner": {...same structure},
      "snacks": [{...same structure}]
    },
    "workouts": [{"name": "...", "category": "...", "duration": 30, "caloriesBurned": 200}] // empty array if rest day
  }
]

RULES:
- Keep EXACT meal names from input
- Ingredients format: "name|amount|unit|category" (RAW names only, no "chopped", "diced")
- Categories: Proteins/Vegetables/Fruits/Grains/Dairy/Pantry/Spices
- Macros math: protein*4 + carbs*4 + fat*9 ≈ calories`;
  }

  /**
   * Convert skeleton day to full day (fallback for failed batches)
   */
  private skeletonToFullDay(skelDay: SkeletonDay): FullDay {
    const makeMeal = (name: string, cal: number) => ({
      name,
      calories: cal,
      macros: { protein: 0, carbs: 0, fat: 0 },
      category: "meal",
      ingredients: [] as Array<[string, string, string?]>,
      prepTime: 0,
    });

    return {
      date: skelDay.date,
      day: skelDay.day,
      meals: {
        breakfast: makeMeal(skelDay.meals.breakfast.name, skelDay.meals.breakfast.calories || 400),
        lunch: makeMeal(skelDay.meals.lunch.name, skelDay.meals.lunch.calories || 500),
        dinner: makeMeal(skelDay.meals.dinner.name, skelDay.meals.dinner.calories || 600),
        snacks: skelDay.meals.snacks.map((s) => makeMeal(s.name, s.calories || 150)),
      },
      workouts: [],
    };
  }
}
