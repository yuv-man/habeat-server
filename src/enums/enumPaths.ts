
// Activity level multipliers for TDEE calculation
export const ACTIVITY_MULTIPLIERS = {
    sedentary: 1.2,     // Little or no exercise
    light: 1.375,       // Light exercise 1-3 days/week
    moderate: 1.55,     // Moderate exercise 3-5 days/week
    active: 1.725,      // Hard exercise 6-7 days/week
    very_active: 1.9    // Physical job + exercise or 2x/day training
  };
  
  // Path-specific calorie adjustments
export const PATH_ADJUSTMENTS = {
    healthy: 0,         // Maintain current weight
    lose: -500,         // 500 calorie deficit for 1lb/week loss
    muscle: 300,        // 300 calorie surplus for muscle gain
    keto: -200,         // Slight deficit for keto
    fasting: -300,      // Moderate deficit for IF
    custom: 0           // User-defined
};

export const PATH_WATER_INTAKE = {
  healthy: 8,          // ~2 liters: standard daily recommendation
  lose: 10,            // ~2.5 liters: helps metabolism and reduces appetite
  muscle: 12,          // ~3 liters: supports muscle recovery and protein metabolism
  keto: 12,            // ~3 liters: combats dehydration caused by low-carb diets
  fasting: 10,         // ~2.5 liters: important to stay hydrated while not eating
  custom: 0            // to be calculated based on user's weight, age, activity, etc.   
}

export const PATH_WORKOUTS_GOAL = {
  healthy: 3,     // general wellness: moderate activity 3x/week
  lose: 5,        // weight loss: mix of cardio and strength most days
  muscle: 5,      // muscle gain: strength training 4–6x/week
  keto: 4,        // moderate workouts recommended to avoid fatigue
  fasting: 3,     // lower-intensity workouts to match fasting energy levels
  custom: 1       // placeholder to be adjusted based on user input
}
