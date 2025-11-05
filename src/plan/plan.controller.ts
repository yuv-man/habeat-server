import { Request, Response } from 'express';
import { IDailyPlan, IMeal } from '../types/interfaces';
import { Plan } from './plan.model';
import { User } from '../user/user.model';
import { Meal } from '../meal/meal.model';
import { DailyProgress } from '../progress/progress.model';
import aiService from '../generator/generate.service';
import { MealCacheService } from '../cache/MealCacheService';
import logger from '../utils/logger';
import { organizeIngredients, processMealForIngredients, formatProgressStats } from '../utils/helpers';
import { createInitialPlanFunction } from './plan.service';
import { createProgressFromPlan } from '../progress/progress.service';

interface AuthRequest extends Request {
  user?: {
    _id: string;
    email: string;
  };
}

const createInitialPlan = async (req: AuthRequest, res: Response) => {
  try {
    const {userData: IUserData, language} = req.body;
    const userId = req.user?._id;
    if (!userId) {
      throw new Error('User ID is required');
    }
    const plan = await createInitialPlanFunction(userId, IUserData, language);

    res.status(200).json({
      success: true,
      data: { plan }
    });

  } catch (error) {
    logger.error('Error creating initial plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create initial plan'
    });
  }
};

const generatePlan = async (req: AuthRequest, res: Response) => {
  try {
    const { userData, startDate: rawStartDate, language='en', useMock=false } = req.body;
    const startDate = new Date(rawStartDate);
    if (isNaN(startDate.getTime())) {
      throw new Error('Invalid start date');
    }
    const userId = req.user?._id;

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    const response = await aiService.generateMealPlanWithAI(userData, startDate, language, 'weekly', useMock);
    
    // Transform the response to match our interface
    const weeklyPlan = response.mealPlan.weeklyPlan.map((day: any) => ({
      ...day,
      day: day.day.toLowerCase() as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
      date: day.date
    }));
    
    // Save each unique meal to the database if it doesn't exist
    for (const day of weeklyPlan) {
      const meals = [
        day.meals.breakfast,
        day.meals.lunch,
        day.meals.dinner,
        ...day.meals.snacks
      ];

      for (const meal of meals) {
        // Check if meal already exists by name
        const existingMeal = await Meal.findOne({ name: meal.name });
        if (!existingMeal) {
          // Create new meal in database
          await Meal.create({
            name: meal.name,
            calories: meal.calories,
            macros: meal.macros,
            category: meal.category,
            prepTime: meal.prepTime || 0, // Default to 0 if not provided
            ingredients: meal.ingredients || [],
          });
        }
      }
    }

    plan.weeklyPlan = weeklyPlan;
    plan.language = response.language;
    plan.generatedAt = new Date(response.generatedAt);

    // Create or update progress entries for each day
    for (const dayPlan of weeklyPlan) {
      const dayDate = new Date(dayPlan.date);
      dayDate.setHours(0, 0, 0, 0);

      if (!userId) {
        throw new Error('User ID is required');
      }

      // Whether progress exists or not, create new progress from plan
      const progress = await createProgressFromPlan(userId, dayDate, dayPlan, plan._id as unknown as string);

      if (!progress) {
        throw new Error('Failed to create progress from plan');
      }

      await progress.save();
    }

    await plan.save();

    res.status(200).json({
      success: true,
      data: {
        plan
      }
    });

  } catch (error) {
    logger.error('Error generating meal plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate meal plan'
    });
  }
};

const getPlanByUserId = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        plan
      }
    });

  } catch (error) {
    logger.error('Error getting plan by user id:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get plan by user id'
    });
  }
};

const updatePlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    const { title, userData, language } = req.body;

    plan.title = title;
    plan.userData = userData;
    plan.language = language;

    await plan.save();

    res.status(200).json({
      success: true,
      data: {
        plan
      }
    });

  } catch (error) {
    logger.error('Error updating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update plan'
    });
  }
};

const deletePlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    await plan.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Plan deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete plan'
    });
  }
};

