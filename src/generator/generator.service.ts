import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Plan } from "../plan/plan.model";
import { User } from "../user/user.model";
import { Goal } from "../goals/goal.model";
import { DailyProgress } from "../progress/progress.model";
import { ShoppingList } from "../shopping/shopping-list.model";
import aiService from "./generate.service";
import { UsdaNutritionService } from "../utils/usda-nutrition.service";
import logger from "../utils/logger";
import {
  IPlan,
  IUserData,
  IMeal,
  IMealWithStatus,
  IDayPlanWithMetadata,
  IWeeklyPlanObject,
  IWorkout,
  IGoal,
  IDailyProgress,
} from "../types/interfaces";
import { IShoppingList } from "../shopping/shopping-list.model";
import {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  calculateMacros,
  calculateIdealWeight,
} from "../utils/healthCalculations";
import {
  parsePrepTime,
  parseDuration,
  parseCalories,
  calculateDayWorkoutWater,
  getLocalDateKey,
  validateAndCorrectMealMacros,
} from "../utils/helpers";
import mongoose from "mongoose";
import { Meal } from "../meal/meal.model";
import {} from "./helper"; // helper imports kept for future use

@Injectable()
export class GeneratorService {
  constructor(
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(Meal.name) private mealModel: Model<IMeal>,
    @InjectModel(Goal.name) private goalModel: Model<IGoal>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>,
    @InjectModel(ShoppingList.name)
    private shoppingListModel: Model<IShoppingList>,
    private usdaNutritionService: UsdaNutritionService
  ) {}

  /**
   * Find existing meals from database that match criteria
   */
  private async findMatchingMeals(
    category: "breakfast" | "lunch" | "dinner" | "snack",
    targetCalories: number,
    userData: IUserData,
    limit: number = 10,
    name?: string // Optional: search by name for free-text queries
  ): Promise<IMeal[]> {
    const calorieTolerance = 150; // ±150 calories tolerance
    const minCalories = Math.max(0, targetCalories - calorieTolerance);
    const maxCalories = targetCalories + calorieTolerance;

    // Build query to find matching meals
    const query: any = {
      category,
      calories: { $gte: minCalories, $lte: maxCalories },
    };

    // Search by name if provided (for free-text user queries)
    if (name && name.trim()) {
      // Use regex for partial name matching (case-insensitive)
      const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: new RegExp(escapedName, "i") };
      // If searching by name, relax calorie constraints slightly
      query.calories = {
        $gte: Math.max(0, targetCalories - 200),
        $lte: targetCalories + 200,
      };
    }

    // Exclude meals with allergens
    if (userData.allergies && userData.allergies.length > 0) {
      const allergenRegex = new RegExp(userData.allergies.join("|"), "i");
      query.$nor = [
        { name: { $regex: allergenRegex } },
        { "ingredients.0": { $regex: allergenRegex } },
      ];
    }

    // Try to match preferences (boost score if preferences match)
    const matchingMeals = await this.mealModel
      .find(query)
      .limit(limit * 2) // Get more to filter by preferences
      .lean()
      .exec();

    // Score meals based on preference matching
    const scoredMeals = matchingMeals.map((meal: any) => {
      let score = 0;
      const mealNameLower = (meal.name || "").toLowerCase();
      const ingredientsLower = (meal.ingredients || [])
        .map((ing: any) => {
          if (Array.isArray(ing)) return String(ing[0] || "").toLowerCase();
          return String(ing || "").toLowerCase();
        })
        .join(" ");

      // Check if meal matches preferences
      if (userData.foodPreferences && userData.foodPreferences.length > 0) {
        userData.foodPreferences.forEach((pref: string) => {
          if (
            mealNameLower.includes(pref.toLowerCase()) ||
            ingredientsLower.includes(pref.toLowerCase())
          ) {
            score += 10; // Boost score for preference match
          }
        });
      }

      // Check if meal contains dislikes (penalize)
      if (userData.dislikes && userData.dislikes.length > 0) {
        userData.dislikes.forEach((dislike: string) => {
          if (
            mealNameLower.includes(dislike.toLowerCase()) ||
            ingredientsLower.includes(dislike.toLowerCase())
          ) {
            score -= 20; // Heavy penalty for dislikes
          }
        });
      }

      // Prefer meals that have been used before (proven good)
      if (meal.analytics?.timesGenerated) {
        score += Math.min(meal.analytics.timesGenerated, 5); // Max +5 for popularity
      }

      // Prefer meals closer to target calories
      const calorieDiff = Math.abs(meal.calories - targetCalories);
      score += Math.max(0, 10 - calorieDiff / 10); // Closer = higher score

      return { meal, score };
    });

