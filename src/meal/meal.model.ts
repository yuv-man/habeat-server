import mongoose, { Schema } from "mongoose";
import { IMeal } from "../types/interfaces";

// Model name constant for NestJS
export const Meal = { name: "Meal" };

const mealSchema = new Schema(
  {
    // Core meal data
    name: String,
    // Plain English reference name for the same dish (client-side image matching
    // when `name` is localized, e.g. Hebrew). Optional — omitted for English plans.
    nameEn: String,
    category: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snack"],
    },
    calories: Number,
    tags: [String],
    macros: { protein: Number, carbs: Number, fat: Number },
    ingredients: [[String, String]], // Array of tuples [name, amount]
    prepTime: Number,
    benefits: [String],

    // Versioning for AI iterations
    version: { type: Number, default: 1 },
    parentMealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal" },
    variations: [{ type: mongoose.Schema.Types.ObjectId, ref: "Meal" }],

    // AI tracking
    aiGenerated: { type: Boolean, default: false },
    generationContext: {
      aiModel: String,
      prompt: String,
      userPreferences: mongoose.Schema.Types.Mixed,
      generatedAt: Date,
    },

    // Worked out in code from the meal itself (meal-labels.ts): which diets it
    // fits, its main proteins, macro shape. What lets a plan take this meal
    // from the library instead of paying the model to write a new one.
    labels: { type: mongoose.Schema.Types.Mixed, default: undefined },

    // Usage and learning
    analytics: {
      timesGenerated: { type: Number, default: 0 },
      timesCompleted: { type: Number, default: 0 },
      averageRating: Number,
      tags: [String], // Auto-generated tags based on usage patterns
    },
  },
  {
    timestamps: true,
    collection: "meals",
  }
);

// Index for name lookups (case-insensitive search)
mealSchema.index({ name: 1 });

// Compound index for category + name lookups
mealSchema.index({ category: 1, name: 1 });

// Index for analytics signature (used for deduplication)
mealSchema.index({ "analytics.signature": 1 });

// Index for AI-generated meals lookup
mealSchema.index({ aiGenerated: 1 });
mealSchema.index({ category: 1, "labels.version": 1, calories: 1 });

export const MealSchema = mealSchema;