// Generate shopping list (with caching)
const generateShoppingList = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
    }

    // Collect all ingredients from all meals in the week
    const allIngredients: string[] = [];
    const mealsToGenerate: string[] = [];
    
    for (const dayPlan of plan.weeklyPlan) {
      // Process each meal type (breakfast, lunch, dinner, snacks)
      const mealTypes = ['breakfast', 'lunch', 'dinner', 'snacks'];
      
      for (const mealType of mealTypes) {
        const meals = dayPlan.meals[mealType as keyof typeof dayPlan.meals];
        
        if (Array.isArray(meals)) {
          // Handle snacks array
          for (const meal of meals) {
            await processMealForIngredients(meal, plan, allIngredients, mealsToGenerate);
          }
        } else {
          // Handle single meal (breakfast, lunch, dinner)
          await processMealForIngredients(meals, plan, allIngredients, mealsToGenerate);
        }
      }
    }

    // Generate ingredients for uncached meals
    if (mealsToGenerate.length > 0) {
      logger.info(`Generating ingredients for ${mealsToGenerate.length} uncached meals`);
      
      for (const mealName of mealsToGenerate) {
        try {
          // TODO: Implement recipe details generation
          const generatedMeal = {
            name: mealName,
            calories: 500,
            protein: 20,
            carbs: 50,
            fat: 20,
            ingredients: [],
            category: 'dinner',
            _id: '',
            isCustom: true
          };
          
          // Add generated ingredients
          allIngredients.push(...generatedMeal.ingredients);
          
          // Cache the generated meal for future use
          await MealCacheService.cacheMeal(
            generatedMeal.name,
            'dinner', // Default category
            generatedMeal.calories,
            generatedMeal.protein,
            generatedMeal.carbs,
            generatedMeal.fat,
            generatedMeal.ingredients,
            plan.userData.path,
            plan.userData.allergies || [],
            plan.language
          );
        } catch (error) {
          logger.error(`Failed to generate ingredients for ${mealName}:`, error);
        }
      }
    }

    // Remove duplicates and organize ingredients
    const uniqueIngredients = [...new Set(allIngredients)];
    const organizedList = organizeIngredients(uniqueIngredients);

    res.json({
      success: true,
      data: {
        planTitle: plan.title,
        shoppingList: organizedList,
        generatedAt: new Date().toISOString(),
        fromCache: mealsToGenerate.length === 0
      }
    });

  } catch (error) {
    logger.error('Error generating shopping list:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate shopping list'
    });
  }
};

