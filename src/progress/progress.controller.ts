import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { DailyProgress } from './progress.model';
import { Plan } from '../plan/plan.model';
import logger from '../utils/logger';
import { formatProgressStats } from '../utils/helpers';
import { IMeal } from '../types/interfaces';
import { markMealCompleted, markWorkoutCompleted, drinkWater, createProgress, createProgressFromPlan } from './progress.service';

// Get today's progress
const getTodayProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's progress
    let progress = await DailyProgress.findOne({
      userId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    }).populate('meals.breakfast meals.lunch meals.dinner meals.snacks');

    // Get user's plan for goals
    const plan = await Plan.findOne({ userId });

    if (!progress) {
      // Get today's day of week for plan-specific goals
      const dayOfWeek = today.getDay();
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const todayDay = dayNames[dayOfWeek];
      
      // Find today's plan for specific goals
      const dayPlan = plan?.weeklyPlan.find((d: any) => d.day === todayDay);

      // Create new progress entry for today with 0 calories
      progress = new DailyProgress({
        userId,
        planId: plan?._id,
        date: today,
        caloriesConsumed: 0, // Start with 0 calories
        caloriesGoal: plan?.userMetrics?.tdee || 2000,
        water: {
          consumed: 0,
          goal: dayPlan?.waterIntake || 8
        },
        meals: {
          breakfast: dayPlan?.meals.breakfast || null,
          lunch: dayPlan?.meals.lunch || null,
          dinner: dayPlan?.meals.dinner || null,
          snacks: []
        },
        workouts: dayPlan?.workouts.map(w => ({
          name: w.name,
          duration: w.duration,
          caloriesBurned: w.caloriesBurned,
          done: false
        })) || []
      });
      await progress.save();
    }

    res.status(200).json({
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        message: progress.caloriesConsumed === 0 ? 
          "Day started! Complete meals from your plan to track calories." : 
          `Current progress: ${progress.caloriesConsumed}/${progress.caloriesGoal} calories`
      }
    });

  } catch (error) {
    logger.error('Error getting today\'s progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get today\'s progress'
    });
  }
};

// Get progress for a specific date
const getProgressByDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { date } = req.params;

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const progress = await DailyProgress.findOne({
      userId,
      date: {
        $gte: targetDate,
        $lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
      }
    }).populate('meals.breakfast meals.lunch meals.dinner meals.snacks');

    if (!progress) {
      res.status(404).json({
        success: false,
        message: 'No progress found for this date'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        progress
      }
    });

  } catch (error) {
    logger.error('Error getting progress by date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get progress by date'
    });
  }
};

// Get progress for a date range
const getProgressByDateRange = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);

    const progress = await DailyProgress.find({
      userId,
      date: {
        $gte: start,
        $lte: end
      }
    }).populate('meals.breakfast meals.lunch meals.dinner meals.snacks').sort({ date: 1 });

    res.status(200).json({
      success: true,
      data: {
        progress,
        count: progress.length
      }
    });

  } catch (error) {
    logger.error('Error getting progress by date range:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get progress by date range'
    });
  }
};

// Mark meal as completed
const markMealCompletedController = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { date, mealType, mealInfo } = req.body;
    if (!userId || !date || !mealType || !mealInfo) {
      res.status(400).json({
        success: false,
        message: 'User ID, date, meal type, and meal info are required'
      });
      return;
    }
    await markMealCompleted(userId, date, mealType, mealInfo);
    res.status(200).json({
      success: true,
      message: 'Meal marked as completed'
    });
  } catch (error) {
    logger.error('Error marking meal as completed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark meal as completed'
    });
  }
};

// Add water glass
const addWaterGlass = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { date, glasses } = req.body;
    if (!userId || !date || !glasses) {
      res.status(400).json({
        success: false,
        message: 'User ID, date, and glasses are required'
      });
      return;
    }
    const progress = await drinkWater(userId, date, glasses);
    res.status(200).json({
      success: true,
      data: progress,
      message: 'Water glass added'
    });
  } catch (error) {
    logger.error('Error adding water glass:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: 'Failed to add water glass'
    });
  }
};


const markWorkoutCompletedController = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { date, workout } = req.body;
    if (!userId || !date || !workout) {
      res.status(400).json({
        success: false,
        message: 'User ID, date, and workout are required'
      });
      return;
    }
    await markWorkoutCompleted(userId, date, workout);
    res.status(200).json({
      success: true,
      data: workout.name,
      message: 'Workout marked as completed'
    });
  } catch (error) {
    logger.error('Error marking workout as completed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark workout as completed'
    });
  }
};

