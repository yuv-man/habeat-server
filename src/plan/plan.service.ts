import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Plan } from "./plan.model";
import { ShoppingList, IShoppingList } from "../shopping/shopping-list.model";
import { User } from "../user/user.model";
import { Meal } from "../meal/meal.model";
import { DailyProgress } from "../progress/progress.model";
import aiService from "../generator/generate.service";
import logger from "../utils/logger";
import {
  organizeIngredients,
  processMealForIngredients,
  formatProgressStats,
  parsePrepTime,
  parseDuration,
  parseCalories,
  calculateWorkoutWaterGlasses,
  getValidObjectId,
  convertAIIngredientsToMealFormat,
  MealIngredient,
} from "../utils/helpers";
import {
  IDayPlan,
  IDailyPlan,
  IWeeklyPlanObject,
  IDayPlanWithMetadata,
  IMeal,
  IUserData,
  IPlan,
  IDailyProgress,
  IWorkout,
  IIngredient,
} from "../types/interfaces";
import { ProgressService } from "../progress/progress.service";
import { GeneratorService } from "../generator/generator.service";
import mongoose from "mongoose";
import crypto from "crypto";
import {
  calculateTDEE,
  calculateBMR,
  calculateTargetCalories,
  calculateIdealWeight,
  calculateMacros,
} from "../utils/healthCalculations";
import { PATH_WATER_INTAKE, PATH_WORKOUTS_GOAL } from "../enums/enumPaths";

@Injectable()
export class PlanService {
  constructor(
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    @InjectModel(ShoppingList.name)
    private shoppingListModel: Model<IShoppingList>,
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(Meal.name) private mealModel: Model<IMeal>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>,
    private progressService: ProgressService,
    private generatorService: GeneratorService
  ) {}

  // ============================================================================
  // REUSABLE MEAL LOOKUP AND GENERATION FUNCTIONS
  // ============================================================================

  /**
   * Find a meal by name in the database
   * @param mealName - The name of the meal to find
   * @param category - Optional category to filter by
   * @returns The meal if found, null otherwise
   */
  async findMealByName(
    mealName: string,
    category?: "breakfast" | "lunch" | "dinner" | "snack"
  ): Promise<IMeal | null> {
    if (!mealName) return null;

    const query: any = {
      name: { $regex: new RegExp(`^${mealName}$`, "i") },
    };

    if (category) {
      query.category = category;
    }

    const meal = await this.mealModel.findOne(query).lean().exec();

    if (meal) {
      logger.info(`[findMealByName] Found existing meal: ${mealName}`);
      return meal as IMeal;
    }

    return null;
  }

  /**
   * Get a meal from DB or generate via AI if not found
   * This is the main function for meal swapping - check DB first, generate if needed
   * @param mealName - Name of the meal to get/generate
   * @param category - Meal category
   * @param userId - User ID for getting dietary restrictions
   * @param targetCalories - Target calories for the meal (optional, used for generation)
   * @param language - Language for generation
   * @returns The meal data ready to use in plan/progress
   */
  async getOrGenerateMeal(
    mealName: string,
    category: "breakfast" | "lunch" | "dinner" | "snack",
    userId: string,
    targetCalories?: number,
    language: string = "en",
    aiRules?: string
  ): Promise<IMeal> {
    // Step 1: Check if meal exists in database
    const existingMeal = await this.findMealByName(mealName, category);

    if (existingMeal) {
      logger.info(
        `[getOrGenerateMeal] Using existing meal from DB: ${mealName}`
      );
      // Update usage count
      await this.mealModel.findByIdAndUpdate(existingMeal._id, {
        $inc: { "analytics.timesGenerated": 1 },
      });

      return {
        _id: existingMeal._id.toString(),
        name: existingMeal.name,
        calories: existingMeal.calories,
        macros: existingMeal.macros || { protein: 0, carbs: 0, fat: 0 },
        category: existingMeal.category,
        prepTime: parsePrepTime(existingMeal.prepTime),
        ingredients: existingMeal.ingredients || [],
      };
    }

    // Step 2: Meal not found - generate via AI
    logger.info(
      `[getOrGenerateMeal] Meal not found in DB, generating via AI: ${mealName}`
    );

    // Get user dietary restrictions
    const user = await this.userModel.findById(userId).lean().exec();
    const dietaryRestrictions = (user as any)?.dietaryRestrictions || [];
    const preferences = (user as any)?.foodPreferences || [];
    const dislikes = (user as any)?.dislikes || [];

    // Generate meal using AI
    const generatedMeal = await aiService.generateMeal(
      mealName,
      targetCalories || this.getDefaultCaloriesForCategory(category),
      category,
      dietaryRestrictions,
      preferences,
      dislikes,
      language,
      aiRules
    );

    // Convert AI ingredients to meal format
    const mealIngredients = convertAIIngredientsToMealFormat(
      generatedMeal.ingredients || []
    );

    // Step 3: Save the generated meal to database
    const mealSignature = this.calculateMealSignature({
      ...generatedMeal,
      category,
      ingredients: mealIngredients,
    });

    const newMeal = await this.mealModel.create({
      name: generatedMeal.name || mealName,
      calories: generatedMeal.calories || targetCalories || 400,
      macros: generatedMeal.macros || { protein: 20, carbs: 40, fat: 15 },
      category: category,
      prepTime: parsePrepTime(generatedMeal.prepTime),
      ingredients: mealIngredients,
      aiGenerated: true,
      analytics: {
        timesGenerated: 1,
        signature: mealSignature,
      },
    });

    logger.info(`[getOrGenerateMeal] Saved new AI-generated meal: ${mealName}`);

    return {
      _id: newMeal._id.toString(),
      name: newMeal.name,
      calories: newMeal.calories,
      macros: newMeal.macros,
      category: newMeal.category as any,
      prepTime: parsePrepTime(newMeal.prepTime),
      ingredients: newMeal.ingredients as MealIngredient[],
    };
  }