// Replace a specific meal with same calories (with caching)
const replaceMeal = async (req: AuthRequest, res: Response) => {
  try {
    const { day, mealType } = req.params;
    const { user, newMealName, dietaryRestrictions = [] } = req.body;
    const userId = user?._id;

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    const dayPlan = plan.weeklyPlan.find((d: IDailyPlan) => d.day === day);
    if (!dayPlan) {
      res.status(404).json({
        success: false,
        message: 'Day plan not found'
      });
      return;
    }

    const currentMeal = dayPlan.meals[mealType as keyof typeof dayPlan.meals];
    if (!currentMeal || Array.isArray(currentMeal)) {
      res.status(400).json({
        success: false,
        message: 'Invalid meal type or meal not found'
      });
      return;
    }

    const targetCalories = currentMeal.calories;

    const existingMeal = await Meal.findOne({ name: newMealName });
    let newMealData;

    if (existingMeal) {
      newMealData = {
        name: existingMeal.name,
        calories: existingMeal.calories,
        macros: existingMeal.macros,
        ingredients: existingMeal.ingredients,
      };
    } else {
      // Generate new meal replacement only if not cached
      logger.info(`Generating new meal replacement: ${newMealName} - AI cost incurred`);
      // TODO: Implement meal generation
      const newMealSuggestion = {
        name: newMealName,
        calories: targetCalories,
        macros: {
          protein: Math.round(targetCalories * 0.3 / 4), // 30% protein
          carbs: Math.round(targetCalories * 0.4 / 4),   // 40% carbs
          fat: Math.round(targetCalories * 0.3 / 9),     // 30% fat
        },
        ingredients: [],
        category: mealType,
        _id: '',
        isCustom: true
      };
      newMealData = { ...newMealSuggestion, fromCache: false };
    }

    // Update the meal
    const newMeal: IMeal = {
      _id: newMealData._id || '',
      name: newMealData.name,
      calories: targetCalories,
      macros: newMealData.macros,
      category: currentMeal.category,
      ingredients: newMealData.ingredients,
      usageCount: 0,
      prepTime: 0,
      done: false
    };

    // Handle different meal types (single meal vs array for snacks)
    if (mealType === 'snacks') {
      // For snacks, find and replace the specific snack
      const snacks = dayPlan.meals.snacks as IMeal[];
      const snackIndex = snacks.findIndex(s => s.name === currentMeal.name);
      if (snackIndex !== -1) {
        snacks[snackIndex] = newMeal;
      }
    } else {
      // For single meals (breakfast, lunch, dinner)
      (dayPlan.meals as any)[mealType] = newMeal;
    }

    const workoutTotalCaloriesBurned = dayPlan.workouts.reduce((sum, day) => sum + day.caloriesBurned, 0);
    // Recalculate day totals
    const breakfast = dayPlan.meals.breakfast;
    const lunch = dayPlan.meals.lunch;
    const dinner = dayPlan.meals.dinner;
    const snacksTotal = dayPlan.meals.snacks.reduce(
      (acc: { calories: number; macros: { protein: number; carbs: number; fat: number } }, snack: IMeal) => ({
        calories: acc.calories + snack.calories,
        macros: {
          protein: acc.macros.protein + snack.macros.protein,
          carbs: acc.macros.carbs + snack.macros.carbs,
          fat: acc.macros.fat + snack.macros.fat
        }
      }), 
      { calories: 0, macros: { protein: 0, carbs: 0, fat: 0 } }
    );

    dayPlan.totalCalories = breakfast.calories + lunch.calories + dinner.calories + snacksTotal.calories;
    dayPlan.totalProtein = breakfast.macros.protein + lunch.macros.protein + dinner.macros.protein + snacksTotal.macros.protein;
    dayPlan.totalCarbs = breakfast.macros.carbs + lunch.macros.carbs + dinner.macros.carbs + snacksTotal.macros.carbs;
    dayPlan.totalFat = breakfast.macros.fat + lunch.macros.fat + dinner.macros.fat + snacksTotal.macros.fat;
    
    dayPlan.netCalories = dayPlan.totalCalories - workoutTotalCaloriesBurned;

    await plan.save();

    res.json({
      success: true,
      message: 'Meal replaced successfully',
      data: {
        day,
        mealType,
        newMeal,
        updatedTotals: {
          totalCalories: dayPlan.totalCalories,
          totalProtein: dayPlan.totalProtein,
          totalCarbs: dayPlan.totalCarbs,
          totalFat: dayPlan.totalFat,
          netCalories: dayPlan.netCalories
        },
        fromCache: newMealData.fromCache
      }
    });

  } catch (error) {
    logger.error('Error replacing meal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to replace meal'
    });
  }
};

const updateWaterIntake = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { waterIntake, date } = req.body;

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    const dayPlan = await DailyProgress.findOne({ userId, date: { $gte: date, $lt: new Date(date.getTime() + 24 * 60 * 60 * 1000) } });

    if (!dayPlan) {
      res.status(404).json({
        success: false,
        message: 'Day plan not found'
      });
      return;
    }

    dayPlan.water.goal = waterIntake;

    await plan.save();

    res.status(200).json({
      success: true,
      data: {
        plan
      }
    });

  } catch (error) {
    logger.error('Error updating water intake:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update water intake'
    });
  }
};

const addWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { date, workout } = req.body;

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    const dayPlan = plan.weeklyPlan.find((d: IDailyPlan) => d.date.toISOString() === date.toString());

    if (!dayPlan) {
      res.status(404).json({
        success: false,
        message: 'Day plan not found'
      });
      return;
    }

    dayPlan.workouts.push({ name: workout.name, category: workout.category, duration: workout.duration, caloriesBurned: workout.caloriesBurned, done: false });

    await plan.save();
    
    const progress = await DailyProgress.findOneAndUpdate(
      { userId, date: dayPlan.date },
      { $push: { workouts: workout } },
      { new: true } // Return the updated document
    );

    res.status(200).json({
      success: true,
      data: {
        plan,
        progress
      }
    });

  } catch (error) {
    logger.error('Error adding exercise:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add exercise'
    });
  }
};

const getDayPlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { day } = req.params;

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }
    
    const dayPlan = plan.weeklyPlan.find((d: IDailyPlan) => d.day === day);

    if (!dayPlan) {
      res.status(404).json({
        success: false,
        message: 'Day plan not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        dayPlan
      }
    });

  } catch (error) {
    logger.error('Error getting day plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get day plan'
    });
  }
};



