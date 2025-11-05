import { ACTIVITY_MULTIPLIERS, PATH_ADJUSTMENTS } from "../enums/enumPaths";

export const calculateBMR = (weight: number, height: number, age: number, gender: string): number => {
    if (gender === 'male') {
      return 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age);
    } else {
      return 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age);
    }
  };

export const calculateTDEE = (bmr: number, activityLevel?: string): number => {
    const multiplier = activityLevel ? ACTIVITY_MULTIPLIERS[activityLevel as keyof typeof ACTIVITY_MULTIPLIERS] : 1.55;
    return bmr * multiplier;
};

export const calculateIdealWeight = (height: number, gender: string): { min: number; max: number; ideal: number } => {
    const heightInMeters = height / 100;
    const minBMI = 18.5;
    const maxBMI = 24.9;
    const idealBMI = gender === 'male' ? 22.5 : 21.5;
    
    return {
      min: minBMI * heightInMeters * heightInMeters,
      max: maxBMI * heightInMeters * heightInMeters,
      ideal: idealBMI * heightInMeters * heightInMeters
    };
  };

export const calculateMacros = (calories: number, path: string) => {
    let proteinPercent, carbPercent, fatPercent;
    
    switch (path) {
      case 'muscle':
        proteinPercent = 0.30; carbPercent = 0.40; fatPercent = 0.30;
        break;
      case 'keto':
        proteinPercent = 0.25; carbPercent = 0.05; fatPercent = 0.70;
        break;
      case 'lose':
        proteinPercent = 0.35; carbPercent = 0.30; fatPercent = 0.35;
        break;
      case 'fasting':
        proteinPercent = 0.30; carbPercent = 0.35; fatPercent = 0.35;
        break;
      default: // healthy, custom
        proteinPercent = 0.25; carbPercent = 0.45; fatPercent = 0.30;
    }
    
    return {
      protein: Math.round((calories * proteinPercent) / 4), // 4 cal/g protein
      carbs: Math.round((calories * carbPercent) / 4),     // 4 cal/g carbs
      fat: Math.round((calories * fatPercent) / 9)         // 9 cal/g fat
    };
  };

export const calculateTargetCalories = (tdee: number, path: string): number => {
    const adjustment = PATH_ADJUSTMENTS[path as keyof typeof PATH_ADJUSTMENTS];
    return Math.round(tdee + adjustment);
};