// Add custom calories (for meals not in plan)
const addCustomCalories = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { calories, mealName, mealType } = req.body;

    if (!calories || calories <= 0) {
      res.status(400).json({
        success: false,
        message: 'Valid calories amount is required'
      });
      return;
    }

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
      const plan = await Plan.findOne({ userId });
      const dayOfWeek = today.getDay();
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const todayDay = dayNames[dayOfWeek];
      const dayPlan = plan?.weeklyPlan.find((d: any) => d.day === todayDay);

      progress = new DailyProgress({
        userId,
        date: today,
        caloriesConsumed: 0, // Start with 0 calories
        caloriesGoal: plan?.userMetrics?.tdee || 2000,
        water: {
          consumed: 0,
          goal: dayPlan?.waterIntake || 8
        },
        workouts: dayPlan?.workouts.map(w => ({
          name: w.name,
          duration: w.duration,
          caloriesBurned: w.caloriesBurned,
          done: false
        })) || [],
        meals: {
          breakfast: dayPlan?.meals.breakfast || null,
          lunch: dayPlan?.meals.lunch || null,
          dinner: dayPlan?.meals.dinner || null,
          snacks: []
        }
      });
    }

    const previousCalories = progress.caloriesConsumed;
    progress.caloriesConsumed += calories;

    // Update meal completion if mealType is provided
    if (mealType && ['breakfast', 'lunch', 'dinner'].includes(mealType)) {
      const customMeal: IMeal = {
        _id: new mongoose.Types.ObjectId().toString(),
        name: mealName || `Custom ${mealType}`,
        calories,
        macros: {
          protein: 0,
          carbs: 0,
          fat: 0
        },
        category: mealType as 'breakfast' | 'lunch' | 'dinner',
        ingredients: [],
        prepTime: 0,
        done: true
      };
      (progress.meals as any)[mealType] = customMeal;
    }

    await progress.save();

    // Calculate progress percentage
    const progressPercentage = Math.round((progress.caloriesConsumed / progress.caloriesGoal) * 100);
    const remainingCalories = Math.max(0, progress.caloriesGoal - progress.caloriesConsumed);

    res.status(200).json({
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        caloriesAdded: calories,
        previousCalories,
        currentCalories: progress.caloriesConsumed,
        progressPercentage,
        remainingCalories,
        message: `Added ${calories} calories for ${mealName || 'custom meal'}! Progress: ${progress.caloriesConsumed}/${progress.caloriesGoal} (${progressPercentage}%)`
      }
    });

  } catch (error) {
    logger.error('Error adding custom calories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add custom calories'
    });
  }
};

// Update water intake based on plan
const updateWaterIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { glasses } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get user's plan to sync water goal
    const plan = await Plan.findOne({ userId });
    const dayOfWeek = today.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayDay = dayNames[dayOfWeek];
    const dayPlan = plan?.weeklyPlan.find((d: any) => d.day === todayDay);

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
        date: today,
        caloriesGoal: plan?.userMetrics?.tdee || 2000,
        waterGoal: dayPlan?.waterIntake || 8,
        workoutsGoal: 1
      });
    }

    if (glasses !== undefined) {
      progress.water.consumed = glasses;
    } else {
      progress.water.consumed += 1;
    }

    await progress.save();

    res.status(200).json({
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        message: `Water intake updated to ${progress.water.consumed} glasses`
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

// Update exercise based on plan
const updateExercise = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { exerciseMinutes, caloriesBurned } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get user's plan to sync exercise goals
    const plan = await Plan.findOne({ userId });
    const dayOfWeek = today.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayDay = dayNames[dayOfWeek];
    const dayPlan = plan?.weeklyPlan.find((d: any) => d.day === todayDay);

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
        date: today,
        caloriesGoal: plan?.userMetrics?.tdee || 2000,
        waterGoal: dayPlan?.waterIntake || 8,
        workoutsGoal: 1
      });
    }

    // Find first incomplete workout and mark it as done
    const firstIncompleteWorkout = progress.workouts.find(w => !w.done);
    if (firstIncompleteWorkout) {
      firstIncompleteWorkout.done = true;
      if (exerciseMinutes !== undefined) {
        firstIncompleteWorkout.duration = exerciseMinutes;
      }
      if (caloriesBurned !== undefined) {
        firstIncompleteWorkout.caloriesBurned = caloriesBurned;
        // Update net calories (consumed - burned)
        progress.caloriesConsumed = Math.max(0, progress.caloriesConsumed - caloriesBurned);
      }
    }

    await progress.save();

    res.status(200).json({
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        message: `Exercise updated: ${exerciseMinutes || 0} minutes, ${caloriesBurned || 0} calories burned`
      }
    });

  } catch (error) {
    logger.error('Error updating exercise:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update exercise'
    });
  }
};

