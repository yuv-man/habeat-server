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
import { isPlanExpired } from "./helper";

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
    private shoppingListModel: Model<IShoppingList>
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
   */
  async generateWeeklyMealPlan(
    userId: string,
    startDate: Date,
    language: string = "en",
    title: string = "Weekly Meal Plan for " +
      startDate.toISOString().split("T")[0],
    useMock: boolean = false
  ) {
    if (!userId) {
      throw new BadRequestException("Please provide user data");
    }

    const userData = await this.userModel.findById(userId).lean().exec();
    if (!userData) {
      throw new NotFoundException("User not found");
    }

    // Ensure startDate is today or in the future - if not provided or in the past, use today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const actualStartDate = new Date(startDate);
    actualStartDate.setHours(0, 0, 0, 0);

    // If startDate is in the past, use today instead
    const finalStartDate = actualStartDate < today ? today : actualStartDate;

    logger.info(
      `Generating meal plan starting from: ${finalStartDate.toISOString().split("T")[0]} (today is ${today.toISOString().split("T")[0]})`
    );

    // Fetch active goals for the user
    const activeGoals = await this.goalModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        status: { $in: ["active", "in_progress"] },
      })
      .lean()
      .exec();

    logger.info(
      `[generateWeeklyMealPlan] Found ${activeGoals.length} active goals for user ${userId}`
    );

    const {
      mealPlan,
      language: generatedLanguage,
      generatedAt,
    } = await aiService.generateMealPlanWithAI(
      userData,
      finalStartDate,
      "weekly", // Force weekly
      language,
      useMock,
      activeGoals // Pass goals to AI service
    );

    // Validate that meal plan was generated
    if (!mealPlan || !mealPlan.weeklyPlan) {
      throw new BadRequestException(
        "Failed to generate meal plan. The AI service did not return a valid meal plan. Please try again or contact support if the issue persists."
      );
    }

    // Validate that weeklyPlan is an object with content (key-value format with date keys)
    const weeklyPlanEntriesForValidation = Object.entries(mealPlan.weeklyPlan);
    if (
      !weeklyPlanEntriesForValidation ||
      weeklyPlanEntriesForValidation.length === 0
    ) {
      throw new BadRequestException(
        "Failed to generate meal plan. The generated meal plan is empty or invalid. Please try again or contact support if the issue persists."
      );
    }

    // Validate that at least some days have meals
    const daysWithMeals = weeklyPlanEntriesForValidation.filter(
      ([dateKey, day]: [string, any]) =>
        day?.meals &&
        (day.meals.breakfast || day.meals.lunch || day.meals.dinner)
    );

    if (daysWithMeals.length === 0) {
      throw new BadRequestException(
        "Failed to generate meal plan. The generated meal plan does not contain any meals. Please try again or contact support if the issue persists."
      );
    }

    // CRITICAL: Validate max 7 days - a week can never have more than 7 days
    if (weeklyPlanEntriesForValidation.length > 7) {
      logger.error(
        `[generateWeeklyMealPlan] AI returned ${weeklyPlanEntriesForValidation.length} days, max is 7! Trimming to first 7 days.`
      );
      // Sort by date and keep only first 7
      const sortedEntries = weeklyPlanEntriesForValidation.sort(([a], [b]) =>
        a.localeCompare(b)
      );
      const entriesToKeep = sortedEntries.slice(0, 7);
      mealPlan.weeklyPlan = Object.fromEntries(entriesToKeep);
      logger.info(
        `[generateWeeklyMealPlan] Trimmed plan to ${Object.keys(mealPlan.weeklyPlan).length} days`
      );
    }

    // Calculate user metrics
    const bmr = calculateBMR(
      userData.weight,
      userData.height,
      userData.age,
      userData.gender
    );
    const tdee = calculateTDEE(bmr, userData.workoutFrequency);
    const targetCalories = calculateTargetCalories(tdee, userData.path);
    const macros = calculateMacros(targetCalories, userData.path);
    const idealWeightData = calculateIdealWeight(
      userData.height,
      userData.gender
    );

    // Convert userId to ObjectId if it's a valid string, otherwise create a new one
    let userIdObjectId: mongoose.Types.ObjectId;
    try {
      userIdObjectId = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : new mongoose.Types.ObjectId();
    } catch (error) {
      userIdObjectId = new mongoose.Types.ObjectId();
    }

    // Delete existing plan if exists (user can have only one plan)
    if (userIdObjectId) {
      await this.planModel.findOneAndDelete({ userId: userIdObjectId });
    }

    // Calculate meal-specific targets for validation and reuse
    const breakfastTarget = Math.round(targetCalories * 0.25);
    const lunchTarget = Math.round(targetCalories * 0.35);
    const dinnerTarget = Math.round(targetCalories * 0.3);
    const snackTarget = Math.round(targetCalories * 0.1);

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

    // Convert mealPlan.weeklyPlan array to object format with date keys
    const weeklyPlanObject: IWeeklyPlanObject = {};
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    // Helper to parse ingredients from "name|amount|unit" format to [name, amount] tuple
    const parseIngredients = (
      ingredients: (string | [string, string, string?])[]
    ): [string, string, string?][] => {
      if (!Array.isArray(ingredients) || ingredients.length === 0) return [];

      return ingredients.map((ing: string | [string, string, string?]) => {
        // If already tuple format, return as is
        if (Array.isArray(ing) && ing.length === 3) {
          return ing as [string, string, string?];
        }

        // If string format "name|amount|unit", parse it
        if (typeof ing === "string") {
          // Handle formats like "Avocado (1|170g)" or "egg|2|unit"
          // Remove parentheses and extra info
          let cleanIng = ing.replace(/\([^)]*\)/g, "").trim();

          // Split by | to get name, amount, unit, and optional category
          const parts = cleanIng.split("|").map((p) => p.trim());

          if (parts.length >= 2) {
            const name = parts[0].toLowerCase().replace(/\s+/g, "_");
            // Combine amount and unit: "200 g" or "2 unit"
            const amount =
              parts.length >= 3 ? `${parts[1]} ${parts[2]}` : parts[1];
            const category = parts.length >= 4 ? parts[3] : undefined;
            return [name, amount, category];
          }

          // If no | separator, try to extract from formats like "Avocado (1|170g)"
          const match = ing.match(/(.+?)\s*\(([^)]+)\)/);
          if (match) {
            const name = match[1].trim().toLowerCase().replace(/\s+/g, "_");
            const amountInfo = match[2];
            const category = undefined;
            return [name, amountInfo, category];
          }

          // Fallback: use whole string as name, empty amount
          const name = ing.toLowerCase().replace(/\s+/g, "_");
          const amount = "";
          const category = undefined;
          return [name, amount, category];
        }

        // Fallback for other types
        const name = String(ing).toLowerCase().replace(/\s+/g, "_");
        const amount = "";
        const category = undefined;
        return [name, amount, category];
      });
    };

    // Helper to convert meal and ensure it has _id and proper structure
    const convertMeal = (meal: IMeal | null | undefined): IMeal | null => {
      if (!meal) return null;

      // Handle _id conversion
      let mealId: string;
      if (typeof meal._id === "string") {
        mealId = meal._id;
      } else if (
        meal._id &&
        typeof meal._id === "object" &&
        "toString" in meal._id
      ) {
        mealId = (meal._id as { toString(): string }).toString();
      } else {
        mealId = new mongoose.Types.ObjectId().toString();
      }

      return {
        name: meal.name || "Meal",
        category: (meal.category || "breakfast") as
          | "breakfast"
          | "lunch"
          | "dinner"
          | "snack",
        calories: typeof meal.calories === "number" ? meal.calories : 0,
        macros: {
          protein: meal.macros?.protein || 0,
          carbs: meal.macros?.carbs || 0,
          fat: meal.macros?.fat || 0,
        },
        ingredients: parseIngredients(meal.ingredients || []),
        prepTime: parsePrepTime(meal.prepTime),
        _id: mealId,
      };
    };

    // Process each day in the weekly plan (now in key-value format)
    // mealPlan.weeklyPlan is now an object with date keys
    const weeklyPlanEntries = Object.entries(mealPlan.weeklyPlan);

    // PERFORMANCE OPTIMIZATION: Pre-fetch all matching meals for each category upfront
    // This reduces DB queries from ~21-28 (one per meal) to just 4 (one per category)
    logger.info(
      `[generateWeeklyMealPlan] Pre-fetching matching meals from database for reuse...`
    );
    const [breakfastMatches, lunchMatches, dinnerMatches, snackMatches] =
      await Promise.all([
        this.findMatchingMeals("breakfast", breakfastTarget, userData, 10),
        this.findMatchingMeals("lunch", lunchTarget, userData, 10),
        this.findMatchingMeals("dinner", dinnerTarget, userData, 10),
        this.findMatchingMeals("snack", snackTarget, userData, 10),
      ]);

    logger.info(
      `[generateWeeklyMealPlan] Found ${breakfastMatches.length} breakfast, ${lunchMatches.length} lunch, ${dinnerMatches.length} dinner, ${snackMatches.length} snack matches`
    );

    // Track which meals have already been used to prevent duplicates
    const usedMealIds = new Set<string>();
    // Track indices for each category to cycle through matches
    const mealIndices = {
      breakfast: 0,
      lunch: 0,
      dinner: 0,
      snack: 0,
    };

    // Helper function to process meal with validation and reuse logic
    const processMealWithReuse = (
      meal: IMeal | undefined,
      category: "breakfast" | "lunch" | "dinner" | "snack"
    ): IMeal | null => {
      if (!meal) return null;

      // Determine target calories and macros based on category
      let targetCal, targetMacros, availableMatches;
      switch (category) {
        case "breakfast":
          targetCal = breakfastTarget;
          targetMacros = breakfastMacros;
          availableMatches = breakfastMatches;
          break;
        case "lunch":
          targetCal = lunchTarget;
          targetMacros = lunchMacros;
          availableMatches = lunchMatches;
          break;
        case "dinner":
          targetCal = dinnerTarget;
          targetMacros = dinnerMacros;
          availableMatches = dinnerMatches;
          break;
        case "snack":
          targetCal = snackTarget;
          targetMacros = snackMacros;
          availableMatches = snackMatches;
          break;
      }

      // Try to reuse a meal from pre-fetched matches
      if (availableMatches && availableMatches.length > 0) {
        // Find next unused meal in the matches
        let reusedMeal: IMeal | null = null;
        let attempts = 0;
        const maxAttempts = availableMatches.length;

        while (
          attempts < maxAttempts &&
          mealIndices[category] < availableMatches.length
        ) {
          const candidate = availableMatches[mealIndices[category]];
          mealIndices[category]++; // Move to next meal for next time

          if (!usedMealIds.has(candidate._id)) {
            reusedMeal = candidate;
            usedMealIds.add(candidate._id);
            logger.debug(
              `[generateWeeklyMealPlan] Reusing meal "${candidate.name}" (ID: ${candidate._id}) for ${category}`
            );
            break;
          }
          attempts++;
        }

        if (reusedMeal) {
          return {
            ...reusedMeal,
            _id: reusedMeal._id,
          };
        }
      }

      // If no matching meal available or all matches used, validate and use AI-generated meal
      const validatedMeal = validateAndCorrectMealMacros(
        meal as any,
        targetCal,
        targetMacros
      );

      const convertedMeal = convertMeal(validatedMeal as IMeal);

      // Track AI-generated meals too to prevent accidental duplicates
      if (convertedMeal) {
        usedMealIds.add(convertedMeal._id);
      }

      return convertedMeal;
    };

    for (const [dateKey, dayData] of weeklyPlanEntries) {
      const day = dayData as IDayPlanWithMetadata;

      // Map workouts with parsed values
      const workouts = (day.workouts || []).map((w: IWorkout) => ({
        name: w.name,
        category: w.category || "cardio",
        duration: parseDuration(w.duration),
        caloriesBurned: parseCalories(w.caloriesBurned),
        time: w.time,
      }));

      // Process meals with reuse and validation (now synchronous since meals are pre-fetched)
      const breakfast = processMealWithReuse(day.meals?.breakfast, "breakfast");
      const lunch = processMealWithReuse(day.meals?.lunch, "lunch");
      const dinner = processMealWithReuse(day.meals?.dinner, "dinner");
      const processedSnacks = (day.meals?.snacks || []).map((snack) =>
        processMealWithReuse(snack, "snack")
      );

      // Preserve day name and formatted date from the transformed plan
      // Note: day.waterIntake already includes base (8 glasses) + workout water from transformWeeklyPlan
      const dayPlan = {
        day: day.day, // e.g., "monday"
        date: day.date, // e.g., "Dec 4"
        meals: {
          breakfast: breakfast,
          lunch: lunch,
          dinner: dinner,
          snacks: processedSnacks.filter(Boolean), // Filter out nulls
        },
        workouts,
        // Use waterIntake from transformed plan (already includes base + workout water, capped at 12)
        // Fallback to 8 if not set (shouldn't happen, but safety check)
        waterIntake: day.waterIntake || 8,
      };

      weeklyPlanObject[dateKey] = dayPlan;

      // Calculate totals for weekly macros from processed meals
      const breakfastMeal = dayPlan.meals.breakfast;
      const lunchMeal = dayPlan.meals.lunch;
      const dinnerMeal = dayPlan.meals.dinner;
      const snacksMeals = dayPlan.meals.snacks || [];

      if (breakfastMeal?.calories) totalCalories += breakfastMeal.calories;
      if (lunchMeal?.calories) totalCalories += lunchMeal.calories;
      if (dinnerMeal?.calories) totalCalories += dinnerMeal.calories;
      snacksMeals.forEach((snack: IMeal) => {
        if (snack?.calories) totalCalories += snack.calories;
      });

      if (breakfastMeal?.macros?.protein)
        totalProtein += breakfastMeal.macros.protein;
      if (lunchMeal?.macros?.protein) totalProtein += lunchMeal.macros.protein;
      if (dinnerMeal?.macros?.protein)
        totalProtein += dinnerMeal.macros.protein;
      snacksMeals.forEach((snack: IMeal) => {
        if (snack?.macros?.protein) totalProtein += snack.macros.protein;
      });

      if (breakfastMeal?.macros?.carbs)
        totalCarbs += breakfastMeal.macros.carbs;
      if (lunchMeal?.macros?.carbs) totalCarbs += lunchMeal.macros.carbs;
      if (dinnerMeal?.macros?.carbs) totalCarbs += dinnerMeal.macros.carbs;
      snacksMeals.forEach((snack: IMeal) => {
        if (snack?.macros?.carbs) totalCarbs += snack.macros.carbs;
      });

      if (breakfastMeal?.macros?.fat) totalFat += breakfastMeal.macros.fat;
      if (lunchMeal?.macros?.fat) totalFat += lunchMeal.macros.fat;
      if (dinnerMeal?.macros?.fat) totalFat += dinnerMeal.macros.fat;
      snacksMeals.forEach((snack: IMeal) => {
        if (snack?.macros?.fat) totalFat += snack.macros.fat;
      });
    }

    // Create new plan
    const plan = new this.planModel({
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
      weeklyPlan: weeklyPlanObject,
      weeklyMacros: {
        calories: { consumed: 0, total: totalCalories },
        protein: { consumed: 0, total: totalProtein },
        carbs: { consumed: 0, total: totalCarbs },
        fat: { consumed: 0, total: totalFat },
      },
      language: generatedLanguage || language,
      generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
    });

    // Delete today's progress if it exists (new plan means fresh start for today)
    const todayForProgress = new Date();
    todayForProgress.setHours(0, 0, 0, 0);
    const todayDateKey = getLocalDateKey(todayForProgress);

    const deletedProgress = await this.progressModel.deleteOne({
      userId: userIdObjectId,
      dateKey: todayDateKey,
    });

    if (deletedProgress.deletedCount > 0) {
      logger.info(
        `[generateWeeklyMealPlan] Deleted today's progress (${todayDateKey}) for user ${userId} - new plan generated`
      );
    }

    // Delete old shopping list for this user (new plan means new shopping list)
    // Find old plan first to get its planId
    const oldPlan = await this.planModel.findOne({ userId: userIdObjectId });
    if (oldPlan) {
      if (!isPlanExpired(oldPlan)) {
        const deletedPlan = await this.planModel.deleteOne({
          userId: userIdObjectId,
        });
        if (deletedPlan.deletedCount > 0) {
          logger.info(
            `[generateWeeklyMealPlan] Deleted old plan for user ${userId} - new plan generated`
          );
        }
      }
      const deletedShoppingList = await this.shoppingListModel.deleteOne({
        userId: userIdObjectId,
        planId: oldPlan._id,
      });
      if (deletedShoppingList.deletedCount > 0) {
        logger.info(
          `[generateWeeklyMealPlan] Deleted old shopping list for user ${userId} - new plan generated`
        );
      }
    }

    await plan.save();

    logger.info(`New weekly meal plan generated and saved for user ${userId}`);

    // Populate the saved plan to return full data
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
    },
    language: string = "en"
  ) {
    if (!mealCriteria.category) {
      throw new BadRequestException("Meal category is required");
    }

    const numberOfSuggestions = mealCriteria.numberOfSuggestions || 3;
    const targetCalories = mealCriteria.targetCalories || 500;

    // Extract meal name from aiRules if it looks like a meal name query
    // aiRules can contain free-text like "chicken salad" or "make me a pasta dish"
    let mealNameFromRules: string | undefined;
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
        logger.info(
          `[generateMealSuggestions] Extracted meal name from aiRules: "${mealNameFromRules}"`
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

    // STEP 1: Query meals from database first (saves AI costs and time)
    logger.info(
      `[generateMealSuggestions] Querying DB for meals matching criteria: category=${mealCriteria.category}, calories=${targetCalories}${mealNameFromRules ? `, name="${mealNameFromRules}"` : ""}`
    );

    const dbMeals = await this.findMatchingMeals(
      mealCriteria.category,
      targetCalories,
      user as IUserData,
      numberOfSuggestions,
      mealNameFromRules // Pass extracted name for free-text search
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

    // STEP 2: Fill remaining slots with AI-generated meals (if needed)
    const remainingSlots = Math.max(
      0,
      numberOfSuggestions - dbMealsFormatted.length
    );
    let aiMeals: IMeal[] = [];

    if (remainingSlots > 0) {
      logger.info(
        `[generateMealSuggestions] Generating ${remainingSlots} meals via AI to fill remaining slots`
      );

      // Generate only the remaining number of meals needed
      const aiCriteria = {
        ...mealCriteria,
        numberOfSuggestions: remainingSlots,
      };

      aiMeals = await aiService.generateMealSuggestions(aiCriteria, language);

      // Save AI-generated meals to database for future reuse
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

    // STEP 3: Combine DB meals and AI meals, prioritizing DB meals
    const allMeals = [...dbMealsFormatted, ...aiMeals].slice(
      0,
      numberOfSuggestions
    );

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

    return {
      success: true,
      message: `Generated ${allMeals.length} meal suggestions (${dbMealsFormatted.length} from DB, ${aiMeals.length} from AI)`,
      data: {
        meals: allMeals,
        criteria: {
          category: mealCriteria.category,
          targetCalories: mealCriteria.targetCalories,
          numberOfSuggestions: numberOfSuggestions,
        },
        source: {
          fromDatabase: dbMealsFormatted.length,
          fromAI: aiMeals.length,
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
