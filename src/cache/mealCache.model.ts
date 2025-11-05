import mongoose, { Schema } from 'mongoose';
import { IMealCache } from '../types/interfaces';
  
  const mealCacheSchema = new Schema<IMealCache>({
    mealName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    category: {
      type: String,
      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
      required: true,
      index: true
    },
    calories: {
      type: Number,
      required: true,
      index: true
    },
    calorieRange: {
      type: String,
      required: true,
      index: true
    },
    protein: { type: Number, required: true },
    carbs: { type: Number, required: true },
    fat: { type: Number, required: true },
    ingredients: [{ type: String }],
    path: {
      type: String,
      enum: ['healthy', 'lose', 'muscle', 'keto', 'fasting', 'custom'],
      required: true,
      index: true
    },
    dietaryTags: [{ type: String, index: true }],
    language: {
      type: String,
      default: 'en',
      index: true
    },
    usageCount: {
      type: Number,
      default: 1
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }, {
    timestamps: true
  });
  
  // Compound indexes for efficient meal matching
  mealCacheSchema.index({ category: 1, calorieRange: 1, path: 1 });
  mealCacheSchema.index({ mealName: 1, language: 1 });
  mealCacheSchema.index({ dietaryTags: 1, category: 1 });
  mealCacheSchema.index({ usageCount: -1, lastUsed: -1 }); // Popular meals first
  
  export const MealCache = mongoose.model<IMealCache>('MealCache', mealCacheSchema);
 