// Get weekly summary
const getWeeklySummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const { weekStart } = req.query; // Optional: YYYY-MM-DD format

    let startDate: Date;
    if (weekStart) {
      startDate = new Date(weekStart as string);
    } else {
      // Default to current week (Monday)
      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startDate = new Date(today);
      startDate.setDate(today.getDate() - daysToMonday);
    }

    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 999);

    const weeklyProgress = await DailyProgress.find({
      userId,
      date: {
        $gte: startDate,
        $lt: endDate
      }
    }).sort({ date: 1 });

    // Calculate summary
    const summary = {
      totalCaloriesConsumed: weeklyProgress.reduce((sum, day) => sum + day.caloriesConsumed, 0),
      totalCaloriesGoal: weeklyProgress.reduce((sum, day) => sum + day.caloriesGoal, 0),
      totalWaterConsumed: weeklyProgress.reduce((sum, day) => sum + day.water.consumed, 0),
      totalWaterGoal: weeklyProgress.reduce((sum, day) => sum + day.water.goal, 0),
      totalWorkouts: weeklyProgress.reduce((sum, day) => sum + day.workouts.filter(w => w.done).length, 0),
      totalWorkoutsGoal: weeklyProgress.reduce((sum, day) => sum + day.workouts.length, 0),
      totalExerciseMinutes: weeklyProgress.reduce((sum, day) => sum + day.workouts.reduce((total, w) => total + (w.done ? w.duration : 0), 0), 0),
      daysWithProgress: weeklyProgress.length,
      averageCaloriesPerDay: weeklyProgress.length > 0 ? 
        weeklyProgress.reduce((sum, day) => sum + day.caloriesConsumed, 0) / weeklyProgress.length : 0,
      averageWaterPerDay: weeklyProgress.length > 0 ? 
        weeklyProgress.reduce((sum, day) => sum + day.water.consumed, 0) / weeklyProgress.length : 0
    };

    res.status(200).json({
      success: true,
      data: {
        weeklyProgress,
        summary,
        weekStart: startDate,
        weekEnd: new Date(endDate.getTime() - 1)
      }
    });

  } catch (error) {
    logger.error('Error getting weekly summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get weekly summary'
    });
  }
};

// Reset today's progress to 0
const resetTodayProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get user's plan for goals
    const plan = await Plan.findOne({ userId });
    const dayOfWeek = today.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayDay = dayNames[dayOfWeek];
    const dayPlan = plan?.weeklyPlan.find((d: any) => d.day === todayDay);

    let progress = await DailyProgress.findOne({
      userId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (!progress) {
      // Create new progress entry for today
      progress = new DailyProgress({
        userId,
        date: today,
        caloriesConsumed: 0,
        caloriesGoal: plan?.userMetrics?.tdee || 2000,
        waterGlasses: 0,
        waterGoal: dayPlan?.waterIntake || 8,
        workoutsCompleted: 0,
        workoutsGoal: 1,
        mealsCompleted: {
          breakfast: false,
          lunch: false,
          dinner: false,
          snacks: 0
        },
        exerciseMinutes: 0
      });
    } else {
      // Reset existing progress to 0
      progress.caloriesConsumed = 0;
      progress.water.consumed = 0;
      progress.workouts = progress.workouts.map(w => ({ ...w, done: false }));
      progress.meals = {
        ...progress.meals,
        breakfast: { ...progress.meals.breakfast, done: false },
        lunch: { ...progress.meals.lunch, done: false },
        dinner: { ...progress.meals.dinner, done: false },
        snacks: []
      };
      progress.weight = undefined;
      progress.notes = undefined;
    }

    await progress.save();

    res.status(200).json({
      success: true,
      data: {
        progress,
        stats: formatProgressStats(progress),
        message: "Day reset! Start fresh by completing meals from your plan."
      }
    });

  } catch (error) {
    logger.error('Error resetting today\'s progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset today\'s progress'
    });
  }
};

export {
  getTodayProgress,

  getProgressByDate,
  getProgressByDateRange,
  markMealCompletedController ,
  addWaterGlass,
  markWorkoutCompletedController,
  getWeeklySummary,
  addCustomCalories,
  updateWaterIntake,
  updateExercise,
  resetTodayProgress
}; 