  /**
   * Get default calories for a meal category
   */
  private getDefaultCaloriesForCategory(
    category: "breakfast" | "lunch" | "dinner" | "snack"
  ): number {
    const defaults: Record<string, number> = {
      breakfast: 400,
      lunch: 600,
      dinner: 600,
      snack: 200,
    };
    return defaults[category] || 500;
  }

  /**
   * Update shopping list after meal swap
   * Removes old meal ingredients and adds new meal ingredients
   */
  async updateShoppingListAfterSwap(
    userId: string,
    planId: mongoose.Types.ObjectId,
    oldMeal: IMeal | null,
    newMeal: IMeal
  ): Promise<void> {
    try {
      const plan = await this.planModel.findById(planId);
      if (!plan) return;

      // Use existing sync method which handles the full shopping list
      await this.syncShoppingListWithPlan(
        userId,
        planId,
        plan.weeklyPlan as { [date: string]: IDayPlan }
      );

      logger.info(
        `[updateShoppingListAfterSwap] Shopping list updated after meal swap`
      );
    } catch (error) {
      logger.error(`[updateShoppingListAfterSwap] Error:`, error);
      // Don't throw - shopping list update failure shouldn't break meal swap
    }
  }

  /**
   * Update daily macros after meal swap
   * Adjusts consumed/goal values based on old vs new meal
   */
  async updateDailyMacrosAfterSwap(
    userId: string,
    dateKey: string,
    oldMeal: any,
    newMeal: IMeal,
    wasMealDone: boolean
  ): Promise<void> {
    const progress = await this.progressModel.findOne({
      userId,
      dateKey,
    });

    if (!progress) return;

    // NOTE: We do NOT modify caloriesGoal or macro goals when meals change.
    // The target is based on the user's nutritional needs (BMR, TDEE, path)
    // and should remain fixed. Only consumed values should change.

    // If old meal was completed, subtract its values from consumed
    if (wasMealDone && oldMeal) {
      (progress as any).caloriesConsumed = Math.round(
        ((progress as any).caloriesConsumed || 0) - (oldMeal.calories || 0)
      );
      if ((progress as any).protein) {
        (progress as any).protein.consumed = Math.round(
          ((progress as any).protein.consumed || 0) -
            (oldMeal.macros?.protein || 0)
        );
      }
      if ((progress as any).carbs) {
        (progress as any).carbs.consumed = Math.round(
          ((progress as any).carbs.consumed || 0) - (oldMeal.macros?.carbs || 0)
        );
      }
      if ((progress as any).fat) {
        (progress as any).fat.consumed = Math.round(
          ((progress as any).fat.consumed || 0) - (oldMeal.macros?.fat || 0)
        );
      }
    }

    await progress.save();
    logger.info(
      `[updateDailyMacrosAfterSwap] Updated consumed values for ${dateKey} after meal swap`
    );
  }

  // ============================================================================
  // END REUSABLE MEAL FUNCTIONS
  // ============================================================================

  // Helper to get the last Monday (start of current week)
  private getLastMonday(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(today.setDate(diff));
    return monday;
  }

  // Helper to get local date key in YYYY-MM-DD format (avoids timezone issues with toISOString which uses UTC)
  private getLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Helper to calculate meal signature for deduplication
  private calculateMealSignature(meal: any): string {
    const ingredientsStr = Array.isArray(meal.ingredients)
      ? meal.ingredients
          .map((ing: any) => (Array.isArray(ing) ? ing[0] : ing))
          .sort()
          .join("_")
      : "";
    const key = `${meal.category}_${meal.calories}_${meal.macros?.protein || 0}_${ingredientsStr}`;
    return crypto.createHash("md5").update(key).digest("hex");
  }

  // Helper to create or find a meal in the database (prevents duplicates)
  private async ensureMealInDB(mealData: any): Promise<any> {
    if (!mealData || !mealData.name) return null;

    // Calculate signature for deduplication
    const signature = this.calculateMealSignature(mealData);

    // Look for existing similar meal by signature or by name+category+calories
    const existingMeal = await this.mealModel
      .findOne({
        $or: [
          { "analytics.signature": signature },
          {
            name: { $regex: new RegExp(`^${mealData.name}$`, "i") },
            category: mealData.category,
            calories: {
              $gte: (mealData.calories || 0) - 50,
              $lte: (mealData.calories || 0) + 50,
            },
          },
        ],
      })
      .lean()
      .exec();

    if (existingMeal) {
      // Update analytics
      await this.mealModel.findByIdAndUpdate(existingMeal._id, {
        $inc: { "analytics.timesGenerated": 1 },
      });
      return {
        _id: existingMeal._id,
        name: existingMeal.name,
        calories: existingMeal.calories,
        macros: existingMeal.macros,
        category: existingMeal.category,
        prepTime:
          parsePrepTime(existingMeal.prepTime) ||
          parsePrepTime(mealData.prepTime),
        ingredients: existingMeal.ingredients || mealData.ingredients,
        done: false,
      };
    }

    // Create new meal
    const newMeal = await this.mealModel.create({
      name: mealData.name,
      calories: mealData.calories || 0,
      macros: mealData.macros || { protein: 0, carbs: 0, fat: 0 },
      category: mealData.category || "dinner",
      prepTime: parsePrepTime(mealData.prepTime),
      ingredients: mealData.ingredients || [],
      aiGenerated: true,
      analytics: {
        timesGenerated: 1,
        signature: signature,
      },
    });

    return {
      _id: newMeal._id,
      name: newMeal.name,
      calories: newMeal.calories,
      macros: newMeal.macros,
      category: newMeal.category,
      prepTime: parsePrepTime(newMeal.prepTime),
      ingredients: newMeal.ingredients,
      done: false,
    };
  }