    // Sort by score and return top matches
    return scoredMeals
      .filter((item) => item.score >= 0) // Only return meals without heavy penalties
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => ({
        _id: item.meal._id.toString(),
        name: item.meal.name,
        calories: item.meal.calories,
        macros: item.meal.macros,
        category: item.meal.category,
        prepTime: item.meal.prepTime || 30,
        ingredients: item.meal.ingredients || [],
      }));
  }

  /**
   * Calculate and validate meal macros based on target values
   */
  private calculateMealMacros(
    targetCalories: number,
    dailyMacros: { protein: number; carbs: number; fat: number },
    mealType: "breakfast" | "lunch" | "dinner" | "snack"
  ): { protein: number; carbs: number; fat: number; calories: number } {
    // Typical meal distribution percentages
    const mealDistribution: Record<
      string,
      { protein: number; carbs: number; fat: number }
    > = {
      breakfast: { protein: 0.2, carbs: 0.5, fat: 0.3 }, // 20% protein, 50% carbs, 30% fat
      lunch: { protein: 0.3, carbs: 0.4, fat: 0.3 }, // 30% protein, 40% carbs, 30% fat
      dinner: { protein: 0.35, carbs: 0.35, fat: 0.3 }, // 35% protein, 35% carbs, 30% fat
      snack: { protein: 0.25, carbs: 0.5, fat: 0.25 }, // 25% protein, 50% carbs, 25% fat
    };

    const distribution = mealDistribution[mealType] || mealDistribution.lunch;
    const mealCalories =
      targetCalories * distribution.protein * 4 +
      targetCalories * distribution.carbs * 4 +
      targetCalories * distribution.fat * 9;

    // Calculate macros based on daily distribution
    const protein = Math.round(
      (dailyMacros.protein * distribution.protein) /
        (distribution.protein + distribution.carbs + distribution.fat)
    );
    const carbs = Math.round(
      (dailyMacros.carbs * distribution.carbs) /
        (distribution.protein + distribution.carbs + distribution.fat)
    );
    const fat = Math.round(
      (dailyMacros.fat * distribution.fat) /
        (distribution.protein + distribution.carbs + distribution.fat)
    );

    // Recalculate calories from macros (more accurate)
    const calculatedCalories = protein * 4 + carbs * 4 + fat * 9;

    return {
      protein: Math.max(0, protein),
      carbs: Math.max(0, carbs),
      fat: Math.max(0, fat),
      calories: Math.round(calculatedCalories),
    };
  }

  /**
   * 1. Generate weekly meal plan
   *
   * Two-phase strategy (Mon–Sun weeks):
   * - Phase 1 (sync): Generate TODAY only → save plan → return immediately so the
   *   tracker page is usable right away.
   * - Phase 2 (background): Generate the remaining days of the week (tomorrow →
   *   Sunday) and merge them into the saved plan without blocking the caller.
   *
   * This keeps the user-facing latency low while ensuring the full week is always
   * generated, and naturally avoids rate-limit bursts by spreading the API calls.
   */
  async generateWeeklyMealPlan(
    userId: string,
    _startDate: Date, // kept for API compatibility; generation always starts from today
    language: string = "en",
    title: string = "My Meal Plan",
    useMock: boolean = false,
    planTemplate?: string
  ) {
    if (!userId) {
      throw new BadRequestException("Please provide user data");
    }

    const userData = await this.userModel.findById(userId).lean().exec();
    if (!userData) {
      throw new NotFoundException("User not found");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    logger.info(
      `[generateWeeklyMealPlan] Generating plan for user ${userId} starting ${getLocalDateKey(today)}`
    );

    let activeGoals: IGoal[] = [];
    if (!planTemplate) {
      activeGoals = await this.goalModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ["active", "in_progress"] },
        })
        .lean()
        .exec();
      logger.info(
        `[generateWeeklyMealPlan] ${activeGoals.length} active goals found`
      );
    }

    // Pre-calculate user metrics (shared by both phases)
    const bmr = calculateBMR(userData.weight, userData.height, userData.age, userData.gender);
    const tdee = calculateTDEE(bmr, userData.workoutFrequency);
    const targetCalories = calculateTargetCalories(tdee, userData.path);
    const macros = calculateMacros(targetCalories, userData.path);
    const idealWeightData = calculateIdealWeight(userData.height, userData.gender);

    let userIdObjectId: mongoose.Types.ObjectId;
    try {
      userIdObjectId = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : new mongoose.Types.ObjectId();
    } catch {
      userIdObjectId = new mongoose.Types.ObjectId();
    }

    // ── PHASE 1: Generate today ──────────────────────────────────────────────
    logger.info(`[Phase1] Generating today (${getLocalDateKey(today)})...`);

    const {
      mealPlan,
      language: generatedLanguage,
      generatedAt,
    } = await aiService.generateMealPlanWithAI(
      userData,
      today,
      "weekly",
      language,
      useMock,
      activeGoals,
      planTemplate,
      [today] // datesOverride: only today
    );

    if (!mealPlan?.weeklyPlan || Object.keys(mealPlan.weeklyPlan).length === 0) {
      throw new BadRequestException(
        "Failed to generate meal plan. The AI service did not return a valid meal plan."
      );
    }

    const todayResult = await this.processAIPlanDays(
      mealPlan, userData, targetCalories, macros
    );

    // Delete old plan + shopping list before creating the new one
    const oldPlan = await this.planModel.findOneAndDelete({ userId: userIdObjectId });
    if (oldPlan) {
      await this.shoppingListModel.deleteOne({ userId: userIdObjectId, planId: oldPlan._id });
    }

    // Delete today's progress (fresh start)
    const todayKey = getLocalDateKey(today);
    await this.progressModel.deleteOne({ userId: userIdObjectId, dateKey: todayKey });

    const remainingDates = this.getWeekRemainingDates(today);
    const hasRemainingDays = remainingDates.length > 0 && !useMock;

    const plan = await this.planModel.create({
      userId: userIdObjectId,
      title: title || "My Meal Plan",
      userMetrics: {
        bmr,
        tdee,
        targetCalories,
        idealWeight: idealWeightData.ideal,
        weightRange: `${idealWeightData.min.toFixed(2)} - ${idealWeightData.max.toFixed(2)}`,
        dailyMacros: macros,
      },
      userData,
      weeklyPlan: todayResult.weeklyPlanObject,
      weeklyMacros: {
        calories: { consumed: 0, total: todayResult.totalCalories },
        protein: { consumed: 0, total: todayResult.totalProtein },
        carbs:   { consumed: 0, total: todayResult.totalCarbs   },
        fat:     { consumed: 0, total: todayResult.totalFat     },
      },
      language: generatedLanguage || language,
      generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
      generationStatus: hasRemainingDays ? "generating" : "complete",
    });

    logger.info(
      `[Phase1] Today's plan saved (planId: ${plan._id}). Launching Phase 2 in background...`
    );

    // ── PHASE 2: Generate the rest of the week (background) ─────────────────
    if (hasRemainingDays) {
      // Fire-and-forget — do not await, do not block the response
      setImmediate(() => {
        this.generateAndAppendRemainingDays(
          userId,
          userIdObjectId,
          userData,
          today,
          remainingDates,
          language,
          activeGoals,
          planTemplate,
          targetCalories,
          macros
        ).catch((err) =>
          logger.error(
            `[Phase2] Background generation failed for user ${userId}: ${err?.message || err}`
          )
        );
      });
    } else {
      logger.info(`[Phase2] No remaining days to generate (today is Sunday or useMock=true).`);
    }

    const savedPlan = await this.planModel.findById(plan._id).lean().exec();

    return {
      status: "success",
      message: "Weekly meal plan generated and saved successfully",
      data: {
        planId: plan._id.toString(),
        title: plan.title,
        plan: savedPlan,
        language: generatedLanguage || language,
        generatedAt: generatedAt || new Date().toISOString(),
      },
    };
  }

  /**
   * Returns the remaining dates of the current Mon–Sun week after today.
   * Today is excluded; if today is Sunday (day 0) the array is empty.
   */
  private getWeekRemainingDates(today: Date): Date[] {
    const currentDay = today.getDay(); // 0=Sun, 1=Mon … 6=Sat
    const daysUntilSunday = currentDay === 0 ? 0 : 7 - currentDay;
    const remaining: Date[] = [];
    for (let i = 1; i <= daysUntilSunday; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      remaining.push(d);
    }
    return remaining;
  }

  /**
   * Background Phase 2: generate the remaining days of the week and merge them
   * into the existing plan document without overwriting today.
   */
  private async generateAndAppendRemainingDays(
    userId: string,
    userIdObjectId: mongoose.Types.ObjectId,
    userData: IUserData,
    weekStartDate: Date,
    remainingDates: Date[],
    language: string,
    goals: IGoal[],
    planTemplate: string | undefined,
    targetCalories: number,
    macros: { protein: number; carbs: number; fat: number }
  ): Promise<void> {
    logger.info(
      `[Phase2] Generating ${remainingDates.length} remaining days for user ${userId}: ` +
        remainingDates.map((d) => getLocalDateKey(d)).join(", ")
    );

    const { mealPlan } = await aiService.generateMealPlanWithAI(
      userData,
      weekStartDate,
      "weekly",
      language,
      false,
      goals,
      planTemplate,
      remainingDates // datesOverride: only remaining days
    );

    if (!mealPlan?.weeklyPlan || Object.keys(mealPlan.weeklyPlan).length === 0) {
      logger.warn(`[Phase2] AI returned empty plan — remaining days not added.`);
      return;
    }

    const { weeklyPlanObject } = await this.processAIPlanDays(
      mealPlan, userData, targetCalories, macros
    );

    if (Object.keys(weeklyPlanObject).length === 0) {
      logger.warn(`[Phase2] processAIPlanDays returned empty object.`);
      return;
    }

    // Merge remaining days into the existing plan using dot-notation $set
    const setPayload: Record<string, any> = { generationStatus: "complete" };
    for (const [dateKey, dayPlan] of Object.entries(weeklyPlanObject)) {
      setPayload[`weeklyPlan.${dateKey}`] = dayPlan;
    }

    await this.planModel.findOneAndUpdate(
      { userId: userIdObjectId },
      { $set: setPayload }
    );

    logger.info(
      `[Phase2] Added ${Object.keys(weeklyPlanObject).length} days to plan for user ${userId}. Generation complete.`
    );
  }

  /**
   * Converts the raw AI meal-plan response into the weeklyPlanObject stored in
   * MongoDB, reusing existing DB meals where possible to cut down on duplicates.
   */
  private async processAIPlanDays(
    mealPlan: { weeklyPlan: any },
    userData: IUserData,
    targetCalories: number,
    macros: { protein: number; carbs: number; fat: number }
  ): Promise<{
    weeklyPlanObject: IWeeklyPlanObject;
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
  }> {
    const breakfastTarget = Math.round(targetCalories * 0.25);
    const lunchTarget    = Math.round(targetCalories * 0.35);
    const dinnerTarget   = Math.round(targetCalories * 0.3);
    const snackTarget    = Math.round(targetCalories * 0.1);

    const breakfastMacros = { protein: Math.round(macros.protein * 0.2), carbs: Math.round(macros.carbs * 0.5), fat: Math.round(macros.fat * 0.3) };
    const lunchMacros    = { protein: Math.round(macros.protein * 0.3), carbs: Math.round(macros.carbs * 0.4), fat: Math.round(macros.fat * 0.3) };
    const dinnerMacros   = { protein: Math.round(macros.protein * 0.35), carbs: Math.round(macros.carbs * 0.35), fat: Math.round(macros.fat * 0.3) };
    const snackMacros    = { protein: Math.round(macros.protein * 0.15), carbs: Math.round(macros.carbs * 0.5), fat: Math.round(macros.fat * 0.25) };

    // Pre-fetch matching meals once (4 queries total, not one per meal)
    const [breakfastMatches, lunchMatches, dinnerMatches, snackMatches] =
      await Promise.all([
        this.findMatchingMeals("breakfast", breakfastTarget, userData, 10),
        this.findMatchingMeals("lunch",     lunchTarget,    userData, 10),
        this.findMatchingMeals("dinner",    dinnerTarget,   userData, 10),
        this.findMatchingMeals("snack",     snackTarget,    userData, 10),
      ]);

    const usedMealIds = new Set<string>();
    const mealIndices = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };

    // ── helpers ──────────────────────────────────────────────────────────────

    const parseIngredients = (
      ingredients: (string | [string, string, string?])[]
    ): [string, string, string?][] => {
      if (!Array.isArray(ingredients) || ingredients.length === 0) return [];
      return ingredients.map((ing) => {
        if (Array.isArray(ing) && ing.length === 3) return ing as [string, string, string?];
        if (typeof ing === "string") {
          let clean = ing.replace(/\([^)]*\)/g, "").trim();
          const parts = clean.split("|").map((p) => p.trim());
          if (parts.length >= 2) {
            const name = parts[0].toLowerCase().replace(/\s+/g, "_");
            const amount = parts.length >= 3 ? `${parts[1]} ${parts[2]}` : parts[1];
            const category = parts.length >= 4 ? parts[3] : undefined;
            return [name, amount, category];
          }
          const m = ing.match(/(.+?)\s*\(([^)]+)\)/);
          if (m) return [m[1].trim().toLowerCase().replace(/\s+/g, "_"), m[2], undefined];
          return [ing.toLowerCase().replace(/\s+/g, "_"), "", undefined];
        }
        return [String(ing).toLowerCase().replace(/\s+/g, "_"), "", undefined];
      });
    };

    const convertMeal = (meal: IMeal | null | undefined): IMeal | null => {
      if (!meal) return null;
      let mealId: string;
      if (typeof meal._id === "string") {
        mealId = meal._id;
      } else if (meal._id && typeof meal._id === "object" && "toString" in meal._id) {
        mealId = (meal._id as { toString(): string }).toString();
      } else {
        mealId = new mongoose.Types.ObjectId().toString();
      }
      return {
        name: meal.name || "Meal",
        category: (meal.category || "breakfast") as "breakfast" | "lunch" | "dinner" | "snack",
        calories: typeof meal.calories === "number" ? meal.calories : 0,
        macros: {
          protein: meal.macros?.protein || 0,
          carbs:   meal.macros?.carbs   || 0,
          fat:     meal.macros?.fat     || 0,
        },
        ingredients: parseIngredients(meal.ingredients || []),
        prepTime: parsePrepTime(meal.prepTime),
        _id: mealId,
      };
    };

    const processMealWithReuse = (
      meal: IMeal | undefined,
      category: "breakfast" | "lunch" | "dinner" | "snack"
    ): IMeal | null => {
      if (!meal) return null;

      let targetCal: number;
      let targetMacros: { protein: number; carbs: number; fat: number };
      let availableMatches: IMeal[];

      switch (category) {
        case "breakfast": targetCal = breakfastTarget; targetMacros = breakfastMacros; availableMatches = breakfastMatches; break;
        case "lunch":     targetCal = lunchTarget;    targetMacros = lunchMacros;    availableMatches = lunchMatches;    break;
        case "dinner":    targetCal = dinnerTarget;   targetMacros = dinnerMacros;   availableMatches = dinnerMatches;   break;
        case "snack":     targetCal = snackTarget;    targetMacros = snackMacros;    availableMatches = snackMatches;    break;
      }

      if (availableMatches.length > 0) {
        let attempts = 0;
        while (attempts < availableMatches.length && mealIndices[category] < availableMatches.length) {
          const candidate = availableMatches[mealIndices[category]++];
          if (!usedMealIds.has(candidate._id)) {
            usedMealIds.add(candidate._id);
            return { ...candidate, _id: candidate._id };
          }
          attempts++;
        }
      }

      const validated = validateAndCorrectMealMacros(meal as any, targetCal, targetMacros);
      const converted = convertMeal(validated as IMeal);
      if (converted) usedMealIds.add(converted._id);
      return converted;
    };

    // ── process each day ─────────────────────────────────────────────────────

    const weeklyPlanObject: IWeeklyPlanObject = {};
    let totalCalories = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;

    for (const [dateKey, dayData] of Object.entries(mealPlan.weeklyPlan)) {
      const day = dayData as IDayPlanWithMetadata;

      const workouts = (day.workouts || []).map((w: IWorkout) => ({
        name: w.name,
        category: w.category || "cardio",
        duration: parseDuration(w.duration),
        caloriesBurned: parseCalories(w.caloriesBurned),
        time: w.time,
      }));

      const breakfast      = processMealWithReuse(day.meals?.breakfast, "breakfast");
      const lunch          = processMealWithReuse(day.meals?.lunch,     "lunch");
      const dinner         = processMealWithReuse(day.meals?.dinner,    "dinner");
      const processedSnacks = (day.meals?.snacks || []).map((s) => processMealWithReuse(s, "snack"));

      const dayPlan = {
        day:   day.day,
        date:  day.date,
        meals: {
          breakfast,
          lunch,
          dinner,
          snacks: processedSnacks.filter(Boolean),
        },
        workouts,
        waterIntake: day.waterIntake || 8,
      };

      weeklyPlanObject[dateKey] = dayPlan;

      // Accumulate macro totals
      for (const meal of [breakfast, lunch, dinner, ...processedSnacks]) {
        if (!meal) continue;
        totalCalories += meal.calories || 0;
        totalProtein  += meal.macros?.protein || 0;
        totalCarbs    += meal.macros?.carbs   || 0;
        totalFat      += meal.macros?.fat     || 0;
      }
    }

    return { weeklyPlanObject, totalCalories, totalProtein, totalCarbs, totalFat };
  }

  /**
   * 2. Generate recipe for meal
   */
  async generateRecipeForMeal(
    dishName: string,
    category: string,
    ingredients: [string, string, string?][],
    servings: number,
    targetCalories: number,
    dietaryRestrictions: string[] = [],
    language: string = "en"
  ) {
    if (!dishName) {
      throw new BadRequestException("Dish name is required");
    }

    try {
      const recipeDetails = await aiService.generateRecipeDetails(
        dishName,
        category,
        targetCalories,
        ingredients,
        dietaryRestrictions,
        servings,
        language
      );

      // Handle different response structures from AI service
      const macros = recipeDetails.macros || {
        calories: recipeDetails.macros.calories || targetCalories,
        protein: recipeDetails.macros.protein || 0,
        carbs: recipeDetails.macros.carbs || 0,
        fat: recipeDetails.macros.fat || 0,
      };

      const cookTime = recipeDetails.cookTime || 30;
      const prepTime = recipeDetails.prepTime || 30;

      const metadata = {
        category: recipeDetails.category || "dinner",
        difficulty: recipeDetails.difficulty || "medium",
        servings: recipeDetails.servings || servings,
        dietaryInfo: recipeDetails.dietaryInfo || {
          isVegetarian: false,
          isVegan: false,
          isGlutenFree: false,
          isDairyFree: false,
          isKeto: false,
          isLowCarb: false,
        },
      };

      return {
        status: "success",
        message: "Recipe generated successfully",
        data: {
          name: recipeDetails.mealName || dishName,
          category: metadata.category,
          servings: metadata.servings,
          prepTime: prepTime,
          cookTime: cookTime,
          difficulty: metadata.difficulty,
          macros: {
            calories: macros.calories,
            protein: macros.protein,
            carbs: macros.carbs,
            fat: macros.fat,
          },
          ingredients: recipeDetails.ingredients || [],
          instructions: recipeDetails.instructions || [],
          dietaryInfo: metadata.dietaryInfo,
          tags: recipeDetails.tags || [],
        },
      };
    } catch (error) {
      logger.error("Error generating recipe:", error);
      throw new BadRequestException("Failed to generate recipe");
    }
  }

  /**
   * 3. Generate goal based on user criteria
   */
  async generateGoal(
    userId: string,
    title: string,
    description: string,
    category: string,
    targetDate: Date,
    startDate: Date,
    language: string = "en"
  ) {
    if (!description || !category) {
      throw new BadRequestException("Description and category are required");
    }

    // Get user data for context
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Calculate timeframe from startDate and targetDate
    const diffMs = targetDate.getTime() - startDate.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    let timeframe = "3 months";
    if (diffDays >= 30) {
      const months = Math.round(diffDays / 30);
      timeframe = `${months} months`;
    } else if (diffDays >= 7) {
      const weeks = Math.round(diffDays / 7);
      timeframe = `${weeks} weeks`;
    } else {
      timeframe = `${diffDays} days`;
    }

    // Generate goal using AI (if available) or create structured goal
    const generatedGoal = await aiService.generateGoal(
      title,
      description,
      user.workoutFrequency,
      user.path,
      timeframe,
      language,
      startDate
    );

    return {
      status: "success",
      message: "Goal generated successfully",
      data: generatedGoal,
    };
  }

  /**
   * 4. Generate meal suggestions based on user and meal criteria
   * OPTIMIZED: Uses DB meals first, then fills remaining slots with AI-generated meals
   * ENHANCED: Now supports mood-aware suggestions
   */
  async generateMealSuggestions(
    userId: string,
    mealCriteria: {
      category: "breakfast" | "lunch" | "dinner" | "snack";
      targetCalories?: number;
      dietaryRestrictions?: string[];
      preferences?: string[];
      dislikes?: string[];
      numberOfSuggestions?: number;
      aiRules?: string; // Can contain free-text meal name query
      // Mood-aware parameters
      currentMood?: {
        moodCategory: string;
        moodLevel: number;
      };
      moodFoodSuggestions?: string[]; // Foods recommended for current mood
    },
    language: string = "en"
  ) {
    if (!mealCriteria.category) {
      throw new BadRequestException("Meal category is required");
    }

    const numberOfSuggestions = mealCriteria.numberOfSuggestions || 3;
    const targetCalories = mealCriteria.targetCalories || 500;

    // Extract meal name from aiRules if it looks like a meal name query
    // aiRules can contain free-text like "beef steak" or "chicken salad"
    let mealNameFromRules: string | undefined;
    let isMealNameRequest = false;
    
    if (mealCriteria.aiRules && mealCriteria.aiRules.trim()) {
      const rulesLower = mealCriteria.aiRules.toLowerCase().trim();
      // If aiRules is short and doesn't contain common instruction words, treat it as meal name
      const instructionWords = [
        "make",
        "create",
        "generate",
        "suggest",
        "include",
        "add",
        "use",
        "with",
        "without",
      ];
      const isInstruction = instructionWords.some((word) =>
        rulesLower.includes(word)
      );

      // If it's short (< 50 chars) and doesn't look like an instruction, treat as meal name
      if (!isInstruction && mealCriteria.aiRules.length < 50) {
        mealNameFromRules = mealCriteria.aiRules.trim();
        isMealNameRequest = true;
        logger.info(
          `[generateMealSuggestions] PRIORITY: User requested meal variations of "${mealNameFromRules}"`
        );
      }
    }

    // Get user data to include dietary info if not provided
    const user = await this.userModel.findById(userId);
    if (user) {
      // Merge user's dietary restrictions and allergies with provided ones
      if (!mealCriteria.dietaryRestrictions?.length) {
        mealCriteria.dietaryRestrictions = [
          ...((user as any).dietaryRestrictions || []),
          ...((user as any).allergies || []),
        ];
      }
      if (!mealCriteria.dislikes?.length) {
        mealCriteria.dislikes = (user as any).dislikes || [];
      }
      if (!mealCriteria.preferences?.length) {
        mealCriteria.preferences = (user as any).foodPreferences || [];
      }
    }

    let allMeals: IMeal[] = [];
    let dbCount = 0;
    let aiCount = 0;

    // Check if aiRules exists (any kind of AI rules, not just meal name)
    const hasAiRules = mealCriteria.aiRules && mealCriteria.aiRules.trim().length > 0;

    // Build mood-aware context for AI suggestions
    let moodContext = "";
    if (mealCriteria.currentMood) {
      const { moodCategory, moodLevel } = mealCriteria.currentMood;
      moodContext = `The user is currently feeling ${moodCategory} (level ${moodLevel}/5). `;

      if (mealCriteria.moodFoodSuggestions && mealCriteria.moodFoodSuggestions.length > 0) {
        moodContext += `Consider including ingredients like: ${mealCriteria.moodFoodSuggestions.slice(0, 5).join(", ")}. `;
      }

      // Add mood-specific guidance
      const moodGuidance: Record<string, string> = {
        stressed: "Suggest calming, comfort foods rich in magnesium and omega-3s.",
        anxious: "Suggest gut-friendly foods with probiotics and tryptophan.",
        sad: "Suggest mood-boosting foods rich in omega-3s and vitamin D.",
        tired: "Suggest energizing foods with complex carbs and iron.",
        happy: "Suggest balanced, nutritious meals to maintain the good mood.",
        calm: "Suggest light, Mediterranean-style meals.",
        energetic: "Suggest balanced meals that won't cause an energy crash.",
        angry: "Suggest calming foods with magnesium and complex carbs.",
        neutral: "Suggest balanced, nutritious meals.",
      };

      moodContext += moodGuidance[moodCategory] || moodGuidance.neutral;
    }

    // PRIORITY FLOW: If user requested a specific meal (e.g., "beef steak"), generate variations FIRST
    if (isMealNameRequest && mealNameFromRules) {
    logger.info(
        `[generateMealSuggestions] PRIORITY MODE: Generating ${numberOfSuggestions} variations of "${mealNameFromRules}"`
      );

      // Generate variations of the requested meal via AI
      const aiCriteria = {
        ...mealCriteria,
        numberOfSuggestions,
        aiRules: `Generate ${numberOfSuggestions} different variations of "${mealNameFromRules}". Each variation should be unique (e.g., different cooking methods, seasonings, sides, or preparations) but all based on "${mealNameFromRules}". Examples: "Grilled ${mealNameFromRules}", "Pan-Seared ${mealNameFromRules}", "${mealNameFromRules} with Herbs", etc.`,
      };

      const aiMeals = await aiService.generateMealSuggestions(aiCriteria, language);

      // Calculate nutrition using USDA for each generated meal
      const mealsWithUsdaNutrition: IMeal[] = [];
      for (const meal of aiMeals) {
        try {
          // If meal has ingredients, calculate nutrition from USDA
          if (meal.ingredients && meal.ingredients.length > 0) {
            const ingredientPairs: Array<[string, string]> = meal.ingredients.map((ing) => {
              if (Array.isArray(ing)) {
                return [ing[0] || "", ing[1] || "100g"];
              }
              return [String(ing), "100g"];
            });

            const usdaNutrition = await this.usdaNutritionService.calculateMealNutrition(
              ingredientPairs
            );

            // Use USDA nutrition if available and reasonable
            if (usdaNutrition.source !== "estimated" && usdaNutrition.calories > 0) {
              meal.calories = usdaNutrition.calories;
              meal.macros = usdaNutrition.macros;
              logger.debug(
                `[generateMealSuggestions] Used USDA nutrition for "${meal.name}": ${meal.calories} cal`
              );
            }
          }
        } catch (error) {
          logger.warn(
            `[generateMealSuggestions] Failed to calculate USDA nutrition for "${meal.name}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Keep AI-generated nutrition as fallback
        }

        mealsWithUsdaNutrition.push(meal);
      }

      // Validate that all meals actually contain the requested meal name
      const mealNameLower = mealNameFromRules.toLowerCase();
      const validatedMeals = mealsWithUsdaNutrition.filter((meal) => {
        const mealName = meal.name.toLowerCase();
        // Check if meal name contains the requested meal name
        const containsRequestedMeal = mealName.includes(mealNameLower);
        if (!containsRequestedMeal) {
          logger.warn(
            `[generateMealSuggestions] Filtered out meal "${meal.name}" - doesn't contain requested "${mealNameFromRules}"`
          );
        }
        return containsRequestedMeal;
      });

      // If we filtered out meals, log warning
      if (validatedMeals.length < mealsWithUsdaNutrition.length) {
        logger.warn(
          `[generateMealSuggestions] Filtered out ${mealsWithUsdaNutrition.length - validatedMeals.length} meals that didn't match "${mealNameFromRules}"`
        );
      }

      // If we don't have enough meals after validation, generate more
      if (validatedMeals.length < numberOfSuggestions) {
        logger.info(
          `[generateMealSuggestions] Only ${validatedMeals.length} valid meals found, need ${numberOfSuggestions}. Generating more...`
        );
        const needed = numberOfSuggestions - validatedMeals.length;
        const additionalCriteria = {
          ...mealCriteria,
          numberOfSuggestions: needed,
          aiRules: `Generate ${needed} different variations of "${mealNameFromRules}". Each variation MUST include "${mealNameFromRules}" in the name. Examples: "Grilled ${mealNameFromRules}", "Pan-Seared ${mealNameFromRules}", "${mealNameFromRules} with Herbs".`,
        };
        
        const additionalMeals = await aiService.generateMealSuggestions(additionalCriteria, language);
        
        // Validate and add additional meals
        for (const meal of additionalMeals) {
          const mealName = meal.name.toLowerCase();
          if (mealName.includes(mealNameLower)) {
            // Calculate USDA nutrition
            try {
              if (meal.ingredients && meal.ingredients.length > 0) {
                const ingredientPairs: Array<[string, string]> = meal.ingredients.map((ing) => {
                  if (Array.isArray(ing)) {
                    return [ing[0] || "", ing[1] || "100g"];
                  }
                  return [String(ing), "100g"];
                });

                const usdaNutrition = await this.usdaNutritionService.calculateMealNutrition(
                  ingredientPairs
                );

                if (usdaNutrition.source !== "estimated" && usdaNutrition.calories > 0) {
                  meal.calories = usdaNutrition.calories;
                  meal.macros = usdaNutrition.macros;
                }
              }
            } catch (error) {
              // Keep AI nutrition as fallback
            }
            
            validatedMeals.push(meal);
            if (validatedMeals.length >= numberOfSuggestions) break;
          }
        }
      }

      allMeals = validatedMeals.slice(0, numberOfSuggestions);
      aiCount = allMeals.length;
      dbCount = 0;

      // Save AI-generated meals to database for future reuse
      if (allMeals.length > 0) {
        try {
          await this.mealModel.insertMany(
            allMeals.map((meal) => ({
              ...meal,
              aiGenerated: true,
              analytics: {
                timesGenerated: 1,
              },
            }))
          );
          logger.info(
            `[generateMealSuggestions] Saved ${allMeals.length} meal variations to DB`
          );
        } catch (error) {
          logger.warn(
            `[generateMealSuggestions] Failed to save some meals to DB: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else if (hasAiRules) {
      // AI RULES FLOW: User provided aiRules - generate via AI first, check DB only for exact matches
      logger.info(
        `[generateMealSuggestions] AI RULES MODE: Generating meals based on aiRules: "${mealCriteria.aiRules}"`
      );

      // First, check DB for exact name match if aiRules looks like a meal name
      let exactDbMatches: IMeal[] = [];
      if (mealCriteria.aiRules && mealCriteria.aiRules.length < 100) {
        // Try to find exact match in DB
        try {
          const exactMatch = await this.mealModel.findOne({
            category: mealCriteria.category,
            name: { $regex: new RegExp(`^${mealCriteria.aiRules.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
          }).lean();

          if (exactMatch) {
            exactDbMatches = [{
              _id: exactMatch._id.toString(),
              name: exactMatch.name,
              calories: exactMatch.calories,
              macros: exactMatch.macros || { protein: 0, carbs: 0, fat: 0 },
              category: exactMatch.category,
              prepTime: parsePrepTime(exactMatch.prepTime),
              ingredients: exactMatch.ingredients || [],
            }];
            logger.info(
              `[generateMealSuggestions] Found exact DB match: "${exactMatch.name}"`
            );
          }
        } catch (error) {
          logger.warn(`[generateMealSuggestions] Error checking for exact DB match: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Generate meals via AI using aiRules
      const aiCriteria = {
        ...mealCriteria,
        numberOfSuggestions: numberOfSuggestions - exactDbMatches.length,
      };

      logger.info(
        `[generateMealSuggestions] Generating ${aiCriteria.numberOfSuggestions} meals via AI with aiRules`
      );

      const aiMeals = await aiService.generateMealSuggestions(aiCriteria, language);

      // Calculate USDA nutrition for AI-generated meals
      const mealsWithUsdaNutrition: IMeal[] = [];
      for (const meal of aiMeals) {
        try {
          // If meal has ingredients, calculate nutrition from USDA
          if (meal.ingredients && meal.ingredients.length > 0) {
            const ingredientPairs: Array<[string, string]> = meal.ingredients.map((ing) => {
              if (Array.isArray(ing)) {
                return [ing[0] || "", ing[1] || "100g"];
              }
              return [String(ing), "100g"];
            });

            const usdaNutrition = await this.usdaNutritionService.calculateMealNutrition(
              ingredientPairs
            );

            // Use USDA nutrition if available and reasonable
            if (usdaNutrition.source !== "estimated" && usdaNutrition.calories > 0) {
              meal.calories = usdaNutrition.calories;
              meal.macros = usdaNutrition.macros;
              logger.debug(
                `[generateMealSuggestions] Used USDA nutrition for "${meal.name}": ${meal.calories} cal`
              );
            }
          }
        } catch (error) {
          logger.warn(
            `[generateMealSuggestions] Failed to calculate USDA nutrition for "${meal.name}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Keep AI-generated nutrition as fallback
        }

        mealsWithUsdaNutrition.push(meal);
      }

      // Combine exact DB matches (if any) with AI-generated meals
      allMeals = [...exactDbMatches, ...mealsWithUsdaNutrition].slice(
        0,
        numberOfSuggestions
      );

      dbCount = exactDbMatches.length;
      aiCount = mealsWithUsdaNutrition.length;

      // Update usage count for DB meals
      for (const meal of exactDbMatches) {
        try {
          await this.mealModel.findByIdAndUpdate(meal._id, {
            $inc: { "analytics.timesGenerated": 1 },
          });
        } catch (error) {
          // Ignore errors updating analytics
        }
      }

      // Save AI-generated meals to database
      if (mealsWithUsdaNutrition.length > 0) {
        try {
          await this.mealModel.insertMany(
            mealsWithUsdaNutrition.map((meal) => ({
              ...meal,
              aiGenerated: true,
              analytics: {
                timesGenerated: 1,
              },
            }))
          );
          logger.info(
            `[generateMealSuggestions] Saved ${mealsWithUsdaNutrition.length} AI-generated meals to DB`
          );
        } catch (error) {
          logger.warn(
            `[generateMealSuggestions] Failed to save some AI meals to DB: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else {
      // STANDARD FLOW: No aiRules - Query DB first, then fill with AI if needed
      logger.info(
        `[generateMealSuggestions] Standard mode: Querying DB first for category=${mealCriteria.category}, calories=${targetCalories}`
      );

      const dbMeals = await this.findMatchingMeals(
        mealCriteria.category,
        targetCalories,
        user as IUserData,
        numberOfSuggestions,
        mealNameFromRules
      );

      logger.info(
        `[generateMealSuggestions] Found ${dbMeals.length} meals from DB, need ${numberOfSuggestions} total`
      );

      // Convert DB meals to IMeal format
      const dbMealsFormatted: IMeal[] = dbMeals.map((meal: any) => ({
        _id: meal._id.toString(),
        name: meal.name,
        calories: meal.calories,
        macros: meal.macros || { protein: 0, carbs: 0, fat: 0 },
        category: meal.category,
        prepTime: parsePrepTime(meal.prepTime),
        ingredients: meal.ingredients || [],
      }));

      // Fill remaining slots with AI-generated meals (if needed)
      const remainingSlots = Math.max(
        0,
        numberOfSuggestions - dbMealsFormatted.length
      );
      let aiMeals: IMeal[] = [];

      if (remainingSlots > 0) {
        logger.info(
          `[generateMealSuggestions] Generating ${remainingSlots} meals via AI to fill remaining slots`
        );

        // Build AI rules with mood context if available
        let enhancedAiRules = mealCriteria.aiRules || "";
        if (moodContext) {
          enhancedAiRules = moodContext + (enhancedAiRules ? ` ${enhancedAiRules}` : "");
          logger.info(`[generateMealSuggestions] Added mood context: ${moodContext}`);
        }

        const aiCriteria = {
          ...mealCriteria,
          numberOfSuggestions: remainingSlots,
          aiRules: enhancedAiRules || undefined,
        };

        aiMeals = await aiService.generateMealSuggestions(aiCriteria, language);

        // Calculate USDA nutrition for AI-generated meals
        for (const meal of aiMeals) {
          try {
            if (meal.ingredients && meal.ingredients.length > 0) {
              const ingredientPairs: Array<[string, string]> = meal.ingredients.map((ing) => {
                if (Array.isArray(ing)) {
                  return [ing[0] || "", ing[1] || "100g"];
                }
                return [String(ing), "100g"];
              });

              const usdaNutrition = await this.usdaNutritionService.calculateMealNutrition(
                ingredientPairs
              );

              if (usdaNutrition.source !== "estimated" && usdaNutrition.calories > 0) {
                meal.calories = usdaNutrition.calories;
                meal.macros = usdaNutrition.macros;
              }
            }
          } catch (error) {
            // Keep AI nutrition as fallback
          }
        }

        // Save AI-generated meals to database
        if (aiMeals.length > 0) {
          try {
            await this.mealModel.insertMany(
              aiMeals.map((meal) => ({
                ...meal,
                aiGenerated: true,
                analytics: {
                  timesGenerated: 1,
                },
              }))
            );
            logger.info(
              `[generateMealSuggestions] Saved ${aiMeals.length} AI-generated meals to DB`
            );
          } catch (error) {
            logger.warn(
              `[generateMealSuggestions] Failed to save some AI meals to DB: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        logger.info(
          `[generateMealSuggestions] All ${numberOfSuggestions} meals found in DB, no AI generation needed!`
        );
      }

      // Combine DB meals and AI meals, prioritizing DB meals
      allMeals = [...dbMealsFormatted, ...aiMeals].slice(
        0,
        numberOfSuggestions
      );

      // Track counts
      dbCount = dbMealsFormatted.length;
      aiCount = aiMeals.length;

      // Update usage count for DB meals
      for (const meal of dbMealsFormatted) {
        try {
          await this.mealModel.findByIdAndUpdate(meal._id, {
            $inc: { "analytics.timesGenerated": 1 },
          });
        } catch (error) {
          // Ignore errors updating analytics
        }
      }
    }

    return {
      success: true,
      message: isMealNameRequest || hasAiRules
        ? hasAiRules 
          ? `Generated ${allMeals.length} meals based on aiRules`
          : `Generated ${allMeals.length} variations of "${mealNameFromRules}"`
        : `Generated ${allMeals.length} meal suggestions (${dbCount} from DB, ${aiCount} from AI)`,
      data: {
        meals: allMeals,
        criteria: {
          category: mealCriteria.category,
          targetCalories: mealCriteria.targetCalories,
          numberOfSuggestions: numberOfSuggestions,
        },
        source: {
          fromDatabase: dbCount,
          fromAI: aiCount,
          priority: isMealNameRequest ? "mealName" : hasAiRules ? "aiRules" : "standard",
        },
      },
    };
  }

  /**
   * 5. Generate a quick rescue meal (<=10 min prep) and swap it into the plan
   * This is an atomic operation: generate + swap in one call for instant UX
   * Used by the "I'm Tired" button feature
   */
  async generateAndSwapRescueMeal(
    userId: string,
    planId: string,
    date: string,
    mealType: "breakfast" | "lunch" | "dinner",
    currentMeal: {
      calories: number;
      macros?: { protein: number; carbs: number; fat: number };
    },
    language: string = "en"
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      rescueMeal: IMeal;
      originalMealName: string;
    };
  }> {
    // 1. Get user data for dietary restrictions and preferences
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) {
      throw new NotFoundException("User not found");
    }

    // 2. Get the plan and current meal
    const plan = await this.planModel.findById(planId);
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    // Find the day in the plan using the date key
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[date];

    if (!dayPlan) {
      throw new NotFoundException(`Day ${date} not found in plan`);
    }

    const originalMeal = dayPlan.meals?.[mealType];
    if (!originalMeal) {
      throw new NotFoundException(`${mealType} not found for ${date}`);
    }

    // 3. Use current meal's macros as target, or fall back to provided values
    const targetCalories = currentMeal.calories || originalMeal.calories || 500;
    const targetMacros = currentMeal.macros ||
      originalMeal.macros || {
        protein: Math.round((targetCalories * 0.25) / 4),
        carbs: Math.round((targetCalories * 0.45) / 4),
        fat: Math.round((targetCalories * 0.3) / 9),
      };

    // 4. Generate rescue meal via AI
    logger.info(
      `[RescueMeal] Generating rescue meal for ${mealType} on ${date} (target: ${targetCalories} kcal)`
    );

    const rescueMeal = await aiService.generateRescueMeal(
      {
        category: mealType,
        targetCalories,
        targetMacros,
        dietaryRestrictions: [
          ...((user as any).dietaryRestrictions || []),
          ...((user as any).allergies || []),
        ],
        preferences: (user as any).foodPreferences || [],
        dislikes: (user as any).dislikes || [],
      },
      language
    );

    // 5. Save rescue meal to database for future reuse
    const savedMeal = await this.mealModel.create({
      name: rescueMeal.name,
      calories: rescueMeal.calories,
      macros: rescueMeal.macros,
      category: mealType,
      prepTime: rescueMeal.prepTime,
      ingredients: rescueMeal.ingredients,
      aiGenerated: true,
      isRescueMeal: true,
      analytics: {
        timesGenerated: 1,
      },
    });

    // 6. Prepare meal data for plan update
    const mealData: IMealWithStatus = {
      _id: savedMeal._id.toString(),
      name: savedMeal.name,
      calories: Math.round(savedMeal.calories),
      macros: {
        protein: Math.round(savedMeal.macros?.protein || 0),
        carbs: Math.round(savedMeal.macros?.carbs || 0),
        fat: Math.round(savedMeal.macros?.fat || 0),
      },
      category: mealType,
      ingredients: savedMeal.ingredients || [],
      prepTime: savedMeal.prepTime || 10,
      done: false,
    };

    // 7. Calculate calorie/macro differences for daily totals update
    const calorieDiff = (mealData.calories || 0) - (originalMeal.calories || 0);
    const proteinDiff =
      (mealData.macros?.protein || 0) - (originalMeal.macros?.protein || 0);
    const carbsDiff =
      (mealData.macros?.carbs || 0) - (originalMeal.macros?.carbs || 0);
    const fatDiff =
      (mealData.macros?.fat || 0) - (originalMeal.macros?.fat || 0);

    // 8. Update the plan with the new meal
    dayPlan.meals[mealType] = mealData;

    // Update daily totals if they exist
    if (dayPlan.totalCalories !== undefined) {
      dayPlan.totalCalories = Math.round(
        (dayPlan.totalCalories || 0) + calorieDiff
      );
    }
    if (dayPlan.totalProtein !== undefined) {
      dayPlan.totalProtein = Math.round(
        (dayPlan.totalProtein || 0) + proteinDiff
      );
    }
    if (dayPlan.totalCarbs !== undefined) {
      dayPlan.totalCarbs = Math.round((dayPlan.totalCarbs || 0) + carbsDiff);
    }
    if (dayPlan.totalFat !== undefined) {
      dayPlan.totalFat = Math.round((dayPlan.totalFat || 0) + fatDiff);
    }

    plan.markModified("weeklyPlan");
    await plan.save();

    // 9. Update progress record if it exists for this date
    const progress = await this.progressModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      dateKey: date,
    });

    if (progress) {
      const progressMeals = (progress as any).meals || {};
      progressMeals[mealType] = { ...mealData, done: false };
      progress.markModified("meals");
      await progress.save();
      logger.info(`[RescueMeal] Updated progress record for ${date}`);
    }

    logger.info(
      `[RescueMeal] Successfully swapped "${originalMeal.name}" with "${rescueMeal.name}" (${rescueMeal.prepTime} min prep)`
    );

    return {
      success: true,
      message: `Swapped to quick meal: ${rescueMeal.name}`,
      data: {
        rescueMeal: mealData,
        originalMealName: originalMeal.name || "Unknown meal",
      },
    };
  }
}
