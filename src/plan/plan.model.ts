import { Schema } from "mongoose";
import { IDayPlan, IPlan, IWorkout } from "../types/interfaces";
import { COOKING_LEVELS } from "../constants/cookingLevel";

// Model name constant for NestJS
export const Plan = { name: "Plan" };

// Ingredients schema: array of tuples [name, amount]
const ingredientTupleSchema = new Schema(
  {
    name: { type: String, required: true },
    amount: { type: String, required: true },
  },
  { _id: false }
);

const embeddedMealSchema = new Schema(
  {
    name: { type: String, required: true },
    calories: { type: Number, required: true },
    macros: {
      protein: { type: Number, required: true },
      carbs: { type: Number, required: true },
      fat: { type: Number, required: true },
    },
    category: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snack"],
      required: true,
    },
    ingredients: [ingredientTupleSchema], // Array of [name, amount] tuples
    prepTime: { type: Number, required: true },
    // Where the food actually came from, when the user told us. Absent means
    // unanswered, never "cooked" — the Brain's takeaway detection (P08) treats
    // a missing answer as no evidence rather than as home cooking.
    source: {
      type: String,
      enum: ["cooked", "ordered", "eaten-out"],
      required: false,
    },
    _id: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
  },
  { _id: false }
);

const workoutSchema = new Schema<IWorkout>({
  name: { type: String, required: true },
  category: { type: String, required: true },
  duration: { type: Number, required: true },
  caloriesBurned: { type: Number, required: true },
  time: { type: String, required: false }, // Scheduled time in HH:MM format
});

const dayPlanSchema = new Schema<IDayPlan>(
  {
    meals: {
      breakfast: embeddedMealSchema,
      lunch: embeddedMealSchema,
      dinner: embeddedMealSchema,
      snacks: [embeddedMealSchema],
    },
    workouts: [workoutSchema],
    waterIntake: { type: Number, required: true },
  },
  { _id: false }
);

const planSchema = new Schema<IPlan>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      unique: true, // Each user can have only ONE plan (creates unique index)
    },
    title: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
    },
    userMetrics: {
      bmr: { type: Number, required: false },
      tdee: { type: Number, required: false },
      targetCalories: { type: Number, required: false },
      idealWeight: { type: Number, required: false },
      weightRange: { type: String, required: false },
      dailyMacros: {
        protein: { type: Number, required: false },
        carbs: { type: Number, required: false },
        fat: { type: Number, required: false },
      },
    },
    userData: {
      age: { type: Number, required: false },
      gender: { type: String, enum: ["male", "female"], required: false },
      height: { type: Number, required: false },
      weight: { type: Number, required: false },
      workoutFrequency: { type: Number, required: false },
      path: { type: String, required: false },
      targetWeight: { type: Number, required: false },
      allergies: { type: [String], required: false, default: [] },
      dietaryRestrictions: { type: [String], required: false, default: [] },
      foodPreferences: { type: [String], required: false, default: [] }, // food preferences from KYC
      dislikes: { type: [String], required: false, default: [] },
      fastingHours: { type: Number, required: false },
      fastingStartTime: { type: String, required: false },
      cookingLevel: { type: String, enum: COOKING_LEVELS, required: false },
    },
    weeklyPlan: {
      type: Schema.Types.Mixed,
      default: {},
    },
    weeklyMacros: {
      calories: {
        consumed: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      protein: {
        consumed: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      carbs: {
        consumed: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      fat: {
        consumed: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
    },
    language: {
      type: String,
      default: "en",
    },
    generationStatus: {
      type: String,
      enum: ["generating", "complete", "failed"],
      default: "generating",
    },
    // How close this plan lands to its targets: mean absolute error per macro
    // across its days, as a share of target (generator/macro-targets.ts).
    // Stored so accuracy is measurable over time rather than asserted.
    macroAccuracy: {
      protein: { type: Number, required: false },
      carbs: { type: Number, required: false },
      fat: { type: Number, required: false },
      calories: { type: Number, required: false },
    },
  },
  {
    timestamps: true,
    collection: "plans",
  }
);

// Note: userId already has a unique index from unique: true above
// No need for additional index

// Index for timestamp-based queries
planSchema.index({ createdAt: -1 });

export const PlanSchema = planSchema;