// Track meal consumption and update daily progress
const trackMealConsumption = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { day, mealType, consumed, customCalories } = req.body;

    const plan = await Plan.findOne({ userId });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }

    const dayPlan = plan.weeklyPlan.find((d: IDailyPlan) => d.day === day);
    if (!dayPlan) {
      res.status(404).json({
        success: false,
        message: 'Day plan not found'
      });
      return;
    }

    // Get today's progress
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let progress = await DailyProgress.findOne({
      userId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (!progress) {
      progress = new DailyProgress({
        userId,
        planId: plan._id,
        date: today,
        caloriesGoal: plan.userMetrics?.tdee || 2000,
        water: {
          consumed: 0,
          goal: dayPlan.waterIntake || 8
        },
        workouts: dayPlan.workouts.map((w: { name: string, category: string, duration: number, caloriesBurned: number, done: boolean }) => ({
          name: w.name,
          category: w.category || 'cardio', // Ensure category is set
          duration: w.duration,
          caloriesBurned: w.caloriesBurned,
          done: w.done || false
        })),
        meals: {
          breakfast: dayPlan.meals.breakfast,
          lunch: dayPlan.meals.lunch,
          dinner: dayPlan.meals.dinner,
          snacks: dayPlan.meals.snacks
        }
      });
    }

    let caloriesToAdd = 0;
    let mealInfo: IMeal | null = null;

    // Update calories consumed based on meal type
    if (consumed) {
      if (mealType === 'snacks') {
        // For snacks, we need to specify which snack
        const { snackIndex } = req.body;
        if (snackIndex !== undefined && dayPlan.meals.snacks[snackIndex]) {
          mealInfo = dayPlan.meals.snacks[snackIndex];
          caloriesToAdd = mealInfo.calories;
          progress.meals.snacks.push(mealInfo);
        } else if (customCalories) {
          caloriesToAdd = customCalories;
          progress.meals.snacks.push(mealInfo as unknown as IMeal);
        }
      } else {
        // For main meals
        const meal = dayPlan.meals[mealType as keyof typeof dayPlan.meals];
        if (meal && !Array.isArray(meal)) {
          mealInfo = meal;
          caloriesToAdd = meal.calories;
          (progress.meals[mealType as keyof typeof progress.meals] as any).done = true;
        } else if (customCalories) {
          caloriesToAdd = customCalories;
          (progress.meals[mealType as keyof typeof progress.meals] as any).done = true;
        }
      }

      progress.caloriesConsumed += caloriesToAdd;
    } else {
      // Mark as not consumed
      if (mealType === 'snacks') {
        progress.meals.snacks = progress.meals.snacks.filter((s: IMeal) => s.name !== mealInfo?.name);
      } else {
        (progress.meals[mealType as keyof typeof progress.meals] as any).done = false;
      }
    }

    await progress.save();

    res.status(200).json({
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        mealInfo,
        caloriesAdded: caloriesToAdd,
        message: `Meal ${consumed ? 'consumed' : 'unmarked'} successfully`
      }
    });

  } catch (error) {
    logger.error('Error tracking meal consumption:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track meal consumption'
    });
  }
};

