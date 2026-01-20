import { IUserData } from "../types/interfaces";
import bcrypt from "bcrypt";
import mongoose, { CallbackError, Schema } from "mongoose";

// Model name constant
export const User = { name: "User" };

// Badge schema for embedded documents
const badgeSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, required: true },
    earnedAt: { type: Date, required: true, default: Date.now },
    category: {
      type: String,
      enum: ["streak", "meals", "nutrition", "milestone", "special", "consistency", "hydration"],
      required: true,
    },
  },
  { _id: false }
);

// Weekly summary schema for habit tracking
const weeklySummarySchema = new Schema(
  {
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    daysTracked: { type: Number, default: 0 },
    consistencyScore: { type: Number, default: 0 },
    avgCalories: { type: Number, default: 0 },
    avgProtein: { type: Number, default: 0 },
    avgCarbs: { type: Number, default: 0 },
    avgFat: { type: Number, default: 0 },
    calorieGoalHitDays: { type: Number, default: 0 },
    avgWaterGlasses: { type: Number, default: 0 },
    waterGoalHitDays: { type: Number, default: 0 },
    achievements: { type: [String], default: [] },
    bestDay: { type: String, default: null },
    motivationalMessage: { type: String, default: "" },
    focusAreaForNextWeek: { type: String, default: "" },
  },
  { _id: false }
);

// Engagement schema for habit-focused tracking
const engagementSchema = new Schema(
  {
    // Legacy fields (kept for backward compatibility during migration)
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },

    // NEW: Habit Score System (0-100 based on consistency)
    habitScore: { type: Number, default: 0 },

    // Streak tracking (renamed for clarity)
    streakDays: { type: Number, default: 0 }, // Current consistency streak
    longestStreak: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: null }, // YYYY-MM-DD format

    // NEW: Weekly tracking
    weeklyConsistency: { type: Number, default: 0 }, // % of days tracked this week
    weeklyGoalsHit: { type: Number, default: 0 }, // Count of daily goals achieved this week

    // Totals
    totalMealsLogged: { type: Number, default: 0 },
    totalDaysTracked: { type: Number, default: 0 },

    // Badges (health-focused)
    badges: { type: [badgeSchema], default: [] },

    // Streak freeze
    streakFreezeAvailable: { type: Boolean, default: true },
    streakFreezeUsedAt: { type: Date, default: null },

    // NEW: Weekly summaries
    lastWeeklySummary: { type: Date, default: null },
    weeklySummaries: { type: [weeklySummarySchema], default: [] },
  },
  { _id: false }
);

// Notification preferences schema
const notificationPreferencesSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    mealReminders: {
      enabled: { type: Boolean, default: true },
      breakfast: { enabled: { type: Boolean, default: true }, time: { type: String, default: "08:00" } },
      lunch: { enabled: { type: Boolean, default: true }, time: { type: String, default: "12:00" } },
      dinner: { enabled: { type: Boolean, default: true }, time: { type: String, default: "19:00" } },
      snacks: { enabled: { type: Boolean, default: false }, time: { type: String, default: "15:00" } },
    },
    streakAlerts: {
      enabled: { type: Boolean, default: true },
      warningTime: { type: String, default: "20:00" },
    },
    challengeUpdates: {
      enabled: { type: Boolean, default: true },
      onComplete: { type: Boolean, default: true },
      onExpiring: { type: Boolean, default: true },
    },
    achievements: {
      enabled: { type: Boolean, default: true },
      levelUp: { type: Boolean, default: true },
      badgeEarned: { type: Boolean, default: true },
    },
    weeklySummary: {
      enabled: { type: Boolean, default: true },
      dayOfWeek: { type: Number, default: 0 }, // Sunday
      time: { type: String, default: "09:00" },
    },
    dailySummary: {
      enabled: { type: Boolean, default: false },
      time: { type: String, default: "21:00" },
    },
    motivationalNudges: {
      enabled: { type: Boolean, default: true },
      frequency: { type: String, enum: ["daily", "weekly", "occasional"], default: "occasional" },
    },
    quietHours: {
      enabled: { type: Boolean, default: true },
      start: { type: String, default: "22:00" },
      end: { type: String, default: "08:00" },
    },
  },
  { _id: false }
);

