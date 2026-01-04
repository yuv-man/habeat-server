// Approximate MET values for each workout type
const WORKOUT_METS: Record<string, number> = {
  cardio: 8.0,
  calistenics: 6.0,
  climbing: 8.0,
  skating: 7.0,
  surfing: 5.0,
  strength: 5.0,
  flexibility: 2.5,
  balance: 2.5,
  endurance: 7.0,
  yoga: 3.0,
  pilates: 3.0,
  hiit: 11.0,
  running: 9.8,
  cycling: 7.5,
  swimming: 8.0,
  walking: 3.8,
  bodyweight: 5.0,
  weights: 5.0,
  core: 3.5,
  stretching: 2.3,
  basketball: 8.0,
  football: 8.0,
  soccer: 8.0,
  tennis: 7.3,
  volleyball: 4.0,
  "beach-volleyball": 8.0,
  boxing: 12.0,
  squash: 12.0,
  paddle: 6.0,
  paddleboarding: 6.0,
  kayaking: 5.0,
  canoeing: 5.0,
};

// Helper to generate the prompt string
export const getWorkoutBurnRatesString = (): string => {
  return Object.entries(WORKOUT_METS)
    .map(([type, met]) => `${type}: ${met} MET`)
    .join(", ");
};

// Optional: A JS function if you ever need to calculate it manually in your app
export const calculateWorkoutCalories = (
  type: string,
  durationMinutes: number,
  weightKg: number
): number => {
  const met = WORKOUT_METS[type.toLowerCase()] || 5.0; // Default to moderate
  // Formula: (MET * 3.5 * weight * mins) / 200
  return Math.round((met * 3.5 * weightKg * durationMinutes) / 200);
};
