import { User } from "../user/user.model";
import { calculateTDEE, calculateBMR, calculateTargetCalories, calculateIdealWeight, calculateMacros } from "../utils/healthCalculations";
import { PATH_WATER_INTAKE, PATH_WORKOUTS_GOAL } from "../enums/enumPaths";
import { IUserData } from "../types/interfaces";
import { Plan } from "./plan.model";

export const createInitialPlanFunction = async (userId: string, userData: IUserData, language: string) => {

    const title = 'My First Plan';
    const bmr = calculateBMR(userData.weight, userData.height, userData.age, userData.gender);
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
      waterIntake: PATH_WATER_INTAKE[userData.path as keyof typeof PATH_WATER_INTAKE],
      workoutsGoal: PATH_WORKOUTS_GOAL[userData.path as keyof typeof PATH_WORKOUTS_GOAL]
    }

    const plan = new Plan({
      userId,
      title,
      userData,
      language,
      userMetrics,
      dailyMacros: macros,
    });

    await plan.save();

    return plan;
}
