import mongoose, { Schema } from "mongoose";
import { IMeal } from "../types/interfaces";

// Model name constant for NestJS
export const Meal = { name: "Meal" };

const mealSchema = new Schema(
  {
    // Core meal data
    name: String,
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

export const MealSchema = mealSchema;
