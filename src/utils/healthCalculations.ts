import {
  activityMultiplierForWorkouts,
  PATH_ADJUSTMENTS,
} from "../enums/enumPaths";

export const calculateBMR = (
  weight: number,
  height: number,
  age: number,
  gender: string
): number => {
  if (gender === "male") {
    return 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age;
  } else {
    return 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age;
  }
};

/**
 * @param workoutFrequency workouts per week (0-7), as collected in KYC.
 */
export const calculateTDEE = (
  bmr: number,
  workoutFrequency?: number
): number => bmr * activityMultiplierForWorkouts(workoutFrequency);

export const calculateIdealWeight = (
  height: number,
  gender: string
): { min: number; max: number; ideal: number } => {
  const heightInMeters = height / 100;
  const minBMI = 18.5;
  const maxBMI = 24.9;
  const idealBMI = gender === "male" ? 22.5 : 21.5;

  return {
    min: minBMI * heightInMeters * heightInMeters,
    max: maxBMI * heightInMeters * heightInMeters,
    ideal: idealBMI * heightInMeters * heightInMeters,
  };
};

export const calculateMacros = (calories: number, path: string) => {
  let proteinPercent, carbPercent, fatPercent;

  // PATH_ADJUSTMENTS and PATH_WORKOUTS_GOAL both accept the hyphenated aliases,
  // so a user stored as "gain-muscle" was getting a muscle-gain calorie surplus
  // on top of the default healthy macro split.
  switch (path === "gain-muscle" ? "muscle" : path === "lose-weight" ? "lose" : path) {
    case "muscle":
      proteinPercent = 0.3;
      carbPercent = 0.4;
      fatPercent = 0.3;
      break;
    case "keto":
      proteinPercent = 0.25;
      carbPercent = 0.05;
      fatPercent = 0.7;
      break;
    case "lose":
      proteinPercent = 0.35;
      carbPercent = 0.3;
      fatPercent = 0.35;
      break;
    case "fasting":
      proteinPercent = 0.3;
      carbPercent = 0.35;
      fatPercent = 0.35;
      break;
    case "running":
      // Endurance training runs on carbohydrate. The default split gave a
      // 60 kg runner 2.25 g/kg protein and ~4 g/kg carbs — the wrong way round
      // for someone building to a half marathon. This lands near 1.6–1.8 g/kg
      // protein and 5 g/kg carbs at a typical training TDEE.
      proteinPercent = 0.2;
      carbPercent = 0.55;
      fatPercent = 0.25;
      break;
    default: // healthy, custom
      proteinPercent = 0.25;
      carbPercent = 0.45;
      fatPercent = 0.3;
  }

  return {
    protein: Math.round((calories * proteinPercent) / 4), // 4 cal/g protein
    carbs: Math.round((calories * carbPercent) / 4), // 4 cal/g carbs
    fat: Math.round((calories * fatPercent) / 9), // 9 cal/g fat
  };
};

export const calculateTargetCalories = (tdee: number, path: string): number => {
  // An unrecognised path used to make this NaN, which then propagated all the
  // way into the meal-plan prompt as the per-meal calorie budget.
  const adjustment = PATH_ADJUSTMENTS[path as keyof typeof PATH_ADJUSTMENTS] ?? 0;
  return Math.round(tdee + adjustment);
};
