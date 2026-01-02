// Activity level multipliers for TDEE calculation
export const WORKOUT_FREQUENCY_MULTIPLIERS = {
  1: 1.2, // Little or no exercise
  2: 1.375, // Light exercise 1-3 days/week
  3: 1.55, // Moderate exercise 3-5 days/week
  4: 1.725, // Hard exercise 6-7 days/week
  5: 1.9, // Physical job + exercise or 2x/day training
};

// Path-specific calorie adjustments
export const PATH_ADJUSTMENTS: Record<string, number> = {
  healthy: 0, // Maintain current weight
  running: 0, // Same as healthy
  lose: -500, // 500 calorie deficit for 1lb/week loss
  "lose-weight": -500, // Same as lose
  muscle: 300, // 300 calorie surplus for muscle gain
  "gain-muscle": 300, // Same as muscle
  keto: -200, // Slight deficit for keto
  fasting: -300, // Moderate deficit for IF
  custom: 0, // User-defined
};

export const PATH_WATER_INTAKE: Record<string, number> = {
  healthy: 8, // ~2 liters: standard daily recommendation
  running: 8, // Same as healthy
  lose: 10, // ~2.5 liters: helps metabolism and reduces appetite
  "lose-weight": 10, // Same as lose
  muscle: 12, // ~3 liters: supports muscle recovery and protein metabolism
  "gain-muscle": 12, // Same as muscle
  keto: 12, // ~3 liters: combats dehydration caused by low-carb diets
  fasting: 10, // ~2.5 liters: important to stay hydrated while not eating
  custom: 0, // to be calculated based on user's weight, age, activity, etc.
};

export const PATH_WORKOUTS_GOAL: Record<string, number> = {
  healthy: 3, // general wellness: moderate activity 3x/week
  running: 3, // Same as healthy
  lose: 5, // weight loss: mix of cardio and strength most days
  "lose-weight": 5, // Same as lose
  muscle: 5, // muscle gain: strength training 4–6x/week
  "gain-muscle": 5, // Same as muscle
  keto: 4, // moderate workouts recommended to avoid fatigue
  fasting: 3, // lower-intensity workouts to match fasting energy levels
  custom: 1, // placeholder to be adjusted based on user input
};
