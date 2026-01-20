import mongoose, { Document } from "mongoose";

// Badge earned by user
export interface IBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: Date;
  category: "streak" | "meals" | "nutrition" | "milestone" | "special" | "consistency" | "hydration";
}

// Weekly summary for habit tracking
export interface IWeeklySummary {
  weekStart: Date;
  weekEnd: Date;
  daysTracked: number;
  consistencyScore: number;
  avgCalories: number;
  avgProtein: number;
  avgCarbs: number;
  avgFat: number;
  calorieGoalHitDays: number;
  avgWaterGlasses: number;
  waterGoalHitDays: number;
  achievements: string[];
  bestDay: string | null;
  motivationalMessage: string;
  focusAreaForNextWeek: string;
}

// User engagement state for habit tracking
export interface IUserEngagement {
  // Legacy fields (kept for backward compatibility)
  xp: number;
  level: number;
  // Habit Score System (primary)
  habitScore: number;
  streakDays: number;
  longestStreak: number;
  lastActiveDate: string; // YYYY-MM-DD format
  // Weekly tracking
  weeklyConsistency: number;
  weeklyGoalsHit: number;
  // Totals
  totalMealsLogged: number;
  totalDaysTracked: number;
  badges: IBadge[];
  streakFreezeAvailable: boolean;
  streakFreezeUsedAt?: Date;
  // Weekly summaries
  lastWeeklySummary?: Date;
  weeklySummaries: IWeeklySummary[];
}

// Habit-based challenge types
export type HabitChallengeType =
  | "daily_logging"      // Log all meals for X days
  | "breakfast_habit"    // Log breakfast X days in a row
  | "hydration_habit"    // Hit water goal X days
  | "balanced_eating"    // Balanced macros X days
  | "protein_focus"      // Hit protein goal X days
  | "mindful_eating"     // Log meals consistently
  | "meal_consistency"   // Don't skip any meals X days
  | "weekly_streak";     // Complete full week of tracking

// Legacy challenge types (kept for backward compatibility)
export type ChallengeType =
  | HabitChallengeType
  | "meals_logged"
  | "water_intake"
  | "streak_days"
  | "veggie_meals"
  | "protein_goal"
  | "workout_complete"
  | "balanced_meals"
  | "home_cooking";

export type ChallengeStatus = "active" | "completed" | "expired" | "claimed";
export type ChallengeDifficulty = "starter" | "building" | "established";