const updateMeal = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { date, meal, useMock=false } = req.body;

    const plan = await Plan.findOne({ userId: id });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: 'No meal plan found'
      });
      return;
    }
    const dayPlan = plan.weeklyPlan.find((d: IDailyPlan) => (d.date.toISOString() === date.toString()));

    if (!dayPlan) {
      res.status(404).json({
        success: false,
        message: 'Day plan not found'
      });
      return;
    }

    const category = meal.category;
    
    // Handle snacks separately since they are an array
    if (category === 'snacks') {
      const snackIndex = dayPlan.meals.snacks.findIndex(s => s._id === meal._id);
      if (snackIndex !== -1) {
        dayPlan.meals.snacks[snackIndex] = meal;
      } else {
        dayPlan.meals.snacks.push(meal);
      }
    } else {
      // For regular meals (breakfast, lunch, dinner)
      dayPlan.meals[category as 'breakfast' | 'lunch' | 'dinner'] = meal;
    }

    // Recalculate day totals
    const breakfast = dayPlan.meals.breakfast;
    const lunch = dayPlan.meals.lunch;
    const dinner = dayPlan.meals.dinner;
    const snacksTotal = dayPlan.meals.snacks.reduce(
      (acc: { calories: number; macros: { protein: number; carbs: number; fat: number } }, snack: IMeal) => ({
        calories: acc.calories + snack.calories,
        macros: {
          protein: acc.macros.protein + snack.macros.protein,
          carbs: acc.macros.carbs + snack.macros.carbs,
          fat: acc.macros.fat + snack.macros.fat
        }
      }), 
      { calories: 0, macros: { protein: 0, carbs: 0, fat: 0 } }
    );

    // Update day totals
    dayPlan.totalCalories = breakfast.calories + lunch.calories + dinner.calories + snacksTotal.calories;
    dayPlan.totalProtein = breakfast.macros.protein + lunch.macros.protein + dinner.macros.protein + snacksTotal.macros.protein;
    dayPlan.totalCarbs = breakfast.macros.carbs + lunch.macros.carbs + dinner.macros.carbs + snacksTotal.macros.carbs;
    dayPlan.totalFat = breakfast.macros.fat + lunch.macros.fat + dinner.macros.fat + snacksTotal.macros.fat;
    
    // Recalculate net calories considering workouts
    const workoutTotalCaloriesBurned = dayPlan.workouts.reduce((sum, workout) => sum + workout.caloriesBurned, 0);
    dayPlan.netCalories = dayPlan.totalCalories - workoutTotalCaloriesBurned;

    // Update progress for this day
    const dayDate = new Date(dayPlan.date);
    dayDate.setHours(0, 0, 0, 0);

    let progress = await DailyProgress.findOne({
      userId: id,
      date: {
        $gte: dayDate,
        $lt: new Date(dayDate.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (!progress) {
      progress = new DailyProgress({
        userId: id,
        planId: plan._id,
        date: dayDate,
        caloriesConsumed: 0,
        caloriesGoal: plan.userMetrics?.tdee || 2000,
        water: {
          consumed: 0,
          goal: dayPlan.waterIntake || 8
        },
        workouts: dayPlan.workouts.map((w: { name: string, category: string, duration: number, caloriesBurned: number, done: boolean }) => ({
          name: w.name,
          category: w.category || 'cardio', // Ensure category is set
          duration: w.duration,
          caloriesBurned: w.caloriesBurned,
          done: w.done || false
        })),
        meals: {
          breakfast: dayPlan.meals.breakfast,
          lunch: dayPlan.meals.lunch,
          dinner: dayPlan.meals.dinner,
          snacks: dayPlan.meals.snacks
        }
      });
    } else {
      // Update progress based on meal changes
      if (category === 'snacks') {
        progress.meals.snacks = dayPlan.meals.snacks.filter((s: IMeal) => s.done);
      } else {
        (progress.meals[category as keyof typeof progress.meals] as any).done = meal.done;
      }

      // Recalculate consumed calories based on completed meals
      progress.caloriesConsumed = 0;
      if (dayPlan.meals.breakfast.done) progress.caloriesConsumed += dayPlan.meals.breakfast.calories;
      if (dayPlan.meals.lunch.done) progress.caloriesConsumed += dayPlan.meals.lunch.calories;
      if (dayPlan.meals.dinner.done) progress.caloriesConsumed += dayPlan.meals.dinner.calories;
      progress.caloriesConsumed += dayPlan.meals.snacks
        .filter(s => s.done)
        .reduce((total, s) => total + s.calories, 0);
    }

    await progress.save();
    await plan.save();
    res.status(200).json({
      success: true,
      data: {
        plan
      }
    });

  } catch (error) {
    logger.error('Error marking day as done:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark day as done'
    });
  }
};

// Cache maintenance endpoint (admin only)
const cleanOldCache = async (req: AuthRequest, res: Response) => {
  try {
    // Clean old meals (admin endpoint)
    await MealCacheService.cleanOldMeals(90); // Remove meals older than 90 days with low usage

    res.json({
      success: true,
      message: 'Cache cleaned successfully'
    });

  } catch (error) {
    logger.error('Error cleaning cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean cache'
    });
  }
};

export {
  getDayPlan,
  generateShoppingList,
  replaceMeal,
  cleanOldCache,
  generatePlan,
  getPlanByUserId,
  updatePlan,
  deletePlan,
  updateWaterIntake,
  addWorkout,
  trackMealConsumption,
  createInitialPlan,
  updateMeal
};