  // Helper to process all meals in a day plan and ensure they're in DB
  private async processMealsForDayPlan(dayPlan: any): Promise<any> {
    const breakfast = await this.ensureMealInDB(
      dayPlan?.meals?.breakfast
        ? { ...dayPlan.meals.breakfast, category: "breakfast" }
        : null
    );
    const lunch = await this.ensureMealInDB(
      dayPlan?.meals?.lunch
        ? { ...dayPlan.meals.lunch, category: "lunch" }
        : null
    );
    const dinner = await this.ensureMealInDB(
      dayPlan?.meals?.dinner
        ? { ...dayPlan.meals.dinner, category: "dinner" }
        : null
    );

    const snacks = await Promise.all(
      (dayPlan?.meals?.snacks || []).map((snack: any) =>
        this.ensureMealInDB({ ...snack, category: "snack" })
      )
    );

    return {
      breakfast,
      lunch,
      dinner,
      snacks: snacks.filter(Boolean),
    };
  }

  // Helper to collect all ingredients from a plan's weeklyPlan
  private collectIngredientsFromPlan(weeklyPlan: {
    [date: string]: IDayPlan;
  }): ([string, string] | [string, string, string?])[] {
    const allIngredients: ([string, string] | [string, string, string?])[] = [];

    for (const dayPlan of Object.values(weeklyPlan)) {
      const meals = [
        dayPlan.meals.breakfast,
        dayPlan.meals.lunch,
        dayPlan.meals.dinner,
        ...(dayPlan.meals.snacks || []),
      ];

      for (const meal of meals) {
        if (meal && meal.ingredients && Array.isArray(meal.ingredients)) {
          meal.ingredients.forEach(
            (ing: [string, string] | [string, string, string?] | string) => {
              if (Array.isArray(ing)) {
                // Already in tuple format [name, amount] or [name, amount, category]
                allIngredients.push(ing);
              } else if (typeof ing === "string") {
                // Legacy string format - convert to tuple without category
                allIngredients.push([ing, ""]);
              }
            }
          );
        }
      }
    }

    return allIngredients;
  }

  // Helper to normalize ingredient name for key generation
  private normalizeIngredientKey(ingredientName: string): string {
    return ingredientName
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }

  // Helper to sync shopping list with plan ingredients
  private async syncShoppingListWithPlan(
    userId: string,
    planId: mongoose.Types.ObjectId,
    weeklyPlan: { [date: string]: IDayPlan }
  ): Promise<void> {
    try {
      // Collect all ingredients from the plan
      const allIngredients = this.collectIngredientsFromPlan(weeklyPlan);

      // Parse amount string like "200 g" into { value: 200, unit: "g" }
      const parseAmount = (
        amountStr: string
      ): { value: number; unit: string } | null => {
        if (!amountStr) return null;
        const match = amountStr.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
        if (match) {
          return {
            value: parseFloat(match[1]),
            unit: match[2].trim().toLowerCase(),
          };
        }
        return null;
      };

      // Aggregate ingredients by name (sum amounts for same ingredient)
      const ingredientMap = new Map<
        string,
        {
          name: string;
          amounts: Map<string, number>;
          category?: string;
        }
      >();

      allIngredients.forEach((ing) => {
        const ingredientName = Array.isArray(ing) ? ing[0] : String(ing);
        const ingredientAmount = Array.isArray(ing) ? ing[1] : "";
        const ingredientCategory =
          Array.isArray(ing) && ing.length > 2 ? ing[2] : undefined;
        const key = this.normalizeIngredientKey(ingredientName);

        const parsed = parseAmount(ingredientAmount);

        if (ingredientMap.has(key)) {
          const existing = ingredientMap.get(key)!;
          if (parsed) {
            const currentAmount = existing.amounts.get(parsed.unit) || 0;
            existing.amounts.set(parsed.unit, currentAmount + parsed.value);
          }
          if (!existing.category && ingredientCategory) {
            existing.category = ingredientCategory;
          }
        } else {
          const amounts = new Map<string, number>();
          if (parsed) {
            amounts.set(parsed.unit, parsed.value);
          }
          ingredientMap.set(key, {
            name: ingredientName,
            amounts,
            category: ingredientCategory,
          });
        }
      });

      // Helper to format amounts map back to string
      const formatAmounts = (amounts: Map<string, number>): string => {
        const parts: string[] = [];
        amounts.forEach((value, unit) => {
          const formattedValue =
            value % 1 === 0 ? value.toString() : value.toFixed(1);
          parts.push(unit ? `${formattedValue} ${unit}` : formattedValue);
        });
        return parts.join(" + ") || "";
      };

      // Get existing shopping list to preserve done status
      const existingShoppingList = await this.shoppingListModel.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        planId: planId,
      });

      // Create a map of existing done statuses by key
      const existingDoneStatus = new Map<string, boolean>();
      if (existingShoppingList?.ingredients) {
        existingShoppingList.ingredients.forEach((ing) => {
          existingDoneStatus.set(ing.key, ing.done);
        });
      }

      // Create new ingredients list preserving done status
      const newIngredients = Array.from(ingredientMap.entries()).map(
        ([key, ing]) => ({
          name: ing.name,
          amount: formatAmounts(ing.amounts),
          category: ing.category,
          done: existingDoneStatus.get(key) || false,
          key: key,
        })
      );