export interface IChallenge {
  _id?: string;
  userId: string;
  type: ChallengeType;
  title: string;
  description: string;
  icon: string;
  target: number; // Goal to achieve
  progress: number; // Current progress
  daysRequired: number; // Duration of the habit challenge
  difficulty: ChallengeDifficulty;
  status: ChallengeStatus;
  badgeId?: string; // Badge awarded on completion
  startDate: Date;
  endDate: Date; // Challenge expires after this
  completedAt?: Date;
  claimedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUserData {
  email: string;
  password: string;
  name: string;
  phone?: string;
  picture?: string;
  age: number;
  gender: "male" | "female";
  height: number; // in cm
  weight: number; // in kg
  path:
    | "keto"
    | "healthy"
    | "gain-muscle"
    | "running"
    | "lose-weight"
    | "fasting";
  targetWeight?: number; // optional target weight
  allergies?: string[]; // food allergies
  dietaryRestrictions?: string[]; // dietary restrictions
  foodPreferences?: string[]; // food preferences from KYC (e.g., "Italian", "Seafood", "Spicy")
  favoriteMeals?: string[]; // actual meal IDs that user has favorited
  dislikes?: string[]; // disliked meals
  fastingHours?: number; // For 8-16 fasting diet type
  fastingStartTime?: string;
  workoutFrequency?: number; // Number of workouts per week
  bmr?: number; // Basal Metabolic Rate
  tdee?: number; // Total Daily Energy Expenditure
  idealWeight?: number;
  isPremium?: boolean;
  oauthProvider?: "google" | "facebook";
  preferences: { [key: string]: string | boolean | number };
  oauthId?: string;
  token?: string;
  language?: string;
  // Engagement/Gamification fields
  engagement?: IUserEngagement;
  // Notification preferences
  notificationPreferences?: INotificationPreferences;
  deviceTokens?: string[]; // FCM/APNs tokens for push notifications
  createdAt?: Date;
  updatedAt?: Date;
  comparePassword?: (candidatePassword: string) => Promise<boolean>;
}

export interface IMeal {
  _id: string;
  name: string;
  ingredients: [string, string, string?][]; // Array of tuples: [name, amount, category?] - category is optional for backward compatibility
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  category: "breakfast" | "lunch" | "dinner" | "snack";
  prepTime: number;
  usageCount?: number;
}

// Meal with done status (used in day plans)
export interface IMealWithStatus extends IMeal {
  done: boolean;
}

// Daily Plan - part of weeklyPlan, basic structure without progress tracking
export interface IDayPlan {
  meals: {
    breakfast: IMeal | null;
    lunch: IMeal | null;
    dinner: IMeal | null;
    snacks: IMeal[];
  };
  workouts: IWorkout[];
  waterIntake: number; // in glasses
}

// Workout with done status
export interface IWorkoutWithStatus extends IWorkout {
  done?: boolean;
}

// Day plan with metadata (day name and formatted date)
export interface IDayPlanWithMetadata extends IDayPlan {
  day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";
  date: string; // Formatted date like "Dec 4"
}

// AI response interfaces
export interface IAIMealData {
  name: string;
  category: "breakfast" | "lunch" | "dinner" | "snack";
  tags?: string[];
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  ingredients: string[] | [string, string][] | [string, string, string?][]; // Can be string array or tuple array with optional category
  prepTime: number;
  _id?: string | mongoose.Types.ObjectId;
  done?: boolean;
}

export interface IAIDayData {
  day: string;
  date?: Date | string;
  meals: {
    breakfast?: IAIMealData;
    lunch?: IAIMealData;
    dinner?: IAIMealData;
    snacks?: IAIMealData[];
  };
  workouts?: Array<{
    name: string;
    category: string;
    duration: number;
    caloriesBurned: number;
    intensity?: string;
    done?: boolean;
  }>;
  hydration?: {
    waterTarget?: number;
    recommendations?: string[];
  };
  waterIntake?: number;
  totalCalories?: number;
  totalProtein?: number;
  totalCarbs?: number;
  totalFat?: number;
  netCalories?: number;
}

export interface IParsedWeeklyPlanResponse {
  weeklyPlan: IAIDayData[];
}

export interface IWeeklyPlanObject {
  [date: string]: IDayPlanWithMetadata;
}

export type IIngredient = [string, string, string?] | [string, string];

// Legacy interface for backward compatibility during migration
export interface IDailyPlan {
  day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";
  date: Date;
  meals: {
    breakfast: IMealWithStatus;
    lunch: IMealWithStatus;
    dinner: IMealWithStatus;
    snacks: IMealWithStatus[];
  };
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  waterIntake: number; // in glasses
  workouts: IWorkoutWithStatus[]; // calories burned through exercise
  netCalories: number;
}

export interface IPlanData {
  userData: IUserData;
  weeklyPlan: { [date: string]: IDayPlan }; // Each dailyPlan is an IDayPlan
}

export interface IWorkout {
  name: string;
  category: string;
  duration: number;
  caloriesBurned: number;
  time?: string; // Scheduled time in HH:MM format (e.g., "12:00")
}

export interface IPlan extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  userMetrics: {
    bmr: number;
    tdee: number;
    targetCalories: number;
    idealWeight: number;
    weightRange: string;
    dailyMacros: {
      protein: number;
      carbs: number;
      fat: number;
    };
  };
  userData: {
    age: number;
    gender: "male" | "female";
    height: number;
    weight: number;
    workoutFrequency: number;
    path: string;
    targetWeight?: number;
    allergies?: string[];
    dietaryRestrictions?: string[];
  };
  weeklyPlan: { [date: string]: IDayPlan }; // Key-value format: date (YYYY-MM-DD) -> dailyPlan (IDayPlan)
  weeklyMacros: {
    calories: { consumed: number; total: number };
    protein: { consumed: number; total: number };
    carbs: { consumed: number; total: number };
    fat: { consumed: number; total: number };
  };
  language: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRecipe extends Document {
  mealId: string; // Reference to the meal this recipe is for
  mealName: string; // Reference to the meal this recipe is for
  description?: string;
  category: "breakfast" | "lunch" | "dinner" | "snack";
  servings: number;
  prepTime: number;
  cookTime: number;
  difficulty: "easy" | "medium" | "hard";
  macros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  ingredients: Array<{
    name: string;
    amount: string;
    unit: string;
  }>;
  instructions: Array<{
    step: number;
    instruction: string;
    time?: number;
    temperature?: number;
  }>;
  equipment: string[];
  tags: string[];
  dietaryInfo: {
    isVegetarian: boolean;
    isVegan: boolean;
    isGlutenFree: boolean;
    isDairyFree: boolean;
    isKeto: boolean;
    isLowCarb: boolean;
  };
  language: string;
  notes?: string;
  usageCount: number; // Track how often this recipe is requested
}

export interface IMilestone {
  id?: string;
  title: string;
  targetValue: number;
  completed?: boolean;
  completedDate?: string;
}

export interface IProgressHistory {
  date: string;
  value: number;
}

export interface IGoal extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  current: number;
  target: number;
  unit: string;
  icon?: string;
  status: "active" | "achieved" | "in_progress" | "paused";
  startDate: string;
  milestones: IMilestone[];
  progressHistory: IProgressHistory[];
  createdAt: Date;
  updatedAt: Date;
}

