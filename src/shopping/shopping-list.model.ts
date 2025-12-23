import mongoose, { Document, Schema } from "mongoose";

export interface IShoppingListIngredient {
  name: string;
  amount: string;
  category?: string;
  done: boolean;
  key: string;
}

export interface IShoppingList extends Document {
  userId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  ingredients: IShoppingListIngredient[];
  createdAt: Date;
  updatedAt: Date;
}

// Model name constant for NestJS
export const ShoppingList = { name: "ShoppingList" };

const shoppingListIngredientSchema = new Schema(
  {
    name: { type: String, required: true },
    amount: { type: String, default: "" },
    category: { type: String },
    done: { type: Boolean, default: false },
    key: { type: String, required: true },
  },
  { _id: false }
);

const shoppingListSchema = new Schema<IShoppingList>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
      index: true,
    },
    ingredients: {
      type: [shoppingListIngredientSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "shoppinglists",
  }
);

// Compound index to ensure one shopping list per user per plan
shoppingListSchema.index({ userId: 1, planId: 1 }, { unique: true });

export const ShoppingListSchema = shoppingListSchema;
