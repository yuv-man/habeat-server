import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { getEffectiveSubscriptionTier, hasFeatureAccess } from "../enums/enumSubscription";
import { FREE_PLAN_LIMIT_MESSAGE, freePlanAllowed } from "./plan-limits";
import { MealLibraryService } from "./meal-library.service";
import { computeActiveSlots } from "./meal-plan-prompt";
import { Plan } from "../plan/plan.model";
import { User } from "../user/user.model";
import { Goal } from "../goals/goal.model";
import { DailyProgress } from "../progress/progress.model";
import { ShoppingList } from "../shopping/shopping-list.model";
import { MoodEntry, IMoodEntry } from "../cbt/cbt.model";
import aiService from "./generate.service";
import { UsdaNutritionService } from "../utils/usda-nutrition.service";
import { ShoppingService } from "../shopping/shopping.service";
import { BrainService } from "../brain/brain.service";
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
import { resolvePlanTargets } from "./generate.service";
import { RepertoireService } from "../repertoire/repertoire.service";
import { balancePlanMacros, planMacroAccuracy } from "./macro-targets";
import { DEFAULT_TUNE_CEILING, tuneCeilingForStage } from "../brain/behavior/behavior.types";
import { applyOwnDishes, balanceAroundOwnDishes } from "./own-dishes";
import { IRepertoireDish } from "../repertoire/repertoire-dish.schema";
import { applyFamiliarWeek } from "./familiar-week";
import { recentMealsToExclude } from "./recent-meals";
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
import {
  resolveDietaryConstraints,
  findMealViolations,
} from "../utils/dietary-constraints";
import { ensureMealPersisted } from "../utils/meal-persistence";
import {} from "./helper"; // helper imports kept for future use
import { CookingLevel } from "../constants/cookingLevel";

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
    @InjectModel(MoodEntry.name) private moodModel: Model<IMoodEntry>,
    private usdaNutritionService: UsdaNutritionService,
    private brainService: BrainService,
    private shoppingService: ShoppingService,
    private repertoireService: RepertoireService,
    private mealLibrary: MealLibraryService
  ) {}

  /** Library meals this user could be served — see meal-library.service.ts. */
  private async librarySupplyFor(userData: IUserData, recentMeals: string[]) {
    try {
      const slots = computeActiveSlots({
        fastingHours: userData.fastingHours,
        fastingStartTime: userData.fastingStartTime,
        mealsPerDay: (userData as any).mealsPerDay,
      });
      return await this.mealLibrary.supplyFor(userData as any, slots, recentMeals);
    } catch (err) {
      // No library means the model writes every meal, as it used to.
      logger.warn(`[MealLibrary] Could not load the library: ${(err as Error)?.message ?? err}`);
      return undefined;
    }
  }

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

    // Hard dietary constraints, applied after scoring.
    //
    // The query above only excluded allergens, so a vegan's candidate list was
    // full of meat — and the preference boost above actively promoted it, since
    // a stored "Sirloin steak" preference scores +10 against a steak dish. Any
    // meal reaching a plan has to survive the same check as generated output.
    const constraints = resolveDietaryConstraints(userData);
    const compliant = scoredMeals.filter(({ meal }) => {
      const matched = findMealViolations(meal, constraints);
      if (matched.length > 0) {
        logger.warn(
          `[findMatchingMeals] Excluding library meal "${meal.name}" — violates ${matched.join(", ")}`
        );
        return false;
      }
      return true;
    });

    // Sort by score and return top matches
    return compliant
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

    // Local-dev: USE_MOCK_MEAL_PLAN=true returns a canned plan without any AI
    // provider. Hard-gated to non-production. Folding it into useMock here means
    // both Phase 1 (today) and the Phase 2 background fill honour it — no AI
    // call is made, so nothing fails on a missing key.
    if (
      process.env.USE_MOCK_MEAL_PLAN === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      useMock = true;
    }

    const userData = await this.userModel.findById(userId).lean().exec();
    if (!userData) {
      throw new NotFoundException("User not found");
    }

    const tier = getEffectiveSubscriptionTier((userData as any).subscriptionTier, (userData as any).role);
    if (!hasFeatureAccess(tier, "unlimitedPlanGeneration")) {
      const current = await this.planModel
        .findOne({ userId: new mongoose.Types.ObjectId(userId) })
        .select("createdAt generationStatus")
        .lean()
        .exec();
      if (!freePlanAllowed(current as any)) {
        throw new ForbiddenException(FREE_PLAN_LIMIT_MESSAGE);
      }
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

    // Fetch mood context from the last 7 days
    const moodContext = await this.buildMoodContext(userId);
    if (moodContext) {
      logger.info(`[generateWeeklyMealPlan] Mood context: ${moodContext}`);
    }

    // The Brain: the single source of behavioural guidance for this plan.
    //
    // This used to call BehaviorService directly, alongside the Brain's own
    // pattern work — two systems reaching the model with separate briefs and
    // nothing arbitrating when they disagreed. The generator now asks one
    // thing; the analyst's findings reach it through BrainState, already
    // reconciled against the active intervention and its stage.
    //
    // Never blocks: a plan still generates when the Brain is cold or the
    // window is too thin to claim anything.
    const [behaviourContext, behaviourMaxPrep, ownDishes, tuneCeiling] = await Promise.all([
      this.brainService.buildPlannerContext(userId).catch(() => null),
      this.brainService.effectiveMaxPrepMinutes(userId).catch(() => null),
      // The dishes this person actually cooks. Never blocks a plan: an empty
      // list just means the week is built the way it always was.
      this.repertoireService.plannableDishes(userId).catch(() => []),
      // How far this user is ready to have their own food changed. Their
      // dishes are never swapped out — they are served as a better version of
      // themselves, and only as far as the Brain's stage supports.
      this.brainService
        .getState(userId)
        .then((state) => tuneCeilingForStage(state?.activeBehavior?.stage))
        .catch(() => DEFAULT_TUNE_CEILING),
    ]);
    const ownDishNames = ownDishes.map((d) => d.name).filter(Boolean);
    // Any dish still without a tuned version gets one in the background, so
    // the next plan can serve a better version of it.
    void this.repertoireService.tunePending(userId).catch(() => undefined);

    if (ownDishNames.length) {
      logger.info(
        `[generateWeeklyMealPlan] Building around ${ownDishNames.length} of the user's own dishes`
      );
    }
    if (behaviourContext) {
      logger.info(
        `[generateWeeklyMealPlan] Brain context applied (${behaviourContext.split("\n").length} directives)`
      );
    }

    // Pre-calculate user metrics (shared by both phases)
    // One resolver for the plan document and for generation. They used to
    // differ: the stored target ignored the user's active goals while the
    // meals were generated with them, so a runner training for a half
    // marathon saw a 2158 kcal goal against ~2800 kcal of food every day.
    const { bmr, tdee, targetCalories, macros } = resolvePlanTargets(
      userData,
      activeGoals,
      planTemplate,
    );
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

    // Read the outgoing plan before it is deleted below, so the new week can be
    // told what the user has just been eating.
    const previousMeals = await this.getRecentMealNames(userIdObjectId);
    if (previousMeals.length) {
      logger.info(`[Phase1] Excluding ${previousMeals.length} meals from the previous plan`);
    }

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
      [today], // datesOverride: only today
      moodContext,
      previousMeals,
      behaviourContext,
      behaviourMaxPrep,
      ownDishNames,
      await this.librarySupplyFor(userData, previousMeals)
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
    // A plan started late in the week would otherwise be a one- or two-day
    // "week" — the first thing a weekend sign-up sees. Next week is added too.
    const followingWeekDates = this.getFollowingWeekDates(today, remainingDates);
    const hasRemainingDays =
      (remainingDates.length > 0 || followingWeekDates.length > 0) && !useMock;

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
    // Phase 3 (short weeks only): next Monday–Sunday, as its own request. It
    // can't share Phase 2's request: days are matched to dates by weekday
    // name, and a nine-day request has two Saturdays.
    if (hasRemainingDays) {
      // Fire-and-forget — do not await, do not block the response
      setImmediate(() => {
        this.generateRestOfPlan(
          userId,
          userIdObjectId,
          userData,
          today,
          remainingDates,
          followingWeekDates,
          language,
          activeGoals,
          planTemplate,
          targetCalories,
          macros,
          moodContext,
          // Only last plan's uneaten dishes. Repeating this week's dishes is
          // fine — the familiar week (familiar-week.ts) does it on purpose.
          previousMeals,
          behaviourContext,
          behaviourMaxPrep,
          ownDishes,
          tuneCeiling
        ).catch(async (err) => {
          logger.error(
            `[Phase2] Background generation failed for user ${userId}: ${err?.message || err}`
          );
          // Today's plan (Phase 1) is already saved and usable, but the rest of
          // the week won't arrive. Flip the status off "generating" so the
          // client stops polling forever and can surface the failure.
          try {
            await this.planModel.updateOne(
              { userId: userIdObjectId },
              { $set: { generationStatus: "failed" } }
            );
          } catch (statusErr: any) {
            logger.error(
              `[Phase2] Could not mark plan failed for user ${userId}: ${statusErr?.message || statusErr}`
            );
          }
        });
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

  /** A first plan shorter than this (today included) also gets next week. */
  static readonly MIN_FIRST_PLAN_DAYS = 3;

  /**
   * Next Monday–Sunday when the rest of this week is too short to be a plan
   * (a Saturday or Sunday sign-up), otherwise nothing.
   */
  private getFollowingWeekDates(today: Date, remainingDates: Date[]): Date[] {
    if (1 + remainingDates.length >= GeneratorService.MIN_FIRST_PLAN_DAYS) return [];
    const monday = new Date(today);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() + remainingDates.length + 1);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }

  /**
   * Phase 2, then Phase 3 when there is one. Sequential, so only the last
   * request marks the plan complete — a client polling on "generating" keeps
   * waiting until every day has arrived — and each phase's familiar-week pass
   * sees every day generated before it.
   */
  private async generateRestOfPlan(
    userId: string,
    userIdObjectId: mongoose.Types.ObjectId,
    userData: IUserData,
    today: Date,
    remainingDates: Date[],
    followingWeekDates: Date[],
    language: string,
    goals: IGoal[],
    planTemplate: string | undefined,
    targetCalories: number,
    macros: { protein: number; carbs: number; fat: number },
    moodContext?: string | null,
    recentMeals: string[] = [],
    behaviourContext?: string | null,
    behaviourMaxPrep?: number | null,
    ownDishes: IRepertoireDish[] = [],
    tuneCeiling: 0 | 1 | 2 | 3 = DEFAULT_TUNE_CEILING
  ): Promise<void> {
    const chunks = [
      { weekStart: today, dates: remainingDates },
      { weekStart: followingWeekDates[0], dates: followingWeekDates },
    ].filter((c) => c.dates.length > 0);

    for (let i = 0; i < chunks.length; i++) {
      await this.generateAndAppendRemainingDays(
        userId,
        userIdObjectId,
        userData,
        chunks[i].weekStart,
        chunks[i].dates,
        language,
        goals,
        planTemplate,
        targetCalories,
        macros,
        moodContext,
        // Next week may repeat this week's dishes: familiarity is the point.
        recentMeals,
        behaviourContext,
        behaviourMaxPrep,
        i === chunks.length - 1,
        ownDishes,
        tuneCeiling
      );
    }
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
   * Dish names from the plan currently on record that the next plan should not
   * repeat — only the ones the user didn't eat at home (see recent-meals.ts).
   * Read from the plan and its days' progress, both of which are deleted
   * partway through generation, so this must be called before that happens.
   */
  private async getRecentMealNames(
    userIdObjectId: mongoose.Types.ObjectId,
    limit = 40
  ): Promise<string[]> {
    const previous = await this.planModel
      .findOne({ userId: userIdObjectId })
      .select("weeklyPlan")
      .lean()
      .exec();

    if (!previous?.weeklyPlan) return [];

    const weeklyPlan = previous.weeklyPlan as Record<string, any>;
    const progressDays = await this.progressModel
      .find({ userId: userIdObjectId, dateKey: { $in: Object.keys(weeklyPlan) } })
      .select("meals")
      .lean()
      .exec();

    return recentMealsToExclude(weeklyPlan, progressDays as any[], limit);
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
    macros: { protein: number; carbs: number; fat: number },
    moodContext?: string | null,
    recentMeals: string[] = [],
    behaviourContext?: string | null,
    behaviourMaxPrep?: number | null,
    /** Only the last background request may mark the plan complete. */
    markComplete = true,
    ownDishes: IRepertoireDish[] = [],
    tuneCeiling: 0 | 1 | 2 | 3 = DEFAULT_TUNE_CEILING
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
      remainingDates, // datesOverride: only remaining days
      moodContext,
      recentMeals,
      behaviourContext,
      behaviourMaxPrep,
      ownDishes.map((d) => d.name).filter(Boolean),
      await this.librarySupplyFor(userData, recentMeals)
    );

    if (!mealPlan?.weeklyPlan || Object.keys(mealPlan.weeklyPlan).length === 0) {
      logger.warn(`[Phase2] AI returned empty plan — remaining days not added.`);
      if (markComplete) await this.markGenerationComplete(userIdObjectId);
      return;
    }

    const { weeklyPlanObject } = await this.processAIPlanDays(
      mealPlan, userData, targetCalories, macros
    );

    if (Object.keys(weeklyPlanObject).length === 0) {
      logger.warn(`[Phase2] processAIPlanDays returned empty object.`);
      if (markComplete) await this.markGenerationComplete(userIdObjectId);
      return;
    }

    // Merge remaining days into the existing plan using dot-notation $set
    const setPayload: Record<string, any> = markComplete ? { generationStatus: "complete" } : {};
    for (const [dateKey, dayPlan] of Object.entries(weeklyPlanObject)) {
      setPayload[`weeklyPlan.${dateKey}`] = dayPlan;
    }

    await this.planModel.findOneAndUpdate(
      { userId: userIdObjectId },
      { $set: setPayload }
    );

    await this.applyOwnDishesToPlan(userIdObjectId, ownDishes, targetCalories, tuneCeiling, macros, [
      ...(userData.allergies ?? []),
      ...(userData.dislikes ?? []),
      ...(userData.dietaryRestrictions ?? []),
    ]);
    await this.applyFamiliarWeekToPlan(userIdObjectId);
    // Last: the week's dishes are settled, so what is left is the mix.
    await this.balanceMacrosInPlan(userIdObjectId, macros, targetCalories);

    logger.info(
      `[Phase2] Added ${Object.keys(weeklyPlanObject).length} days to plan for user ${userId}.` +
        (markComplete ? " Generation complete." : " More to come.")
    );
  }

  /**
   * Repeat on purpose across the whole stored plan: one weekday breakfast, two
   * alternating snacks, dinners that come back as lunch (familiar-week.ts).
   * Runs on the stored plan so anchors from earlier phases count.
   */
  /**
   * Put the user's own dishes into the week (own-dishes.ts). Code places them
   * rather than the model, which drifts off a named dish. Runs on the stored
   * plan after each phase, and before the familiar-week pass so repeats and
   * leftovers can build on a dish the user actually cooks.
   */
  private async applyOwnDishesToPlan(
    userIdObjectId: mongoose.Types.ObjectId,
    dishes: IRepertoireDish[],
    targetCalories: number,
    tuneCeiling: 0 | 1 | 2 | 3,
    macros: { protein: number; carbs: number; fat: number },
    avoid: string[] = []
  ): Promise<void> {
    if (!dishes.length) return;
    const plan = await this.planModel.findOne({ userId: userIdObjectId }).lean().exec();
    if (!plan?.weeklyPlan) return;

    const { weeklyPlan, stats } = applyOwnDishes(
      plan.weeklyPlan as Record<string, any>,
      dishes as any[],
      targetCalories,
      undefined,
      tuneCeiling,
      { calories: targetCalories, ...macros },
      avoid
    );
    if (!stats.placed) return;

    await this.planModel.updateOne({ _id: (plan as any)._id }, { $set: { weeklyPlan } });
    logger.info(
      `[OwnDishes] Placed ${stats.placed} meal(s) the user cooks: ${stats.dishes.join(", ")}` +
        (stats.tuned.length
          ? ` | tuned (max level ${tuneCeiling}): ` +
            stats.tuned.map((t) => `"${t.dish}" L${t.level} — ${t.changes.join("; ")}`).join(" · ")
          : ` | none tuned (ceiling ${tuneCeiling})`)
    );
  }

  /**
   * Put each day's macro mix right (macro-targets.ts). Runs after the dishes
   * are settled: it trades portions between meals, so it must see the week the
   * user will actually get. The accuracy it achieves is stored on the plan.
   */
  private async balanceMacrosInPlan(
    userIdObjectId: mongoose.Types.ObjectId,
    macros: { protein: number; carbs: number; fat: number },
    targetCalories: number
  ): Promise<void> {
    const plan = await this.planModel.findOne({ userId: userIdObjectId }).lean().exec();
    if (!plan?.weeklyPlan) return;

    // Their own dishes come at their own portion; first the rest of each day
    // makes room for them, then the mix is corrected around them.
    const around = balanceAroundOwnDishes(plan.weeklyPlan as Record<string, any>, targetCalories);
    const before = planMacroAccuracy(around.weeklyPlan, macros, targetCalories);
    const { weeklyPlan, nudges } = balancePlanMacros(around.weeklyPlan, macros);
    const after = planMacroAccuracy(weeklyPlan, macros, targetCalories);

    await this.planModel.updateOne(
      { _id: (plan as any)._id },
      { $set: { weeklyPlan, macroAccuracy: after } }
    );

    const pct = (a: typeof after) =>
      `P${Math.round(a.protein * 100)}% C${Math.round(a.carbs * 100)}% F${Math.round(a.fat * 100)}% kcal${Math.round(a.calories * 100)}%`;
    logger.info(
      `[Macros] ${around.days} day(s) rebalanced around own dishes; ${nudges.length} portion trade(s); average error ${pct(before)} → ${pct(after)}`
    );
  }

  private async applyFamiliarWeekToPlan(userIdObjectId: mongoose.Types.ObjectId): Promise<void> {
    const plan = await this.planModel.findOne({ userId: userIdObjectId }).lean().exec();
    if (!plan?.weeklyPlan) return;
    const { weeklyPlan, stats } = applyFamiliarWeek(plan.weeklyPlan as Record<string, any>);
    if (!stats.breakfastRepeats && !stats.snackRepeats && !stats.leftoverLunches) return;
    await this.planModel.updateOne({ _id: (plan as any)._id }, { $set: { weeklyPlan } });
    logger.info(
      `[FamiliarWeek] ${stats.breakfastRepeats} breakfast repeats, ${stats.snackRepeats} snack repeats, ${stats.leftoverLunches} leftover lunches`
    );
  }

  private async markGenerationComplete(userIdObjectId: mongoose.Types.ObjectId): Promise<void> {
    await this.planModel.updateOne(
      { userId: userIdObjectId },
      { $set: { generationStatus: "complete" } }
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
        nameEn: meal.nameEn || meal.name,
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

    /**
     * Turn one generated meal into its stored form.
     *
     * This used to prefer a meal from the shared `meals` collection whenever one
     * matched the slot and calorie band, and only fell back to the generated
     * meal if the collection had nothing. That silently discarded the entire
     * generation: a vegan user was served "Sirloin Steak And Broccoli Scramble"
     * — a row created weeks earlier, ranked to the top because `findMatchingMeals`
     * scores +10 for a `foodPreferences` hit and never filtered on
     * `dietaryRestrictions`. It also made every plan identical, because the
     * candidate list is sorted deterministically from a fixed pool.
     *
     * The generated meal is the product, so it now always wins. The library is
     * consulted only when generation produced nothing for the slot.
     */
    const processMeal = (
      meal: IMeal | undefined,
      category: "breakfast" | "lunch" | "dinner" | "snack"
    ): IMeal | null => {
      let availableMatches: IMeal[];

      switch (category) {
        case "breakfast": availableMatches = breakfastMatches; break;
        case "lunch":     availableMatches = lunchMatches;    break;
        case "dinner":    availableMatches = dinnerMatches;   break;
        case "snack":     availableMatches = snackMatches;    break;
      }

      if (meal?.name) {
        // Reconcile calories with macros only — portions were already fitted to
        // the slot targets when the plan was generated (calorie-balance.ts).
        const validated = validateAndCorrectMealMacros(meal as any);
        const converted = convertMeal(validated as IMeal);
        if (converted) {
          usedMealIds.add(converted._id);
          return converted;
        }
      }

      // Nothing generated for this slot — fall back to the library rather than
      // leaving a hole in the day.
      let attempts = 0;
      while (attempts < availableMatches.length && mealIndices[category] < availableMatches.length) {
        const candidate = availableMatches[mealIndices[category]++];
        if (!usedMealIds.has(candidate._id)) {
          usedMealIds.add(candidate._id);
          logger.warn(
            `[processAIPlanDays] No generated ${category}; falling back to library meal "${candidate.name}".`
          );
          return { ...candidate, _id: candidate._id };
        }
        attempts++;
      }

      return null;
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

      // Give every meal a row in `meals` so its id resolves elsewhere —
      // favourites and recipe lookup both dereference meal ids against that
      // collection, and a plan-only meal is invisible to them. Deduplicated on
      // content, and done in parallel per day to keep the write cost off the
      // critical path.
      const [breakfast, lunch, dinner, ...processedSnacks] = await Promise.all(
        [
          processMeal(day.meals?.breakfast, "breakfast"),
          processMeal(day.meals?.lunch, "lunch"),
          processMeal(day.meals?.dinner, "dinner"),
          ...(day.meals?.snacks || []).map((s) => processMeal(s, "snack")),
        ].map(async (meal) =>
          meal ? await ensureMealPersisted(this.mealModel, meal) : null,
        ),
      );

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
      cookingLevel?: CookingLevel;
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
      // A swapped-in meal has to be as cookable as the one it replaces.
      mealCriteria.cookingLevel =
        mealCriteria.cookingLevel ?? (user as any).cookingLevel;
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
      // Drop food preferences: the user's explicit search term is the only signal that matters here.
      // Injecting likes (e.g. Sirloin Steak, Broccoli) into a "fresh fruits" request produces nonsense.
      const aiCriteria = {
        ...mealCriteria,
        preferences: [],
        numberOfSuggestions,
        aiRules: `Generate ${numberOfSuggestions} different ${mealCriteria.category} variations of "${mealNameFromRules}". Each variation should be unique (e.g., different cooking methods, seasonings, sides, or preparations) but all based on "${mealNameFromRules}". Examples: "Grilled ${mealNameFromRules}", "Pan-Seared ${mealNameFromRules}", "${mealNameFromRules} with Herbs", etc.`,
      };

      const aiMeals = (await aiService.generateMealSuggestions(aiCriteria, language)).map((meal) => ({
        ...meal,
        category: mealCriteria.category,
      }));

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
          preferences: [],
          numberOfSuggestions: needed,
          aiRules: `Generate ${needed} different ${mealCriteria.category} variations of "${mealNameFromRules}". Each variation MUST include "${mealNameFromRules}" in the name. Examples: "Grilled ${mealNameFromRules}", "Pan-Seared ${mealNameFromRules}", "${mealNameFromRules} with Herbs".`,
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

      const aiMeals = (await aiService.generateMealSuggestions(aiCriteria, language)).map((meal) => ({
        ...meal,
        category: mealCriteria.category,
      }));

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

        aiMeals = (await aiService.generateMealSuggestions(aiCriteria, language)).map((meal) => ({
          ...meal,
          category: mealCriteria.category,
        }));

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

    // 10. Rebuild the shopping list. Without this the plan and the day's
    // progress moved on but the list still asked the user to buy ingredients
    // for a meal that is no longer anywhere in their week.
    await this.shoppingService.syncFromPlan(plan._id as mongoose.Types.ObjectId);

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

  // Build a short mood context string from the last 7 days of mood entries.
  // Returns null when there is no mood data.
  private async buildMoodContext(userId: string): Promise<string | null> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const sinceKey = since.toISOString().split("T")[0];

      const entries = await this.moodModel
        .find({ userId: new mongoose.Types.ObjectId(userId), date: { $gte: sinceKey } })
        .lean()
        .exec();

      if (!entries.length) return null;

      // Average mood and stress levels
      const avgMood = entries.reduce((s, e) => s + e.moodLevel, 0) / entries.length;
      const stressEntries = entries.filter((e) => e.stressLevel != null);
      const avgStress = stressEntries.length
        ? stressEntries.reduce((s, e) => s + (e.stressLevel ?? 0), 0) / stressEntries.length
        : null;

      // Dominant mood category
      const categoryCounts: Record<string, number> = {};
      for (const e of entries) {
        categoryCounts[e.moodCategory] = (categoryCounts[e.moodCategory] || 0) + 1;
      }
      const dominantCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0];

      // Build context sentence
      const moodDesc = avgMood >= 4 ? "generally positive" : avgMood >= 3 ? "mixed" : "low";
      let context = `The user's mood over the past week has been ${moodDesc} (avg ${avgMood.toFixed(1)}/5, dominant state: ${dominantCategory}).`;

      // Specific dietary guidance per mood state
      const guidance: Record<string, string> = {
        stressed:  "Prioritise magnesium-rich foods (leafy greens, nuts, seeds) and complex carbohydrates to support serotonin. Avoid heavy caffeine.",
        anxious:   "Include calming, anti-inflammatory foods: omega-3 rich fish, walnuts, chamomile. Limit sugar spikes and caffeine.",
        sad:       "Include mood-boosting foods: oily fish (omega-3), dark chocolate, fermented foods (probiotics), vitamin-D rich foods.",
        angry:     "Include calming anti-inflammatory ingredients: turmeric, omega-3, magnesium. Avoid high-sugar or processed meals.",
        tired:     "Prioritise iron-rich foods, B-vitamins, and complex carbs for sustained energy. Avoid heavy, slow-digesting meals.",
        happy:     "Maintain the positive state with balanced, nutritious meals. Good time to introduce new healthy ingredients.",
        calm:      "Maintain balance with varied, nutritious meals. Lean proteins and whole grains work well.",
        energetic: "Support high energy with adequate complex carbs and lean proteins. Keep meals light and well-balanced.",
        neutral:   "",
      };

      const dietNote = guidance[dominantCategory] ?? "";
      if (dietNote) context += ` ${dietNote}`;

      if (avgStress !== null && avgStress >= 4) {
        context += " Stress levels have been high — include stress-reducing snacks like nuts, seeds, and herbal teas.";
      }

      return context;
    } catch (err) {
      logger.warn(`[buildMoodContext] Failed to fetch mood data: ${err}`);
      return null;
    }
  }
}
