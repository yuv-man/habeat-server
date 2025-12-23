import { Schema } from "mongoose";
import { IDailyProgress } from "../types/interfaces";

// Model name constant for NestJS
export const DailyProgress = { name: "DailyProgress" };

const mealSnapshotSchema = new Schema(
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
    prepTime: { type: Number, required: true },
    done: { type: Boolean, required: true, default: false },
    _id: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
  },
  { _id: false }
);

const dailyProgressSchema = new Schema<IDailyProgress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // dateKey is YYYY-MM-DD string for timezone-safe querying
    dateKey: {
      type: String,
      required: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    caloriesConsumed: {
      type: Number,
      required: true,
      default: 0,
    },
    caloriesGoal: {
      type: Number,
      required: true,
      default: 2000,
    },
    water: {
      consumed: {
        type: Number,
        required: true,
        default: 0,
      },
      goal: {
        type: Number,
        required: true,
        default: 8,
      },
    },
    workouts: [
      {
        name: {
          type: String,
          required: true,
        },
        category: {
          type: String,
          required: true,
        },
        duration: {
          type: Number,
          required: true,
        },
        caloriesBurned: {
          type: Number,
          required: true,
        },
        time: {
          type: String,
          required: false, // Scheduled time in HH:MM format
        },
        done: {
          type: Boolean,
          required: true,
        },
      },
    ],
    meals: {
      breakfast: mealSnapshotSchema,
      lunch: mealSnapshotSchema,
      dinner: mealSnapshotSchema,
      snacks: [mealSnapshotSchema],
    },
    protein: {
      consumed: { type: Number, default: 0 },
      goal: { type: Number, default: 0 },
    },
    carbs: {
      consumed: { type: Number, default: 0 },
      goal: { type: Number, default: 0 },
    },
    fat: {
      consumed: { type: Number, default: 0 },
      goal: { type: Number, default: 0 },
    },
    weight: {
      type: Number,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: "progress",
  }
);

// Compound index for efficient queries by user and dateKey (unique per user per day)
dailyProgressSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

// Index for dateKey queries
dailyProgressSchema.index({ dateKey: 1 });

// Keep date index for backwards compatibility
dailyProgressSchema.index({ date: 1 });

export const DailyProgressSchema = dailyProgressSchema;
