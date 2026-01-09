import { IPlan } from "../types/interfaces";

export const pathGuidelines: Record<string, string> = {
  healthy:
    "Focus on balanced nutrition with whole foods, variety, and sustainable eating habits.",
  running:
    "Focus on balanced nutrition with whole foods, variety, and sustainable eating habits. Optimize for running performance.",
  lose: "Create a caloric deficit while maintaining adequate protein and nutrients. Emphasize filling, low-calorie foods.",
  "lose-weight":
    "Create a caloric deficit while maintaining adequate protein and nutrients. Emphasize filling, low-calorie foods.",
  muscle:
    "Prioritize high protein intake, include pre/post workout meals, and ensure adequate calories for muscle growth.",
  "gain-muscle":
    "Prioritize high protein intake, include pre/post workout meals, and ensure adequate calories for muscle growth.",
  keto: "Keep carbohydrates under 20-25g daily, focus on healthy fats, moderate protein, and ketogenic-friendly foods.",
  fasting:
    "Design meals for intermittent fasting windows (16:8 or 14:10), with nutrient-dense, satisfying foods.",
  custom:
    "Create a flexible plan that can be customized based on user dietary restrictions.",
};

export const workoutCategories = {
  cardio: "Cardio",
  strength: "Strength",
  flexibility: "Flexibility",
  balance: "Balance",
  endurance: "Endurance",
  yoga: "Yoga",
  pilates: "Pilates",
  hiit: "HIIT",
  running: "Running",
  cycling: "Cycling",
  swimming: "Swimming",
  walking: "Walking",
  bodyweight: "Bodyweight",
  weights: "Weights",
  core: "Core",
  stretching: "Stretching",
};

export const isPlanExpired = (plan: IPlan): boolean => {
  if (!plan?.weeklyPlan) return false;
  const dates = Object.keys(plan.weeklyPlan).sort();
  if (dates.length === 0) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDateStr = dates[dates.length - 1];
  const lastDate = new Date(lastDateStr);
  lastDate.setHours(0, 0, 0, 0);
  return lastDate < today;
};