// project schema - All fields are optional for debugging
const userSchemaDefinition = {
  name: { type: String, required: false },
  email: { type: String, required: false },
  password: { type: String, required: false }, // Add password field for OAuth users
  phone: { type: String, required: false },
  profilePicture: { type: String, required: false },
  age: { type: Number, required: false },
  gender: { type: String, required: false },
  height: { type: Number, required: false },
  weight: { type: Number, required: false },
  path: { type: String, required: false },
  targetWeight: { type: Number, required: false },
  allergies: { type: [String], required: false, default: [] },
  dietaryRestrictions: { type: [String], required: false, default: [] },
  foodPreferences: { type: [String], required: false, default: [] }, // food preferences from KYC (e.g., "Italian", "Seafood")
  favoriteMeals: { type: [String], required: false, default: [] }, // actual meal IDs that user has favorited
  dislikes: { type: [String], required: false, default: [] }, // disliked meals/foods
  fastingHours: { type: Number, required: false }, // For 8-16 fasting diet type
  fastingStartTime: { type: String, required: false }, // Fasting start time
  preferences: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: false,
    default: new Map(),
  },
  // Health metrics
  workoutFrequency: { type: Number, required: false }, // Number of workouts per week
  bmr: { type: Number, required: false }, // Basal Metabolic Rate
  tdee: { type: Number, required: false }, // Total Daily Energy Expenditure
  idealWeight: { type: Number, required: false },
  // Premium status
  isPremium: { type: Boolean, default: false, required: false },
  // OAuth fields
  oauthProvider: { type: String, required: false }, // 'google', 'facebook', or null
  oauthId: { type: String, required: false }, // OAuth provider's user ID
  // Engagement/Gamification
  engagement: {
    type: engagementSchema,
    default: () => ({
      // Legacy (kept for migration)
      xp: 0,
      level: 1,
      // Habit Score System
      habitScore: 0,
      // Streaks
      streakDays: 0,
      longestStreak: 0,
      lastActiveDate: null,
      // Weekly tracking
      weeklyConsistency: 0,
      weeklyGoalsHit: 0,
      // Totals
      totalMealsLogged: 0,
      totalDaysTracked: 0,
      badges: [],
      // Streak freeze
      streakFreezeAvailable: true,
      streakFreezeUsedAt: null,
      // Weekly summaries
      lastWeeklySummary: null,
      weeklySummaries: [],
    }),
  },
  // Notification preferences
  notificationPreferences: {
    type: notificationPreferencesSchema,
    default: () => ({
      enabled: true,
      mealReminders: {
        enabled: true,
        breakfast: { enabled: true, time: "08:00" },
        lunch: { enabled: true, time: "12:00" },
        dinner: { enabled: true, time: "19:00" },
        snacks: { enabled: false, time: "15:00" },
      },
      streakAlerts: { enabled: true, warningTime: "20:00" },
      challengeUpdates: { enabled: true, onComplete: true, onExpiring: true },
      achievements: { enabled: true, levelUp: true, badgeEarned: true },
      weeklySummary: { enabled: true, dayOfWeek: 0, time: "09:00" },
      dailySummary: { enabled: false, time: "21:00" },
      motivationalNudges: { enabled: true, frequency: "occasional" },
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
    }),
  },
  // Device tokens for push notifications
  deviceTokens: { type: [String], default: [] },
};

// Export schema for NestJS
export const UserSchema = new Schema(userSchemaDefinition, {
  timestamps: true,
  versionKey: false,
  strict: true, // Prevent arbitrary data injection - only allow defined fields
  collection: "users",
});

// Apply the same pre-save hook and methods to the exported schema
UserSchema.pre("save", async function (next) {
  if (
    !this.isModified("password") ||
    (this as any).password?.startsWith("google_oauth_") ||
    (this as any).password?.startsWith("facebook_oauth_")
  ) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    (this as any).password = await bcrypt.hash((this as any).password, salt);
    next();
  } catch (error) {
    next(error as CallbackError);
  }
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string
) {
  if (
    (this as any).password?.startsWith("google_oauth_") ||
    (this as any).password?.startsWith("facebook_oauth_")
  ) {
    return false;
  }
  return bcrypt.compare(candidatePassword, (this as any).password);
};

// Index for email lookups (unique)
UserSchema.index({ email: 1 }, { unique: true, sparse: true });

// Index for OAuth lookups
UserSchema.index({ oauthProvider: 1, oauthId: 1 });
