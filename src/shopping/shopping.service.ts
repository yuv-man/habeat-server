import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import {
  ShoppingList,
  IShoppingList,
  IShoppingListIngredient,
} from "./shopping-list.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { IPlan } from "../types/interfaces";

@Injectable()
export class ShoppingService {
  constructor(
    @InjectModel(ShoppingList.name)
    private shoppingListModel: Model<IShoppingList>,
    @InjectModel(Plan.name)
    private planModel: Model<IPlan>
  ) {}

  // Helper to normalize ingredient keys
  private normalizeIngredientKey(ingredientName: string): string {
    return ingredientName
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }

  // Parse amount string like "200 g" into { value: 200, unit: "g" }
  private parseAmount(
    amountStr: string
  ): { value: number; unit: string } | null {
    if (!amountStr) return null;
    const match = amountStr.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      return {
        value: parseFloat(match[1]),
        unit: match[2].trim().toLowerCase(),
      };
    }
    return null;
  }

  // Format amount back to string
  private formatAmount(value: number, unit: string): string {
    const formattedValue =
      value % 1 === 0 ? value.toString() : value.toFixed(1);
    return unit ? `${formattedValue} ${unit}` : formattedValue;
  }

  // Helper to format amounts map back to string
  private formatAmounts(amounts: Map<string, number>): string {
    const parts: string[] = [];
    amounts.forEach((value, unit) => {
      const formattedValue =
        value % 1 === 0 ? value.toString() : value.toFixed(1);
      parts.push(unit ? `${formattedValue} ${unit}` : formattedValue);
    });
    return parts.join(" + ") || "";
  }

  async generateShoppingList(planId: string) {
    const plan = await this.planModel.findById(planId);
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    // Check if shopping list already exists with ingredients
    const existingShoppingList = await this.shoppingListModel.findOne({
      userId: plan.userId,
      planId: plan._id,
    });

    // If shopping list exists and has ingredients, return it without regenerating
    if (
      existingShoppingList &&
      existingShoppingList.ingredients &&
      existingShoppingList.ingredients.length > 0
    ) {
      return {
        success: true,
        data: {
          ingredients: existingShoppingList.ingredients,
        },
      };
    }

    // Generate shopping list from plan ingredients
    const allIngredients: ([string, string] | [string, string, string?])[] = [];
    const weeklyPlan = (plan as any).weeklyPlan || {};
    for (const dayPlan of Object.values(weeklyPlan) as any[]) {
      const meals = [
        dayPlan.meals.breakfast,
        dayPlan.meals.lunch,
        dayPlan.meals.dinner,
        ...(dayPlan.meals.snacks || []),
      ];
      for (const meal of meals) {
        if (meal?.ingredients && Array.isArray(meal.ingredients)) {
          meal.ingredients.forEach((ing: any) => {
            if (Array.isArray(ing)) {
              // Tuple format: [name, amount] or [name, amount, category]
              allIngredients.push(
                ing as [string, string] | [string, string, string?]
              );
            } else if (typeof ing === "string") {
              // String format: just the name
              allIngredients.push([ing, ""]);
            } else if (ing && typeof ing === "object" && ing.name) {
              // Object format: {name: string, amount: string, category?: string}
              const tuple: [string, string, string?] = [
                ing.name || "",
                ing.amount || "",
                ing.category,
              ];
              allIngredients.push(tuple);
            }
          });
        }
      }
    }

    // Aggregate ingredients by name (sum amounts for same ingredient)
    const ingredientMap = new Map<
      string,
      {
        name: string;
        amounts: Map<string, number>;
        category?: string;
      }
    >();

    allIngredients.forEach((ing) => {
      // Handle different ingredient formats
      let ingredientName: string;
      let ingredientAmount: string;
      let ingredientCategory: string | undefined;

      if (Array.isArray(ing)) {
        // Tuple format: [name, amount] or [name, amount, category]
        ingredientName = ing[0] || "";
        ingredientAmount = ing[1] || "";
        ingredientCategory = ing.length > 2 ? ing[2] : undefined;
      } else if (typeof ing === "string") {
        // String format: just the name
        ingredientName = ing;
        ingredientAmount = "";
        ingredientCategory = undefined;
      } else {
        // Invalid format - skip
        return;
      }

      // Skip if name is empty
      if (!ingredientName || ingredientName.trim() === "") {
        return;
      }

      const key = this.normalizeIngredientKey(ingredientName);

      const parsed = this.parseAmount(ingredientAmount);

      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key)!;
        if (parsed) {
          const currentAmount = existing.amounts.get(parsed.unit) || 0;
          existing.amounts.set(parsed.unit, currentAmount + parsed.value);
        }
        if (!existing.category && ingredientCategory) {
          existing.category = ingredientCategory;
        }
      } else {
        const amounts = new Map<string, number>();
        if (parsed) {
          amounts.set(parsed.unit, parsed.value);
        }
        ingredientMap.set(key, {
          name: ingredientName,
          amounts,
          category: ingredientCategory,
        });
      }
    });

    // Create ingredients with done status
    const ingredientsWithStatus = Array.from(ingredientMap.entries()).map(
      ([key, ing]) => ({
        name: ing.name,
        amount: this.formatAmounts(ing.amounts),
        category: ing.category,
        done: false,
        key: key,
      })
    );

    // Save or update shopping list in DB
    if (existingShoppingList) {
      existingShoppingList.ingredients = ingredientsWithStatus;
      await existingShoppingList.save();
    } else {
      await this.shoppingListModel.create({
        userId: plan.userId,
        planId: plan._id,
        ingredients: ingredientsWithStatus,
      });
    }

    return {
      success: true,
      data: {
        ingredients: ingredientsWithStatus,
      },
    };
  }

  // Force regenerate shopping list (deletes existing and creates new)
  async regenerateShoppingList(planId: string) {
    const plan = await this.planModel.findById(planId);
    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    // Delete existing shopping list
    await this.shoppingListModel.deleteOne({
      userId: plan.userId,
      planId: plan._id,
    });

    // Generate fresh shopping list
    return this.generateShoppingList(planId);
  }

  // Add products to shopping list (single product or meal ingredients)
  async addProductsToShoppingList(
    planId: string,
    products: Array<{ name: string; amount?: string; category?: string }>
  ) {
    const shoppingList = await this.shoppingListModel.findOne({ planId });
    if (!shoppingList) {
      throw new NotFoundException("Shopping list not found");
    }

    const addedProducts: Array<{
      name: string;
      amount: string;
      action: string;
    }> = [];

    for (const product of products) {
      const key = this.normalizeIngredientKey(product.name);
      const newParsed = this.parseAmount(product.amount || "");

      // Find existing ingredient with same key that is NOT done
      const existingNotDone = shoppingList.ingredients.find(
        (ing) => ing.key === key && !ing.done
      );

      if (existingNotDone) {
        // Product exists and is not done → add to amount
        if (newParsed) {
          const existingParsed = this.parseAmount(existingNotDone.amount);
          if (existingParsed && existingParsed.unit === newParsed.unit) {
            // Same unit, add amounts
            existingNotDone.amount = this.formatAmount(
              existingParsed.value + newParsed.value,
              newParsed.unit
            );
            addedProducts.push({
              name: product.name,
              amount: existingNotDone.amount,
              action: "amount_added",
            });
          } else if (existingParsed) {
            // Different units, concatenate
            existingNotDone.amount = `${existingNotDone.amount} + ${product.amount}`;
            addedProducts.push({
              name: product.name,
              amount: existingNotDone.amount,
              action: "amount_concatenated",
            });
          } else {
            // No existing amount, set new amount
            existingNotDone.amount = product.amount || "";
            addedProducts.push({
              name: product.name,
              amount: existingNotDone.amount,
              action: "amount_set",
            });
          }
        }
        // Update category if provided and not set
        if (product.category && !existingNotDone.category) {
          existingNotDone.category = product.category;
        }
      } else {
        // Product doesn't exist OR exists but is done → add new product
        const newIngredient = {
          name: product.name,
          amount: product.amount || "",
          category: product.category,
          done: false,
          key: key,
        };
        shoppingList.ingredients.push(newIngredient);
        addedProducts.push({
          name: product.name,
          amount: product.amount || "",
          action: "added_new",
        });
      }
    }

    await shoppingList.save();

    return {
      success: true,
      data: {
        addedProducts,
        ingredients: shoppingList.ingredients,
      },
    };
  }

  // Add a meal's ingredients to shopping list
  async addMealToShoppingList(planId: string, mealId: string) {
    // Find the meal in database
    const MealModel = mongoose.model("Meal");
    const meal = await MealModel.findById(mealId);

    if (!meal) {
      throw new NotFoundException("Meal not found");
    }

    const mealData = meal as any;
    if (!mealData.ingredients || !Array.isArray(mealData.ingredients)) {
      return {
        success: true,
        message: "Meal has no ingredients to add",
        data: { addedProducts: [], ingredients: [] },
      };
    }

    // Convert meal ingredients to products format
    const products = mealData.ingredients.map(
      (ing: [string, string] | [string, string, string?] | string) => {
        if (Array.isArray(ing)) {
          return {
            name: ing[0],
            amount: ing[1] || "",
            category: ing[2],
          };
        }
        return { name: String(ing), amount: "", category: undefined };
      }
    );

    return this.addProductsToShoppingList(planId, products);
  }

  async deleteProductFromShoppingList(planId: string, productName: string) {
    const shoppingList = await this.shoppingListModel.findOne({ planId });
    if (!shoppingList) {
      throw new NotFoundException("Shopping list not found");
    }

    const normalizedKey = this.normalizeIngredientKey(productName);
    const ingredientIndex = shoppingList.ingredients.findIndex(
      (ing) => ing.key === normalizedKey || ing.name === productName
    );

    if (ingredientIndex === -1) {
      throw new NotFoundException(
        `Product "${productName}" not found in shopping list`
      );
    }

    shoppingList.ingredients.splice(ingredientIndex, 1);
    await shoppingList.save();

    return {
      success: true,
      data: shoppingList,
    };
  }

  async updateShoppingListItem(
    planId: string,
    ingredientName: string,
    done: boolean
  ) {
    const normalizedKey = this.normalizeIngredientKey(ingredientName);

    const shoppingList = await this.shoppingListModel.findOneAndUpdate(
      { planId, "ingredients.key": normalizedKey },
      { $set: { "ingredients.$.done": done } },
      { new: true }
    );

    if (!shoppingList) {
      throw new NotFoundException(
        `Shopping list or ingredient "${ingredientName}" not found`
      );
    }

    return {
      success: true,
      data: shoppingList,
    };
  }

  // Update a shopping item
  async updateShoppingItems(planId: string, name: string, done: boolean) {
    const normalizedKey = this.normalizeIngredientKey(name);

    const shoppingList = await this.shoppingListModel.findOneAndUpdate(
      {
        planId,
        "ingredients.key": normalizedKey,
      },
      { $set: { "ingredients.$.done": done } },
      { new: true }
    );

    if (!shoppingList) {
      throw new NotFoundException(
        `Shopping list not found or product "${name}" not in list`
      );
    }

    return {
      success: true,
      data: shoppingList,
    };
  }

  // Get shopping list by plan ID
  async getShoppingListByPlanId(planId: string) {
    const shoppingList = await this.shoppingListModel.findOne({ planId });
    if (!shoppingList) {
      throw new NotFoundException("Shopping list not found");
    }
    return {
      success: true,
      data: shoppingList,
    };
  }
}
