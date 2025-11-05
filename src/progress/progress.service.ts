import { DailyProgress } from './progress.model';
import { IMeal, IWorkout, IDailyPlan } from '../types/interfaces';
import { Plan } from '../plan/plan.model';
import { IPlan } from '../types/interfaces';

const markMealCompleted = async (userId: string, date: Date, mealType: string, mealInfo: IMeal) => {
    const plan = await Plan.findOne({ userId });
    const dayPlan = plan?.weeklyPlan.find((d: IDailyPlan) => d.date.toISOString() === date.toString());
    if (!dayPlan) {
        return;
    }
    const meal = dayPlan.meals[mealType as keyof typeof dayPlan.meals];
    if (meal && !Array.isArray(meal)) {
        meal.done = true;
        dayPlan.netCalories += mealInfo.calories;
        await plan?.save();
    }
    const progress = await DailyProgress.findOne({ userId, date });
    if (progress) {
        const progressMeal = progress.meals[mealType as keyof typeof progress.meals];
        if (progressMeal && !Array.isArray(progressMeal)) {
            progressMeal.done = true;
            progress.caloriesConsumed += mealInfo.calories;
            await progress.save();
        }
    }
}

const markWorkoutCompleted = async (userId: string, date: Date, workout: IWorkout) => {
    const plan = await Plan.findOne({ userId });
    const dateOfProgress = new Date(date);
    dateOfProgress.setHours(0, 0, 0, 0);
    const dayPlan = plan?.weeklyPlan.find((d: IDailyPlan) => d.date.toISOString() === date.toString());
    if (!dayPlan) {
        return;
    }
    const workoutInfo = dayPlan.workouts.find((w: { name: string, category: string, duration: number, caloriesBurned: number, done: boolean }) => w.name === workout.name);
    if (workoutInfo) {
        workoutInfo.done = workout.done;
        workout.done ? dayPlan.netCalories -= workout.caloriesBurned : dayPlan.netCalories += workout.caloriesBurned;
        await plan?.save();
    }
    const progress = await DailyProgress.findOne({ userId, date: dateOfProgress });
    if (progress) {
        const progressWorkout = progress.workouts.find((w: { name: string, category: string, duration: number, caloriesBurned: number, done: boolean }) => w.name === workout.name);
        if (progressWorkout) {
            progressWorkout.done = workout.done;
            workout.done ? progress.caloriesConsumed -= parseInt(progressWorkout.caloriesBurned.toString()) : progress.caloriesConsumed += parseInt(workout.caloriesBurned.toString());
            await progress.save();
        }
    }
}

const drinkWater = async (userId: string, date: Date, glasses: number) => {
    const dateOfProgress = new Date(date);
    dateOfProgress.setHours(0, 0, 0, 0);
    const progress = await DailyProgress.findOne({ userId, date: dateOfProgress });
    if (progress) {
        progress.water.consumed += glasses;
        await progress.save();
        return progress;
    }
}

const createProgress = async (userId: string, date: Date) => {
    const progress = new DailyProgress({ userId, date });
    await progress.save();
}

const createProgressFromPlan = async (userId: string, date: Date, dayPlan: IDailyPlan, planId: string) => {
    // Find existing progress or create new one
    let progress = await DailyProgress.findOne({ userId, date });
    
    const progressData = {
        userId,
        planId,
        date: date,
        caloriesConsumed: progress?.caloriesConsumed || 0,
        caloriesGoal: dayPlan.totalCalories,
        water: {
          consumed: progress?.water.consumed || 0,
          goal: dayPlan.waterIntake
        },
        workouts: dayPlan.workouts.map((w: { name: string, category: string, duration: number, caloriesBurned: number, done: boolean }, i) => ({
          name: w.name,
          category: w.category,
          duration: w.duration,
          caloriesBurned: w.caloriesBurned,
          done: progress?.workouts[i]?.done || false
        })),
        meals: {
          breakfast: {
            ...dayPlan.meals.breakfast,
            done: progress?.meals.breakfast?.done || false
          },
          lunch: {
            ...dayPlan.meals.lunch,
            done: progress?.meals.lunch?.done || false
          },
          dinner: {
            ...dayPlan.meals.dinner,
            done: progress?.meals.dinner?.done || false
          },
          snacks: dayPlan.meals.snacks.map(snack => ({
            ...snack,
            done: false
          }))
        },
        protein: {
            consumed: progress?.protein.consumed || 0,
            goal: dayPlan.totalProtein
        },
        carbs: {
            consumed: progress?.carbs.consumed || 0,
            goal: dayPlan.totalCarbs
        },
        fat: {
            consumed: progress?.fat.consumed || 0,
            goal: dayPlan.totalFat
        }
    };

    if (progress) {
        // Update existing progress
        Object.assign(progress, progressData);
    } else {
        // Create new progress
        progress = new DailyProgress(progressData);
    }

    await progress.save();
    return progress;
}

export { markMealCompleted, markWorkoutCompleted, drinkWater, createProgress, createProgressFromPlan };