import mongoose, { Document, Schema } from 'mongoose';
import { IShoppingListCache } from '../types/interfaces';
  
  const shoppingListCacheSchema = new Schema<IShoppingListCache>({
    ingredientsHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    ingredients: [{ type: String }],
    path: {
      type: String,
      enum: ['healthy', 'lose', 'muscle', 'keto', 'fasting', 'custom'],
      required: true
    },
    language: {
      type: String,
      default: 'en',
      index: true
    },
    shoppingList: {
      type: String,
      required: true
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
  
  export const ShoppingListCache = mongoose.model<IShoppingListCache>('ShoppingListCache', shoppingListCacheSchema);
  