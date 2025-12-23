import { Schema } from "mongoose";
import { IRecipe } from "../types/interfaces";

// Model name constant for NestJS
export const Recipe = { name: "Recipe" };

const recipeSchema = new Schema<IRecipe>(
  {
    mealName: {
      type: String,
      required: true,
      index: true,
    },
    mealId: {
      type: String,
      required: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snack"],
      required: true,
      index: true,
    },
    servings: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
    },
    prepTime: { type: Number, required: true, min: 0 },
    cookTime: { type: Number, required: true, min: 0 },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    macros: {
      calories: { type: Number, required: true },
      protein: { type: Number, required: true },
      carbs: { type: Number, required: true },
      fat: { type: Number, required: true },
    },
    ingredients: [
      {
        name: { type: String, required: true },
        amount: { type: String, required: true },
        unit: { type: String, required: true },
      },
    ],
    instructions: [
      {
        step: { type: Number, required: true },
        instruction: { type: String, required: true },
        time: { type: Number },
        temperature: { type: Number },
      },
    ],
    equipment: [{ type: String }],
    tags: [{ type: String }],
    dietaryInfo: {
      isVegetarian: { type: Boolean, default: false },
      isVegan: { type: Boolean, default: false },
      isGlutenFree: { type: Boolean, default: false },
      isDairyFree: { type: Boolean, default: false },
      isKeto: { type: Boolean, default: false },
      isLowCarb: { type: Boolean, default: false },
    },
    language: { type: String, default: "en" },
    usageCount: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    collection: "recipes",
  }
);

// Indexes for efficient recipe lookups
recipeSchema.index({ mealName: 1, language: 1 });
recipeSchema.index({ category: 1, "macros.calories": 1 });
recipeSchema.index({ usageCount: -1 });

export const RecipeSchema = recipeSchema;
