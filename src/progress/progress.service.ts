import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { DailyProgress } from "./progress.model";
import { Plan } from "../plan/plan.model";
import { Meal } from "../meal/meal.model";
import logger from "../utils/logger";
import {
  formatProgressStats,
  parsePrepTime,
  parseDuration,
  parseCalories,
} from "../utils/helpers";
import {
  IPlan,
  IDailyProgress,
  IDailyPlan,
  IDayPlan,
  IMeal,
} from "../types/interfaces";
import crypto from "crypto";

@Injectable()
export class ProgressService {
  constructor(
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>,
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    @InjectModel(Meal.name) private mealModel: Model<IMeal>
  ) {}

  // Helper to get local date key in YYYY-MM-DD format (avoids timezone issues with toISOString which uses UTC)
  private getLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Helper to create or find a meal in the database (prevents duplicates)
  private async ensureMealInDB(mealData: any): Promise<any> {
    if (!mealData || !mealData.name) return null;

    // Calculate signature for deduplication
    const signature = this.calculateMealSignature(mealData);

    // Look for existing similar meal
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
        done: mealData.done || false,
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
      done: mealData.done || false,
    };
  }

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

  // Helper to process meals and ensure they're in DB
  private async processMealsForProgress(dayPlan: any): Promise<any> {
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

  async getTodayProgress(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use dateKey (YYYY-MM-DD) for timezone-safe querying
    const todayDateKey = this.getLocalDateKey(today);

    let progress = await this.progressModel
      .findOne<IDailyProgress>({
        userId,
        dateKey: todayDateKey, // Query by dateKey instead of date range
      })
      .populate("meals.breakfast meals.lunch meals.dinner meals.snacks");

    const plan = await this.planModel.findOne({ userId });
    const weeklyPlan = (plan as any)?.weeklyPlan || {};
    const dayPlan = weeklyPlan[todayDateKey];

    if (!progress) {
      // Create new progress with meals from plan - ensure meals are saved to DB
      const dailyMacros = plan?.userMetrics?.dailyMacros;
      const meals = await this.processMealsForProgress(dayPlan);

      progress = await this.progressModel.create({
        userId,
        planId: plan?._id,
        date: today,
        dateKey: todayDateKey, // Store dateKey for timezone-safe querying
        caloriesConsumed: 0,
        caloriesGoal: Math.round(plan?.userMetrics?.tdee || 2000),
        water: {
          consumed: 0,
          goal: dayPlan?.waterIntake || 8,
        },
        meals: meals,
        workouts:
          dayPlan?.workouts?.map((w: any) => ({
            name: w.name,
            duration: parseDuration(w.duration),
            category: w.category,
            caloriesBurned: parseCalories(w.caloriesBurned),
            time: w.time,
            done: false,
          })) || [],
        protein: { consumed: 0, goal: Math.round(dailyMacros?.protein || 0) },
        carbs: { consumed: 0, goal: Math.round(dailyMacros?.carbs || 0) },
        fat: { consumed: 0, goal: Math.round(dailyMacros?.fat || 0) },
      });
    } else {
      // Progress exists - sync water goal from plan
      const progressDoc = progress as any;
      const planWaterIntake = dayPlan?.waterIntake || 8;
      
      // Always sync water goal from plan (plan is source of truth)
      if (progressDoc.water?.goal !== planWaterIntake) {
        progressDoc.water = {
          ...progressDoc.water,
          goal: planWaterIntake,
        };
        await progressDoc.save();
        logger.info(
          `[getTodayProgress] Synced water goal from plan: ${planWaterIntake} glasses`
        );
      }

      // Check if meals are null - populate from plan if so
      const needsUpdate =
        !progressDoc.meals?.breakfast &&
        !progressDoc.meals?.lunch &&
        !progressDoc.meals?.dinner &&
        dayPlan?.meals;

      if (needsUpdate) {
        // Ensure meals are saved to DB
        const meals = await this.processMealsForProgress(dayPlan);

        const updatedProgress = await this.progressModel.findByIdAndUpdate(
          progressDoc._id,
          {
            $set: {
              "meals.breakfast": meals.breakfast,
              "meals.lunch": meals.lunch,
              "meals.dinner": meals.dinner,
              "meals.snacks": meals.snacks,
              workouts:
                dayPlan?.workouts?.map((w: any) => ({
                  name: w.name,
                  duration: parseDuration(w.duration),
                  category: w.category,
                  caloriesBurned: parseCalories(w.caloriesBurned),
                  time: w.time,
                  done: false,
                })) ||
                progressDoc.workouts ||
                [],
            },
          },
          { new: true }
        );
        if (updatedProgress) {
          progress = updatedProgress as unknown as IDailyProgress;
        }
      }
    }

    return {
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        message:
          (progress as unknown as IDailyProgress).caloriesConsumed === 0
            ? "Day started! Complete meals from your plan to track calories."
            : `Current progress: ${(progress as unknown as IDailyProgress).caloriesConsumed}/${(progress as unknown as IDailyProgress).caloriesGoal} calories`,
      },
    };
  }

  async getProgressByDate(userId: string, date: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const dateKey = this.getLocalDateKey(targetDate);

    const progress = await this.progressModel
      .findOne({
        userId,
        dateKey, // Use dateKey for timezone-safe querying
      })
      .populate("meals.breakfast meals.lunch meals.dinner meals.snacks");

    if (!progress) {
      throw new NotFoundException("Progress not found for this date");
    }

    // Sync water goal from plan
    const plan = await this.planModel.findOne({ userId });
    const weeklyPlan = (plan as any)?.weeklyPlan || {};
    const dayPlan = weeklyPlan[dateKey];
    const planWaterIntake = dayPlan?.waterIntake || 8;

    const progressDoc = progress as any;
    if (progressDoc.water?.goal !== planWaterIntake) {
      progressDoc.water = {
        ...progressDoc.water,
        goal: planWaterIntake,
      };
      await progressDoc.save();
      logger.info(
        `[getProgressByDate] Synced water goal from plan: ${planWaterIntake} glasses for date ${dateKey}`
      );
    }

    return {
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
      },
    };
  }

  async getProgressByDateRange(
    userId: string,
    startDate: string,
    endDate: string
  ) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const progressList = await this.progressModel
      .find({
        userId,
        date: {
          $gte: start,
          $lte: end,
        },
      })
      .populate("meals.breakfast meals.lunch meals.dinner meals.snacks")
      .lean()
      .sort({ date: 1 });

    return {
      success: true,
      data: progressList.map((p) => ({
        progress: p,
        stats: formatProgressStats(p),
      })),
    };
  }

  async markMealCompleted(
    userId: string,
    mealId: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snacks"
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateKey = this.getLocalDateKey(today);

    let progress = await this.progressModel.findOne({
      userId,
      dateKey: todayDateKey,
    });

    if (!progress) {
      throw new NotFoundException("Progress not found for today");
    }

    let meal: any = null;
    if (mealType === "snacks") {
      meal = (progress as any).meals.snacks.find(
        (m: any) => m._id.toString() === mealId
      );
    } else {
      meal = (progress as any).meals[mealType];
    }

    if (!meal) {
      throw new NotFoundException("Meal not found");
    }

    // Toggle done status
    const wasDone = meal.done;
    meal.done = !wasDone;

    const calories = Math.round(meal.calories || 0);
    const protein = Math.round(meal.macros?.protein || 0);
    const carbs = Math.round(meal.macros?.carbs || 0);
    const fat = Math.round(meal.macros?.fat || 0);

    if (meal.done) {
      // Add to consumed
      (progress as any).caloriesConsumed += calories;
      (progress as any).protein.consumed += protein;
      (progress as any).carbs.consumed += carbs;
      (progress as any).fat.consumed += fat;
    } else {
      // Subtract from consumed (don't go below 0)
      (progress as any).caloriesConsumed = Math.max(
        0,
        (progress as any).caloriesConsumed - calories
      );
      (progress as any).protein.consumed = Math.max(
        0,
        (progress as any).protein.consumed - protein
      );
      (progress as any).carbs.consumed = Math.max(
        0,
        (progress as any).carbs.consumed - carbs
      );
      (progress as any).fat.consumed = Math.max(
        0,
        (progress as any).fat.consumed - fat
      );
    }

    await progress.save();

    // Update plan's weekly macros
    const plan = await this.planModel.findOne({ userId });
    if (plan && (plan as any).weeklyMacros) {
      if (meal.done) {
        (plan as any).weeklyMacros.calories.consumed += calories;
        (plan as any).weeklyMacros.protein.consumed += protein;
        (plan as any).weeklyMacros.carbs.consumed += carbs;
        (plan as any).weeklyMacros.fat.consumed += fat;
      } else {
        (plan as any).weeklyMacros.calories.consumed = Math.max(
          0,
          (plan as any).weeklyMacros.calories.consumed - calories
        );
        (plan as any).weeklyMacros.protein.consumed = Math.max(
          0,
          (plan as any).weeklyMacros.protein.consumed - protein
        );
        (plan as any).weeklyMacros.carbs.consumed = Math.max(
          0,
          (plan as any).weeklyMacros.carbs.consumed - carbs
        );
        (plan as any).weeklyMacros.fat.consumed = Math.max(
          0,
          (plan as any).weeklyMacros.fat.consumed - fat
        );
      }
      await plan.save();
    }

    return {
      success: true,
      data: {
        progress,
        message: meal.done
          ? `${mealType} marked as completed`
          : `${mealType} marked as incomplete`,
      },
    };
  }

  async addWaterGlass(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateKey = this.getLocalDateKey(today);

    let progress = await this.progressModel.findOne({
      userId,
      dateKey: todayDateKey,
    });

    if (!progress) {
      const plan = await this.planModel.findOne({ userId });
      const dailyMacros = plan?.userMetrics?.dailyMacros;
      progress = await this.progressModel.create({
        userId,
        planId: plan?._id || null,
        date: today,
        dateKey: todayDateKey,
        caloriesConsumed: 0,
        caloriesGoal: Math.round(plan?.userMetrics?.tdee || 2000),
        water: { consumed: 0, goal: 8 },
        meals: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        workouts: [],
        protein: { consumed: 0, goal: Math.round(dailyMacros?.protein || 0) },
        carbs: { consumed: 0, goal: Math.round(dailyMacros?.carbs || 0) },
        fat: { consumed: 0, goal: Math.round(dailyMacros?.fat || 0) },
      });
    }

    (progress as any).water.consumed += 1;
    await progress.save();

    return {
      success: true,
      data: {
        progress,
        message: "Water glass added",
      },
    };
  }

  async markWorkoutCompleted(
    userId: string,
    name: string,
    duration: number,
    caloriesBurned: number,
    category: string
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateKey = this.getLocalDateKey(today);

    let progress = await this.progressModel.findOne({
      userId,
      dateKey: todayDateKey,
    });

    if (!progress) {
      throw new NotFoundException("Progress not found for today");
    }

    const workout = (progress as any).workouts.find(
      (w: any) => w.name === name
    );

    if (!workout) {
      throw new NotFoundException("Workout not found");
    }

    // Toggle done status
    const wasDone = workout.done;
    workout.done = !wasDone;

    const caloriesBurnedValue = Math.round(workout.caloriesBurned || 0);
    if (workout.done) {
      (progress as any).caloriesConsumed = Math.max(
        0,
        (progress as any).caloriesConsumed - caloriesBurnedValue
      );
    } else {
      (progress as any).caloriesConsumed += caloriesBurnedValue;
    }

    await progress.save();

    // Update plan's weekly macros (workouts affect calories consumed)
    const plan = await this.planModel.findOne({ userId });
    if (plan && (plan as any).weeklyMacros) {
      if (workout.done) {
        // Workout completed - subtract burned calories from consumed (net effect)
        (plan as any).weeklyMacros.calories.consumed = Math.max(
          0,
          (plan as any).weeklyMacros.calories.consumed - caloriesBurnedValue
        );
      } else {
        // Workout uncompleted - add back the burned calories
        (plan as any).weeklyMacros.calories.consumed += caloriesBurnedValue;
      }
      await plan.save();
    }

    return {
      success: true,
      data: {
        progress,
        message: workout.done
          ? "Workout marked as completed"
          : "Workout marked as incomplete",
      },
    };
  }

  async addCustomCalories(
    userId: string,
    calories: number,
    mealName: string,
    macros?: { protein?: number; carbs?: number; fat?: number }
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateKey = this.getLocalDateKey(today);

    let progress = await this.progressModel.findOne({
      userId,
      dateKey: todayDateKey,
    });

    if (!progress) {
      const plan = await this.planModel.findOne({ userId });
      const dailyMacros = plan?.userMetrics?.dailyMacros;
      progress = await this.progressModel.create({
        userId,
        planId: plan?._id || null,
        date: today,
        dateKey: todayDateKey,
        caloriesConsumed: 0,
        caloriesGoal: Math.round(plan?.userMetrics?.tdee || 2000),
        water: { consumed: 0, goal: 8 },
        meals: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        workouts: [],
        protein: { consumed: 0, goal: Math.round(dailyMacros?.protein || 0) },
        carbs: { consumed: 0, goal: Math.round(dailyMacros?.carbs || 0) },
        fat: { consumed: 0, goal: Math.round(dailyMacros?.fat || 0) },
      });
    }

    (progress as any).caloriesConsumed += Math.round(calories);
    if (macros) {
      (progress as any).protein.consumed += Math.round(macros.protein || 0);
      (progress as any).carbs.consumed += Math.round(macros.carbs || 0);
      (progress as any).fat.consumed += Math.round(macros.fat || 0);
    }
    await progress.save();

    // Update plan's weekly macros
    const plan = await this.planModel.findOne({ userId });
    if (plan && (plan as any).weeklyMacros) {
      (plan as any).weeklyMacros.calories.consumed += Math.round(calories);
      if (macros) {
        (plan as any).weeklyMacros.protein.consumed += macros.protein || 0;
        (plan as any).weeklyMacros.carbs.consumed += macros.carbs || 0;
        (plan as any).weeklyMacros.fat.consumed += macros.fat || 0;
      }
      await plan.save();
    }

    return {
      success: true,
      data: {
        progress,
        message: `Added ${calories} calories from ${mealName}`,
      },
    };
  }

  async updateWaterIntake(userId: string, glasses: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateKey = this.getLocalDateKey(today);

    let progress = await this.progressModel.findOne({
      userId,
      dateKey: todayDateKey,
    });

    if (!progress) {
      const plan = await this.planModel.findOne({ userId });
      const dailyMacros = plan?.userMetrics?.dailyMacros;
      progress = await this.progressModel.create({
        userId,
        planId: plan?._id || null,
        date: today,
        dateKey: todayDateKey,
        caloriesConsumed: 0,
        caloriesGoal: Math.round(plan?.userMetrics?.tdee || 2000),
        water: { consumed: 0, goal: 8 },
        meals: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        workouts: [],
        protein: { consumed: 0, goal: Math.round(dailyMacros?.protein || 0) },
        carbs: { consumed: 0, goal: Math.round(dailyMacros?.carbs || 0) },
        fat: { consumed: 0, goal: Math.round(dailyMacros?.fat || 0) },
      });
    }

    (progress as any).water.consumed = glasses;
    await progress.save();

    return {
      success: true,
      data: {
        progress,
        message: `Water intake updated to ${glasses} glasses`,
      },
    };
  }

  async getWeeklySummary(userId: string) {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const progressList = await this.progressModel
      .find({
        userId,
        date: {
          $gte: startOfWeek,
          $lte: endOfWeek,
        },
      })
      .lean()
      .sort({ date: 1 });

    const totalCalories = Math.round(
      progressList.reduce((sum, p: any) => sum + (p.caloriesConsumed || 0), 0)
    );
    const totalWater = progressList.reduce(
      (sum, p: any) => sum + (p.water?.consumed || 0),
      0
    );
    const avgCalories = Math.round(
      progressList.length > 0 ? totalCalories / progressList.length : 0
    );

    return {
      success: true,
      data: {
        summary: {
          totalCalories,
          avgCalories,
          totalWater,
          daysTracked: progressList.length,
        },
        dailyProgress: progressList.map((p: any) => ({
          date: p.date,
          calories: p.caloriesConsumed,
          water: p.water?.consumed || 0,
          stats: formatProgressStats(p),
        })),
      },
    };
  }

  async resetTodayProgress(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateKey = this.getLocalDateKey(today);

    const progress = await this.progressModel.findOne({
      userId,
      dateKey: todayDateKey,
    });

    if (!progress) {
      throw new NotFoundException("No progress found for today");
    }

    (progress as any).caloriesConsumed = 0;
    (progress as any).water.consumed = 0;
    (progress as any).protein.consumed = 0;
    (progress as any).carbs.consumed = 0;
    (progress as any).fat.consumed = 0;
    (progress as any).meals.breakfast.done = false;
    (progress as any).meals.lunch.done = false;
    (progress as any).meals.dinner.done = false;
    (progress as any).meals.snacks.forEach(
      (snack: any) => (snack.done = false)
    );
    (progress as any).workouts.forEach(
      (workout: any) => (workout.done = false)
    );

    await progress.save();

    return {
      success: true,
      message: "Today's progress has been reset",
      data: progress,
    };
  }

  async getAnalytics(userId: string, period: "week" | "month" = "week") {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let startDate: Date;
    if (period === "week") {
      // Last 7 days
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else {
      // Last 30 days
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
    }

    // Get user's plan for target values
    const plan = await this.planModel.findOne({ userId }).lean();
    const targetCalories = Math.round(plan?.userMetrics?.tdee || 2000);
    const targetProtein = Math.round(plan?.userMetrics?.dailyMacros?.protein || 150);
    const targetCarbs = Math.round(plan?.userMetrics?.dailyMacros?.carbs || 250);
    const targetFat = Math.round(plan?.userMetrics?.dailyMacros?.fat || 65);
    const targetWater = 8;

    // Get all progress records in range
    const progressList = await this.progressModel
      .find({
        userId,
        date: {
          $gte: startDate,
          $lte: today,
        },
      })
      .lean()
      .sort({ date: 1 });

    // Calculate totals
    const daysTracked = progressList.length;
    const totalDays = period === "week" ? 7 : 30;

    const totals = progressList.reduce(
      (acc, p: any) => ({
        calories: acc.calories + (p.caloriesConsumed || 0),
        protein: acc.protein + (p.protein?.consumed || 0),
        carbs: acc.carbs + (p.carbs?.consumed || 0),
        fat: acc.fat + (p.fat?.consumed || 0),
        water: acc.water + (p.water?.consumed || 0),
        workoutsCompleted: acc.workoutsCompleted + (p.workouts?.filter((w: any) => w.done)?.length || 0),
        workoutsTotal: acc.workoutsTotal + (p.workouts?.length || 0),
        caloriesBurned: acc.caloriesBurned + (p.workouts?.reduce((sum: number, w: any) =>
          sum + (w.done ? (w.caloriesBurned || 0) : 0), 0) || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0, workoutsCompleted: 0, workoutsTotal: 0, caloriesBurned: 0 }
    );

    // Calculate averages
    const avgCalories = daysTracked > 0 ? Math.round(totals.calories / daysTracked) : 0;
    const avgProtein = daysTracked > 0 ? Math.round(totals.protein / daysTracked) : 0;
    const avgCarbs = daysTracked > 0 ? Math.round(totals.carbs / daysTracked) : 0;
    const avgFat = daysTracked > 0 ? Math.round(totals.fat / daysTracked) : 0;
    const avgWater = daysTracked > 0 ? Math.round((totals.water / daysTracked) * 10) / 10 : 0;

    // Calculate goal percentages
    const caloriesGoalPercentage = targetCalories > 0 ? Math.round((avgCalories / targetCalories) * 100) : 0;
    const proteinGoalPercentage = targetProtein > 0 ? Math.round((avgProtein / targetProtein) * 100) : 0;
    const carbsGoalPercentage = targetCarbs > 0 ? Math.round((avgCarbs / targetCarbs) * 100) : 0;
    const fatGoalPercentage = targetFat > 0 ? Math.round((avgFat / targetFat) * 100) : 0;
    const waterGoalPercentage = targetWater > 0 ? Math.round((avgWater / targetWater) * 100) : 0;

    // Daily breakdown for charts
    const dailyData = progressList.map((p: any) => ({
      date: p.date,
      dateKey: p.dateKey || this.getLocalDateKey(new Date(p.date)),
      calories: p.caloriesConsumed || 0,
      caloriesGoal: p.caloriesGoal || targetCalories,
      protein: p.protein?.consumed || 0,
      carbs: p.carbs?.consumed || 0,
      fat: p.fat?.consumed || 0,
      water: p.water?.consumed || 0,
      workoutsCompleted: p.workouts?.filter((w: any) => w.done)?.length || 0,
      workoutsTotal: p.workouts?.length || 0,
    }));

    return {
      success: true,
      data: {
        period,
        startDate,
        endDate: today,
        daysTracked,
        totalDays,
        targets: {
          calories: targetCalories,
          protein: targetProtein,
          carbs: targetCarbs,
          fat: targetFat,
          water: targetWater,
        },
        totals: {
          calories: Math.round(totals.calories),
          protein: Math.round(totals.protein),
          carbs: Math.round(totals.carbs),
          fat: Math.round(totals.fat),
          water: totals.water,
          workoutsCompleted: totals.workoutsCompleted,
          workoutsTotal: totals.workoutsTotal,
          caloriesBurned: Math.round(totals.caloriesBurned),
        },
        averages: {
          calories: avgCalories,
          protein: avgProtein,
          carbs: avgCarbs,
          fat: avgFat,
          water: avgWater,
        },
        goalPercentages: {
          calories: caloriesGoalPercentage,
          protein: proteinGoalPercentage,
          carbs: carbsGoalPercentage,
          fat: fatGoalPercentage,
          water: waterGoalPercentage,
        },
        dailyData,
      },
    };
  }

  async createProgressFromPlan(
    userId: string,
    date: Date,
    dayPlan: IDayPlan,
    planId: string
  ) {
    // Use dateKey for timezone-safe querying
    const dateKey = this.getLocalDateKey(date);

    // Find existing progress or create new one
    let progress = await this.progressModel.findOne({ userId, dateKey });

    // Ensure meals are saved to DB and get their IDs
    const meals = await this.processMealsForProgress(dayPlan);

    // Calculate totals from meals
    const allMeals = [
      meals.breakfast,
      meals.lunch,
      meals.dinner,
      ...meals.snacks,
    ].filter(Boolean);

    const totalCalories = Math.round(
      allMeals.reduce((sum, meal) => sum + (meal?.calories || 0), 0)
    );
    const totalProtein = Math.round(
      allMeals.reduce((sum, meal) => sum + (meal?.macros?.protein || 0), 0)
    );
    const totalCarbs = Math.round(
      allMeals.reduce((sum, meal) => sum + (meal?.macros?.carbs || 0), 0)
    );
    const totalFat = Math.round(
      allMeals.reduce((sum, meal) => sum + (meal?.macros?.fat || 0), 0)
    );

    // Preserve existing done status
    if (meals.breakfast) {
      meals.breakfast.done = (progress as any)?.meals?.breakfast?.done || false;
    }
    if (meals.lunch) {
      meals.lunch.done = (progress as any)?.meals?.lunch?.done || false;
    }
    if (meals.dinner) {
      meals.dinner.done = (progress as any)?.meals?.dinner?.done || false;
    }

    const progressData = {
      userId,
      planId,
      date: date,
      dateKey: dateKey,
      caloriesConsumed: (progress as any)?.caloriesConsumed || 0,
      caloriesGoal: totalCalories,
      water: {
        consumed: (progress as any)?.water?.consumed || 0,
        goal: dayPlan.waterIntake,
      },
      workouts: dayPlan.workouts.map(
        (
          w: {
            name: string;
            category: string;
            duration: number;
            caloriesBurned: number;
            time?: string;
          },
          i: number
        ) => ({
          name: w.name,
          category: w.category,
          duration: parseDuration(w.duration),
          caloriesBurned: parseCalories(w.caloriesBurned),
          time: w.time,
          done: (progress as any)?.workouts?.[i]?.done || false,
        })
      ),
      meals: meals,
      protein: {
        consumed: (progress as any)?.protein?.consumed || 0,
        goal: totalProtein,
      },
      carbs: {
        consumed: (progress as any)?.carbs?.consumed || 0,
        goal: totalCarbs,
      },
      fat: {
        consumed: (progress as any)?.fat?.consumed || 0,
        goal: totalFat,
      },
    };

    if (progress) {
      // Update existing progress
      Object.assign(progress, progressData);
    } else {
      // Create new progress
      progress = await this.progressModel.create(progressData);
    }

    await progress.save();
    return progress;
  }
}