      // Update or create shopping list
      if (existingShoppingList) {
        existingShoppingList.ingredients = newIngredients;
        await existingShoppingList.save();
      } else {
        await this.shoppingListModel.create({
          userId: new mongoose.Types.ObjectId(userId),
          planId: planId,
          ingredients: newIngredients,
        });
      }
    } catch (error) {
      logger.error("Error syncing shopping list with plan:", error);
      // Don't throw - shopping list sync failure shouldn't break plan operations
    }
  }

  // Helper to convert day name or date string to date key (YYYY-MM-DD)
  private getDateKey(dayOrDate: string, plan?: any): string {
    // If it's already a date string (YYYY-MM-DD), return it
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayOrDate)) {
      return dayOrDate;
    }

    // If it's a day name, calculate the date based on plan's generatedAt or current week
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const dayIndex = dayNames.indexOf(dayOrDate.toLowerCase());

    if (dayIndex === -1) {
      throw new BadRequestException(`Invalid day: ${dayOrDate}`);
    }

    // Use plan's generatedAt as reference, or current date
    const referenceDate = plan?.generatedAt
      ? new Date(plan.generatedAt)
      : new Date();
    const currentDay = referenceDate.getDay();
    const daysToAdd = dayIndex - currentDay;
    const targetDate = new Date(referenceDate);
    targetDate.setDate(referenceDate.getDate() + daysToAdd);

    return targetDate.toISOString().split("T")[0];
  }

  async createInitialPlan(
    userId: string,
    userData: IUserData,
    language: string
  ) {
    const plan = await this.createInitialPlanFunction(
      userId,
      userData,
      language
    );
    return {
      success: true,
      data: { plan },
    };
  }

  async createInitialPlanFunction(
    userId: string,
    userData: IUserData,
    language: string
  ) {
    const title = "My First Plan";
    const bmr = calculateBMR(
      userData.weight,
      userData.height,
      userData.age,
      userData.gender
    );
    const tdee = calculateTDEE(bmr);
    const targetCalories = calculateTargetCalories(tdee, userData.path);
    const idealWeight = calculateIdealWeight(userData.height, userData.gender);
    const macros = calculateMacros(targetCalories, userData.path);

    const userMetrics = {
      bmr,
      tdee,
      targetCalories,
      idealWeight: idealWeight.ideal,
      weightRange: `${idealWeight.min} - ${idealWeight.max}`,
      waterIntake:
        PATH_WATER_INTAKE[userData.path as keyof typeof PATH_WATER_INTAKE],
      workoutsGoal:
        PATH_WORKOUTS_GOAL[userData.path as keyof typeof PATH_WORKOUTS_GOAL],
    };

    // Extract only the fields that the plan model expects in userData
    // Ensure all required fields have values
    const planUserData = {
      age: userData.age || 25,
      gender: userData.gender || "male",
      height: userData.height || 170,
      weight: userData.weight || 70,
      path: userData.path || "healthy",
      workoutFrequency:
        userData.workoutFrequency ??
        PATH_WORKOUTS_GOAL[userData.path as keyof typeof PATH_WORKOUTS_GOAL] ??
        3,
      targetWeight: userData.targetWeight,
      allergies: userData.allergies || [],
      dietaryRestrictions: userData.dietaryRestrictions || [],
      foodPreferences: userData.foodPreferences || [],
      dislikes: userData.dislikes || [],
      fastingHours: userData.fastingHours,
      fastingStartTime: userData.fastingStartTime,
    };

    // Convert userId to ObjectId if it's a string
    // Ensure userId is valid, otherwise throw an error
    if (!userId || userId === "null" || userId === "undefined") {
      throw new BadRequestException("userId is required to create a plan");
    }

    let userIdObjectId: mongoose.Types.ObjectId;
    try {
      if (mongoose.Types.ObjectId.isValid(userId)) {
        userIdObjectId = new mongoose.Types.ObjectId(userId);
      } else {
        throw new BadRequestException(`Invalid userId format: ${userId}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to convert userId to ObjectId: ${userId}`
      );
    }

    // Delete existing plan if it exists (since userId is unique)
    // This prevents duplicate key errors
    await this.planModel.findOneAndDelete({ userId: userIdObjectId });

    const plan = await this.planModel.create({
      userId: userIdObjectId,
      title,
      userData: planUserData,
      language,
      userMetrics,
      dailyMacros: macros,
    });

    return plan;
  }

  async getCurrentWeeklyPlan(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = this.getLocalDateKey(today); // Use local date, not UTC
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    logger.info(
      `[getCurrentWeeklyPlan] Today is: ${todayKey} (day: ${currentDay}, ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][currentDay]})`
    );

    let plan = await this.planModel.findOne({ userId });

    // Check if plan exists and has data for TODAY
    if (plan) {
      const weeklyPlan = (plan as any).weeklyPlan || {};
      const planDates = Object.keys(weeklyPlan).sort();
      logger.info(
        `[getCurrentWeeklyPlan] Existing plan dates: ${planDates.join(", ")}`
      );

      const hasTodayPlan = weeklyPlan[todayKey] !== undefined;
      logger.info(
        `[getCurrentWeeklyPlan] Has today (${todayKey}) in plan: ${hasTodayPlan}`
      );

      if (hasTodayPlan) {
        return {
          success: true,
          data: plan,
        };
      }

      logger.info(`[getCurrentWeeklyPlan] Plan is outdated, regenerating...`);
    } else {
      logger.info(
        `[getCurrentWeeklyPlan] No existing plan, generating new one...`
      );
    }

    // If no plan or no current week data, generate a new plan
    const userData: IUserData = {
      email: (user as any).email || "",
      password: "",
      name: (user as any).name || "",
      age: (user as any).age || 30,
      gender: (user as any).gender || "male",
      height: (user as any).height || 175,
      weight: (user as any).weight || 70,
      workoutFrequency: (user as any).workoutFrequency || 3,
      path: (user as any).path || "healthy",
      allergies: (user as any).allergies || [],
      dietaryRestrictions: (user as any).dietaryRestrictions || [],
      foodPreferences: (user as any).foodPreferences || [],
      preferences: (user as any).preferences || {},
    };

    // Use GeneratorService to generate the plan starting from today
    await this.generatorService.generateWeeklyMealPlan(
      userId,
      today,
      (user as any).language || "en",
      "My Meal Plan",
      false
    );

    // Fetch the newly created plan
    plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Failed to generate plan");
    }

    const newPlanDates = Object.keys((plan as any).weeklyPlan || {}).sort();
    logger.info(
      `[getCurrentWeeklyPlan] NEW plan generated with dates: ${newPlanDates.join(", ")}`
    );

    return {
      success: true,
      data: plan,
    };
  }

  async getPlanByUserId(userId: string) {
    const plan = await this.planModel.findOne({ userId }).lean();
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }
    return {
      success: true,
      data: plan,
    };
  }

  async updatePlan(planId: string, updateData: any) {
    const plan = await this.planModel
      .findByIdAndUpdate(planId, updateData, { new: true })
      .lean();
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }
    return {
      success: true,
      data: plan,
    };
  }

  async deletePlan(planId: string) {
    const plan = await this.planModel.findByIdAndDelete(planId);
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }
    return {
      success: true,
      message: "Plan deleted successfully",
    };
  }

  async replaceMeal(
    userId: string,
    planId: string,
    date: string,
    mealType: string,
    newMeal: Partial<IMeal> & { name: string; calories?: number },
    snackIndex?: number,
    language: string = "en",
    aiRules?: string
  ) {
    const plan = await this.planModel.findById(planId);
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(date, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    // Validate meal type
    const validMealTypes = ["breakfast", "lunch", "dinner", "snack", "snacks"];
    if (!validMealTypes.includes(mealType)) {
      throw new BadRequestException(
        `Invalid mealType: ${mealType}. Must be breakfast, lunch, dinner, or snack`
      );
    }

    // Normalize meal type
    const normalizedMealType =
      mealType === "snacks" ? "snack" : (mealType as any);

    // ============================================================================
    // STEP 1: Check if meal exists in DB, if not generate via AI
    // ============================================================================
    let resolvedMeal: IMeal;

    // Check if the newMeal already has complete data (from client)
    const hasCompleteData =
      newMeal.calories &&
      newMeal.macros?.protein !== undefined &&
      newMeal.ingredients?.length;

    if (hasCompleteData) {
      // Client provided complete meal data - check if it exists in DB to get ID
      const existingMeal = await this.findMealByName(
        newMeal.name,
        normalizedMealType
      );

      if (existingMeal) {
        logger.info(`[replaceMeal] Found existing meal in DB: ${newMeal.name}`);
        // Use existing meal but allow overrides from request
        resolvedMeal = {
          _id: existingMeal._id.toString(),
          name: newMeal.name || existingMeal.name,
          calories: newMeal.calories || existingMeal.calories,
          macros: newMeal.macros || existingMeal.macros,
          category: normalizedMealType,
          prepTime: parsePrepTime(newMeal.prepTime || existingMeal.prepTime),
          ingredients: (newMeal.ingredients ||
            existingMeal.ingredients) as MealIngredient[],
        };

        // Update usage count
        await this.mealModel.findByIdAndUpdate(existingMeal._id, {
          $inc: { "analytics.timesGenerated": 1 },
        });
      } else {
        // Save the new meal to DB for future use
        logger.info(
          `[replaceMeal] New meal provided, saving to DB: ${newMeal.name}`
        );
        const mealSignature = this.calculateMealSignature({
          ...newMeal,
          category: normalizedMealType,
        });

        const savedMeal = await this.mealModel.create({
          name: newMeal.name,
          calories: newMeal.calories,
          macros: newMeal.macros,
          category: normalizedMealType,
          prepTime: parsePrepTime(newMeal.prepTime),
          ingredients: newMeal.ingredients,
          aiGenerated: false,
          analytics: {
            timesGenerated: 1,
            signature: mealSignature,
          },
        });

        resolvedMeal = {
          _id: savedMeal._id.toString(),
          name: savedMeal.name,
          calories: savedMeal.calories,
          macros: savedMeal.macros,
          category: normalizedMealType,
          prepTime: parsePrepTime(savedMeal.prepTime),
          ingredients: savedMeal.ingredients as MealIngredient[],
        };
      }
    } else {
      // Incomplete data - use getOrGenerateMeal to check DB or generate via AI
      logger.info(
        `[replaceMeal] Incomplete meal data, using getOrGenerateMeal: ${newMeal.name}`
      );
      resolvedMeal = await this.getOrGenerateMeal(
        newMeal.name,
        normalizedMealType,
        userId,
        newMeal.calories,
        language,
        aiRules
      );
    }

    // ============================================================================
    // STEP 2: Prepare meal data and get old meal
    // ============================================================================
    const mealData = {
      _id: getValidObjectId(resolvedMeal._id),
      name: resolvedMeal.name,
      calories: Math.round(resolvedMeal.calories || 0),
      macros: {
        protein: Math.round(resolvedMeal.macros?.protein || 0),
        carbs: Math.round(resolvedMeal.macros?.carbs || 0),
        fat: Math.round(resolvedMeal.macros?.fat || 0),
      },
      category: normalizedMealType,
      ingredients: resolvedMeal.ingredients || [],
      prepTime: parsePrepTime(resolvedMeal.prepTime) || 30,
    };

    let oldMeal: any = null;

    // ============================================================================
    // STEP 3: Replace the meal in the plan
    // ============================================================================
    if (mealType === "snack" || mealType === "snacks") {
      if (snackIndex === undefined || snackIndex < 0) {
        throw new BadRequestException(
          "snackIndex is required when replacing a snack"
        );
      }
      if (!dayPlan.meals.snacks || snackIndex >= dayPlan.meals.snacks.length) {
        throw new NotFoundException(
          `Snack at index ${snackIndex} not found in plan`
        );
      }
      oldMeal = dayPlan.meals.snacks[snackIndex];
      dayPlan.meals.snacks[snackIndex] = mealData;
    } else {
      oldMeal = dayPlan.meals[mealType as "breakfast" | "lunch" | "dinner"];
      dayPlan.meals[mealType as "breakfast" | "lunch" | "dinner"] = mealData;
    }

    // ============================================================================
    // STEP 4: Update daily macros in plan
    // ============================================================================
    const calorieDiff = (mealData.calories || 0) - (oldMeal?.calories || 0);
    const proteinDiff =
      (mealData.macros?.protein || 0) - (oldMeal?.macros?.protein || 0);
    const carbsDiff =
      (mealData.macros?.carbs || 0) - (oldMeal?.macros?.carbs || 0);
    const fatDiff = (mealData.macros?.fat || 0) - (oldMeal?.macros?.fat || 0);

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

    // Mark weeklyPlan as modified so Mongoose saves the nested changes
    plan.markModified("weeklyPlan");
    await plan.save();
    logger.info(`[replaceMeal] Plan saved with updated meal for ${dateKey}`);

    // ============================================================================
    // STEP 5: Update progress (if this is for the target date)
    // ============================================================================
    const progress = await this.progressModel.findOne({
      userId,
      dateKey,
    });

    if (progress) {
      const progressMeals = (progress as any).meals || {};
      let progressOldMeal: any = null;
      let wasDone = false;

      if (mealType === "snack" || mealType === "snacks") {
        if (
          progressMeals.snacks &&
          snackIndex !== undefined &&
          snackIndex < progressMeals.snacks.length
        ) {
          progressOldMeal = progressMeals.snacks[snackIndex];
          wasDone = progressOldMeal?.done || false;
          progressMeals.snacks[snackIndex] = {
            ...mealData,
            done: false,
          };
        }
      } else {
        progressOldMeal = progressMeals[mealType];
        wasDone = progressOldMeal?.done || false;
        progressMeals[mealType] = {
          ...mealData,
          done: false,
        };
      }

      // NOTE: We do NOT modify caloriesGoal or macro goals when meals change.
      // The target is based on the user's nutritional needs (BMR, TDEE, path)
      // and should remain fixed. Only consumed values should change.

      // If old meal was completed, subtract its values from consumed
      if (wasDone && progressOldMeal) {
        (progress as any).caloriesConsumed = Math.round(
          ((progress as any).caloriesConsumed || 0) -
            (progressOldMeal.calories || 0)
        );
        if ((progress as any).protein) {
          (progress as any).protein.consumed = Math.round(
            ((progress as any).protein.consumed || 0) -
              (progressOldMeal.macros?.protein || 0)
          );
        }
        if ((progress as any).carbs) {
          (progress as any).carbs.consumed = Math.round(
            ((progress as any).carbs.consumed || 0) -
              (progressOldMeal.macros?.carbs || 0)
          );
        }
        if ((progress as any).fat) {
          (progress as any).fat.consumed = Math.round(
            ((progress as any).fat.consumed || 0) -
              (progressOldMeal.macros?.fat || 0)
          );
        }
      }

      // Mark meals as modified and save progress
      progress.markModified("meals");
      await progress.save();
      logger.info(
        `[replaceMeal] Progress saved with updated meal for ${dateKey}`
      );
    }

    // ============================================================================
    // STEP 6: Update shopping list
    // ============================================================================
    await this.updateShoppingListAfterSwap(
      userId,
      plan._id as mongoose.Types.ObjectId,
      oldMeal,
      resolvedMeal
    );

    logger.info(
      `[replaceMeal] Successfully replaced ${mealType} on ${dateKey}: ` +
        `${oldMeal?.name || "none"} -> ${resolvedMeal.name}`
    );

    return {
      success: true,
      data: {
        plan,
        replacedMeal: {
          old: oldMeal,
          new: mealData,
        },
        dateKey,
        mealType,
        snackIndex,
        mealSource: hasCompleteData ? "provided" : "generated",
      },
    };
  }

  async updateWaterIntake(userId: string, day: string, glasses: number) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    dayPlan.waterIntake = glasses;
    await plan.save();

    return {
      success: true,
      data: {
        plan,
        dayPlan,
      },
    };
  }

  async updateWorkoutInPlan(
    userId: string,
    day: string,
    workoutIndex: number,
    workoutData: Partial<IWorkout>
  ) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    if (!dayPlan.workouts || !dayPlan.workouts[workoutIndex]) {
      throw new NotFoundException("Workout not found at index");
    }

    const oldWorkout = { ...dayPlan.workouts[workoutIndex] };
    const oldCalories = oldWorkout.caloriesBurned || 0;

    // Parse numeric values if they're strings
    if (workoutData.duration !== undefined) {
      workoutData.duration = parseDuration(workoutData.duration);
    }
    if (workoutData.caloriesBurned !== undefined) {
      workoutData.caloriesBurned = parseCalories(workoutData.caloriesBurned);
    }

    const newCalories = workoutData.caloriesBurned ?? oldCalories;
    const caloriesDiff = newCalories - oldCalories;

    // Get old and new time for water calculation
    const oldTime = oldWorkout.time;
    const newTime = workoutData.time ?? oldTime;

    // Calculate water difference based on calories AND time change
    const oldWaterGlasses = calculateWorkoutWaterGlasses(oldCalories, oldTime);
    const newWaterGlasses = calculateWorkoutWaterGlasses(newCalories, newTime);
    const waterDiff = newWaterGlasses - oldWaterGlasses;

    Object.assign(dayPlan.workouts[workoutIndex], workoutData);

    // Update day plan water intake if calories changed
    if (waterDiff !== 0) {
      dayPlan.waterIntake = Math.max(8, (dayPlan.waterIntake || 8) + waterDiff);
    }

    await plan.save();

    // If the workout is for today, also update progress
    const todayKey = this.getLocalDateKey(new Date());
    if (dateKey === todayKey) {
      const progress = await this.progressModel.findOne({
        userId,
        dateKey: todayKey,
      });

      if (progress) {
        const progressWorkout = (progress as any).workouts?.find(
          (w: any) => w.name === oldWorkout.name
        );

        if (progressWorkout) {
          // Update the workout in progress
          Object.assign(progressWorkout, {
            name: workoutData.name || progressWorkout.name,
            category: workoutData.category || progressWorkout.category,
            duration:
              workoutData.duration !== undefined
                ? workoutData.duration
                : progressWorkout.duration,
            caloriesBurned:
              workoutData.caloriesBurned !== undefined
                ? workoutData.caloriesBurned
                : progressWorkout.caloriesBurned,
            time:
              workoutData.time !== undefined
                ? workoutData.time
                : progressWorkout.time,
          });

          // Adjust calories goal if calories changed
          if (caloriesDiff !== 0) {
            (progress as any).caloriesGoal = Math.max(
              0,
              (progress as any).caloriesGoal + caloriesDiff
            );
          }

          // Adjust water goal if water needs changed
          if (waterDiff !== 0) {
            (progress as any).water.goal = Math.max(
              8,
              (progress as any).water.goal + waterDiff
            );
          }

          await progress.save();
          logger.info(
            `[updateWorkoutInPlan] Updated workout in progress. ` +
              `Calories goal ${caloriesDiff >= 0 ? "+" : ""}${caloriesDiff}, ` +
              `Water goal ${waterDiff >= 0 ? "+" : ""}${waterDiff} glasses`
          );
        }
      }
    }

    return {
      success: true,
      data: {
        plan,
        workout: dayPlan.workouts[workoutIndex],
        adjustments: {
          caloriesGoalChange: caloriesDiff,
          waterGoalChange: waterDiff,
        },
      },
    };
  }

  async addWorkout(
    userId: string,
    day: string,
    name: string,
    category: string = "cardio",
    duration: number,
    caloriesBurned: number,
    time?: string
  ) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = plan.weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    if (!dayPlan.workouts) {
      dayPlan.workouts = [];
    }

    // Parse numeric values in case they're strings
    const parsedDuration = parseDuration(duration);
    const parsedCaloriesBurned = parseCalories(caloriesBurned);

    const workout: IWorkout = {
      name,
      category: category || "cardio",
      duration: parsedDuration,
      caloriesBurned: parsedCaloriesBurned,
      time: time || undefined,
    };

    dayPlan.workouts.push(workout);

    // Calculate extra water needed based on workout calories and time
    const extraWaterGlasses = calculateWorkoutWaterGlasses(
      parsedCaloriesBurned,
      time
    );

    // Update day plan water intake goal
    dayPlan.waterIntake = (dayPlan.waterIntake || 8) + extraWaterGlasses;

    // Mark weeklyPlan as modified so Mongoose saves the nested changes
    plan.markModified("weeklyPlan");
    await plan.save();

    // If the workout is for today, also add to progress
    const todayKey = this.getLocalDateKey(new Date());
    if (dateKey === todayKey) {
      const progress = await this.progressModel.findOne({
        userId,
        dateKey: todayKey,
      });

      if (progress) {
        if (!(progress as any).workouts) {
          (progress as any).workouts = [];
        }
        (progress as any).workouts.push({
          name: workout.name,
          category: workout.category,
          duration: workout.duration,
          caloriesBurned: workout.caloriesBurned,
          time: workout.time,
          done: false,
        });

        // Add workout calories to daily calorie goal (you need to eat more to compensate)
        (progress as any).caloriesGoal += parsedCaloriesBurned;

        // Add extra water to goal
        (progress as any).water.goal += extraWaterGlasses;

        await progress.save();
        logger.info(
          `[addWorkout] Added workout to today's progress. ` +
            `Calories goal +${parsedCaloriesBurned}, Water goal +${extraWaterGlasses} glasses`
        );
      }
    }

    return {
      success: true,
      data: {
        plan,
        workout,
        adjustments: {
          extraCaloriesGoal: parsedCaloriesBurned,
          extraWaterGlasses: extraWaterGlasses,
        },
      },
    };
  }

  async addSnack(planId: string, date: string, snackName: string) {
    const plan = await this.planModel.findById(planId);
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const user = await this.userModel.findById(plan.userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const dietaryRestrictions = user.dietaryRestrictions || [];
    const language = user.language || "en";

    const dateKey = this.getDateKey(date, plan);
    const weeklyPlan = plan.weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    if (!dayPlan.meals.snacks) {
      dayPlan.meals.snacks = [];
    }

    const snackData = await aiService.generateSnack(
      snackName,
      dietaryRestrictions,
      language
    );

    const snack: IMeal = {
      _id: new mongoose.Types.ObjectId().toString(),
      name: snackName,
      category: "snack",
      calories: snackData.calories,
      macros: {
        protein: snackData.macros?.protein || 0,
        carbs: snackData.macros?.carbs || 0,
        fat: snackData.macros?.fat || 0,
      },
      ingredients: snackData.ingredients || [],
      prepTime: 0,
    };

    dayPlan.meals.snacks.push(snack);

    const todayKey = this.getLocalDateKey(new Date());
    if (dateKey === todayKey) {
      const progress = await this.progressModel.findOne({
        userId: plan.userId,
        dateKey: todayKey,
      });
      if (progress) {
        (progress as any).meals.snacks.push(snack);
        await progress.save();
      }
    }

    // Mark weeklyPlan as modified so Mongoose saves the nested changes
    plan.markModified("weeklyPlan");
    await plan.save();

    // Sync shopping list with updated plan
    await this.syncShoppingListWithPlan(
      plan.userId.toString(),
      plan._id as mongoose.Types.ObjectId,
      weeklyPlan
    );

    return {
      success: true,
      data: {
        plan,
        snack,
      },
    };
  }

  async deleteSnack(userId: string, day: string, snackIndex: number) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = plan.weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    if (!dayPlan.meals.snacks || !Array.isArray(dayPlan.meals.snacks)) {
      throw new NotFoundException("No snacks found for this day");
    }

    if (snackIndex < 0 || snackIndex >= dayPlan.meals.snacks.length) {
      throw new NotFoundException(
        `Snack not found at index ${snackIndex}. Available indices: 0-${dayPlan.meals.snacks.length - 1}`
      );
    }

    dayPlan.meals.snacks.splice(snackIndex, 1);

    // Mark weeklyPlan as modified so Mongoose saves the nested changes
    plan.markModified("weeklyPlan");
    await plan.save();

    // Sync shopping list with updated plan
    await this.syncShoppingListWithPlan(
      userId,
      plan._id as mongoose.Types.ObjectId,
      weeklyPlan
    );

    return {
      success: true,
      message: "Snack deleted successfully",
      data: {
        plan,
      },
    };
  }

  async deleteWorkout(userId: string, day: string, workoutName: string) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = plan.weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    if (!dayPlan.workouts || !Array.isArray(dayPlan.workouts)) {
      throw new NotFoundException("No workouts found for this day");
    }

    const workout = dayPlan.workouts.find((w: any) => w.name === workoutName);
    if (!workout) {
      throw new NotFoundException(`Workout ${workoutName} not found`);
    }

    const workoutCalories = workout.caloriesBurned || 0;
    const workoutTime = workout.time;

    // Calculate water that was added for this workout (based on calories and time)
    const waterGlassesToRemove = calculateWorkoutWaterGlasses(
      workoutCalories,
      workoutTime
    );

    dayPlan.workouts.splice(dayPlan.workouts.indexOf(workout), 1);

    // Subtract water from day plan (don't go below 8 glasses minimum)
    dayPlan.waterIntake = Math.max(
      8,
      (dayPlan.waterIntake || 8) - waterGlassesToRemove
    );

    // Mark weeklyPlan as modified so Mongoose saves the nested changes
    plan.markModified("weeklyPlan");
    await plan.save();

    // If the workout is for today, also remove from progress
    const todayKey = this.getLocalDateKey(new Date());
    if (dateKey === todayKey) {
      const progress = await this.progressModel.findOne({
        userId,
        dateKey: todayKey,
      });

      if (progress && (progress as any).workouts) {
        const progressWorkoutIndex = (progress as any).workouts.findIndex(
          (w: any) => w.name === workoutName
        );

        if (progressWorkoutIndex !== -1) {
          const progressWorkout = (progress as any).workouts[
            progressWorkoutIndex
          ];

          // If the workout was completed, adjust calories consumed
          if (progressWorkout.done) {
            const caloriesBurned = progressWorkout.caloriesBurned || 0;
            (progress as any).caloriesConsumed += caloriesBurned; // Add back the burned calories
          }

          // Subtract workout calories from daily goal
          (progress as any).caloriesGoal = Math.max(
            0,
            (progress as any).caloriesGoal - workoutCalories
          );

          // Subtract water from goal (don't go below 8)
          (progress as any).water.goal = Math.max(
            8,
            (progress as any).water.goal - waterGlassesToRemove
          );

          (progress as any).workouts.splice(progressWorkoutIndex, 1);
          await progress.save();
          logger.info(
            `[deleteWorkout] Removed workout from progress. ` +
              `Calories goal -${workoutCalories}, Water goal -${waterGlassesToRemove} glasses`
          );
        }
      }
    }

    return {
      success: true,
      message: "Workout deleted successfully",
      data: {
        plan,
      },
    };
  }

  async getDayPlan(userId: string, day: string) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    return {
      success: true,
      data: dayPlan,
    };
  }

  async trackMealConsumption(
    userId: string,
    day: string,
    mealType: string,
    consumed: boolean,
    snackIndex?: number
  ) {
    // This method should not modify the plan - tracking is done in progress
    // But keeping for backward compatibility, it will just return the plan
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    // Note: Tracking is done in progress service, not in plan
    return {
      success: true,
      data: {
        plan,
        dayPlan,
      },
    };
  }

  async updateMealInPlan(
    userId: string,
    day: string,
    mealType: string,
    mealData: Partial<IMeal>,
    snackIndex?: number
  ) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    // Ensure ingredients are in tuple format
    if (mealData.ingredients) {
      mealData.ingredients = mealData.ingredients as [
        string,
        string,
        string?,
      ][];
    }

    if (mealType === "snack" || mealType === "snacks") {
      if (snackIndex === undefined) {
        throw new BadRequestException("snackIndex is required for snacks");
      }
      if (!dayPlan.meals.snacks || !dayPlan.meals.snacks[snackIndex]) {
        throw new NotFoundException("Snack not found at index");
      }
      Object.assign(dayPlan.meals.snacks[snackIndex], mealData);
    } else {
      Object.assign(
        dayPlan.meals[mealType as "breakfast" | "lunch" | "dinner"],
        mealData
      );
    }

    await plan.save();

    // Sync shopping list with updated plan
    await this.syncShoppingListWithPlan(
      userId,
      plan._id as mongoose.Types.ObjectId,
      weeklyPlan
    );

    return {
      success: true,
      data: {
        plan,
        dayPlan,
      },
    };
  }

  async updateMeal(
    userId: string,
    day: string,
    mealType: string,
    mealData: Partial<IMeal>
  ) {
    return this.updateMealInPlan(userId, day, mealType, mealData);
  }

  async updateMacrosInPlan(
    userId: string,
    day: string,
    macrosData: {
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
    }
  ) {
    const plan = await this.planModel.findOne({ userId });
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    const dateKey = this.getDateKey(day, plan);
    const weeklyPlan = (plan as any).weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];

    if (!dayPlan) {
      throw new NotFoundException("Day not found in plan");
    }

    // Update weekly macros (consumed values)
    if (macrosData.calories !== undefined) {
      (plan as any).weeklyMacros.calories.consumed += macrosData.calories;
    }
    if (macrosData.protein !== undefined) {
      (plan as any).weeklyMacros.protein.consumed += macrosData.protein;
    }
    if (macrosData.carbs !== undefined) {
      (plan as any).weeklyMacros.carbs.consumed += macrosData.carbs;
    }
    if (macrosData.fat !== undefined) {
      (plan as any).weeklyMacros.fat.consumed += macrosData.fat;
    }

    await plan.save();

    return {
      success: true,
      data: {
        plan,
        weeklyMacros: (plan as any).weeklyMacros,
      },
    };
  }
}