// Daily Progress - mirrors IDayPlan structure but with done status and daily macros tracking
// This is used to track user's daily progress against their dailyPlan from weeklyPlan
export interface IDailyProgress extends Document {
  userId: mongoose.Types.ObjectId;
  date: Date;
  dateKey: string; // YYYY-MM-DD format for timezone-safe querying
  planId: mongoose.Types.ObjectId;

  // Daily macros tracking (consumed vs goal)
  caloriesConsumed: number;
  caloriesGoal: number;
  protein: {
    consumed: number;
    goal: number;
  };
  carbs: {
    consumed: number;
    goal: number;
  };
  fat: {
    consumed: number;
    goal: number;
  };

  // Water tracking
  water: {
    consumed: number;
    goal: number;
  };

  // Meals with done status (mirrors IDayPlan.meals structure)
  meals: {
    breakfast: IMealWithStatus | null;
    lunch: IMealWithStatus | null;
    dinner: IMealWithStatus | null;
    snacks: IMealWithStatus[];
  };

  // Workouts with done status (mirrors IDayPlan.workouts structure)
  workouts: IWorkoutWithStatus[];

  weight?: number; // optional daily weight tracking
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtPayload {
  id: string;
}

// Chat interfaces
export interface IProposedAction {
  type: "meal_swap" | "workout_change" | "add_snack" | "none";
  payload?: IMealSwapPayload | IWorkoutChangePayload | IAddSnackPayload;
  status: "pending" | "accepted" | "rejected" | "expired";
}

export interface IMealSwapPayload {
  dateKey: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  snackIndex?: number;
  currentMeal: {
    name: string;
    calories: number;
  };
  proposedMeal: IMeal;
  reason: string;
}

export interface IWorkoutChangePayload {
  dateKey: string;
  action: "add" | "update" | "remove";
  workoutIndex?: number;
  currentWorkout?: IWorkout;
  proposedWorkout?: IWorkout;
  reason: string;
}

export interface IAddSnackPayload {
  dateKey: string;
  proposedSnack: IMeal;
  reason: string;
}

export interface IChatMessage {
  _id?: mongoose.Types.ObjectId;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  proposedAction?: IProposedAction;
}

export interface IChat extends Document {
  userId: mongoose.Types.ObjectId;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Notification Types
export type NotificationType =
  | "meal_reminder"
  | "streak_warning"
  | "streak_broken"
  | "challenge_complete"
  | "challenge_expiring"
  | "level_up"
  | "badge_earned"
  | "weekly_summary"
  | "daily_summary"
  | "motivational";

export interface INotificationPreferences {
  enabled: boolean;
  mealReminders: {
    enabled: boolean;
    breakfast: { enabled: boolean; time: string }; // HH:MM format
    lunch: { enabled: boolean; time: string };
    dinner: { enabled: boolean; time: string };
    snacks: { enabled: boolean; time: string };
  };
  streakAlerts: {
    enabled: boolean;
    warningTime: string; // Time to warn about streak breaking (e.g., "20:00")
  };
  challengeUpdates: {
    enabled: boolean;
    onComplete: boolean;
    onExpiring: boolean; // 24h before expiry
  };
  achievements: {
    enabled: boolean;
    levelUp: boolean;
    badgeEarned: boolean;
  };
  weeklySummary: {
    enabled: boolean;
    dayOfWeek: number; // 0-6 (Sunday-Saturday)
    time: string;
  };
  dailySummary: {
    enabled: boolean;
    time: string;
  };
  motivationalNudges: {
    enabled: boolean;
    frequency: "daily" | "weekly" | "occasional";
  };
  quietHours: {
    enabled: boolean;
    start: string; // HH:MM
    end: string; // HH:MM
  };
}

export interface IScheduledNotification {
  _id?: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  scheduledAt: Date;
  sent: boolean;
  sentAt?: Date;
  data?: Record<string, any>;
  createdAt?: Date;
}
