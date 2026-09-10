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
import {
  ingredientKey,
  ingredientKeyCandidates,
} from "../utils/ingredient-key";

@Injectable()
export class ShoppingService {
  constructor(
    @InjectModel(ShoppingList.name)
    private shoppingListModel: Model<IShoppingList>,
    @InjectModel(Plan.name)
    private planModel: Model<IPlan>
  ) {}

  /**
   * Group key for an ingredient. Lives in utils/ingredient-key so the merging
   * rules ("tomato" and "tomatoes" are one product) can be tested on their own.
   */
  private normalizeIngredientKey(ingredientName: string): string {
    return ingredientKey(ingredientName);
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

  /**
   * Read an amount string back into units. Stored amounts can already be a
   * sum ("300 g + 2"), because that is how `formatAmounts` writes a product
   * bought in two different units.
   */
  private collectAmountParts(
    amountStr: string,
    amounts: Map<string, number>,
    unparsed: string[]
  ): void {
    if (!amountStr) return;
    for (const part of amountStr.split("+")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const parsed = this.parseAmount(trimmed);
      if (parsed) {
        amounts.set(
          parsed.unit,
          (amounts.get(parsed.unit) || 0) + parsed.value
        );
      } else if (!unparsed.includes(trimmed)) {
        // Something like "to taste" — keep it rather than drop it.
        unparsed.push(trimmed);
      }
    }
  }

  /**
   * Fold rows that are the same product into one.
   *
   * Lists written before the key rules understood plurals hold one row per
   * spelling — "tomato" and "tomatoes" sitting next to each other — and every
   * row on such a list carries a stale key. Repairing them on read means an
   * existing cart fixes itself, instead of staying wrong until the user
   * regenerates the list.
   */
  private mergeDuplicateIngredients(ingredients: IShoppingListIngredient[]): {
    ingredients: IShoppingListIngredient[];
    changed: boolean;
  } {
    const merged = new Map<
      string,
      {
        ingredient: IShoppingListIngredient;
        amounts: Map<string, number>;
        unparsed: string[];
      }
    >();
    let changed = false;

    for (const ing of ingredients) {
      const key = this.normalizeIngredientKey(ing.name || "");
      const existing = merged.get(key);

      if (!existing) {
        if (ing.key !== key) changed = true;
        const amounts = new Map<string, number>();
        const unparsed: string[] = [];
        this.collectAmountParts(ing.amount || "", amounts, unparsed);
        merged.set(key, {
          ingredient: {
            name: ing.name,
            amount: ing.amount || "",
            category: ing.category,
            done: ing.done,
            key,
          },
          amounts,
          unparsed,
        });
        continue;
      }

      changed = true;
      this.collectAmountParts(ing.amount || "", existing.amounts, existing.unparsed);
      // Still to buy unless every spelling of it was already ticked off.
      existing.ingredient.done = existing.ingredient.done && ing.done;
      if (!existing.ingredient.category && ing.category) {
        existing.ingredient.category = ing.category;
      }
    }

    const result = Array.from(merged.values()).map(
      ({ ingredient, amounts, unparsed }) => ({
        ...ingredient,
        amount: [this.formatAmounts(amounts), ...unparsed]
          .filter(Boolean)
          .join(" + "),
      })
    );

    return { ingredients: result, changed };
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
      const { ingredients, changed } = this.mergeDuplicateIngredients(
        existingShoppingList.ingredients
      );
      if (changed) {
        existingShoppingList.ingredients = ingredients;
        await existingShoppingList.save();
      }
      return {
        success: true,
        data: {
          ingredients,
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

  /**
   * Rebuild a plan's shopping list from the plan's current meals, keeping every
   * item the user has already ticked off ticked off.
   *
   * This is the path every meal swap goes through. It deliberately is *not*
   * `regenerateShoppingList`, which deletes the document first and so throws
   * away the `done` flags — fine when a user asks for a fresh list, wrong when
   * one dinner changed.
   *
   * Both swap routes call this: `PlanService.replaceMeal` (the swap modal) and
   * `GeneratorService`'s rescue meal (the "I'm Tired" button), which used to
   * update the plan and the day's progress but leave the shopping list showing
   * ingredients for a meal that was no longer in the plan.
   */
  async syncFromPlan(planId: string | mongoose.Types.ObjectId): Promise<void> {
    try {
      const plan = await this.planModel.findById(planId);
      if (!plan) return;

      const weeklyPlan = ((plan as any).weeklyPlan || {}) as Record<string, any>;

      // Aggregate every ingredient in the plan, summing amounts per unit.
      const ingredientMap = new Map<
        string,
        { name: string; amounts: Map<string, number>; category?: string }
      >();

      for (const dayPlan of Object.values(weeklyPlan)) {
        const meals = [
          dayPlan?.meals?.breakfast,
          dayPlan?.meals?.lunch,
          dayPlan?.meals?.dinner,
          ...(dayPlan?.meals?.snacks || []),
        ];

        for (const meal of meals) {
          if (!Array.isArray(meal?.ingredients)) continue;

          for (const ing of meal.ingredients) {
            // Three shapes reach this point, and `generateShoppingList`
            // already reads all three: the current tuple
            // [name, amount, category?], the legacy bare string, and an object
            // form. Reading fewer here would silently drop ingredients on swap
            // that a full regeneration would keep.
            let name: string;
            let amount: string;
            let category: string | undefined;

            if (Array.isArray(ing)) {
              name = String(ing[0] ?? "");
              amount = String(ing[1] ?? "");
              category = ing.length > 2 ? ing[2] : undefined;
            } else if (typeof ing === "string") {
              name = ing;
              amount = "";
              category = undefined;
            } else if (ing && typeof ing === "object" && (ing as any).name) {
              name = String((ing as any).name);
              amount = String((ing as any).amount ?? "");
              category = (ing as any).category;
            } else {
              continue;
            }

            if (!name.trim()) continue;

            const key = this.normalizeIngredientKey(name);
            const parsed = this.parseAmount(amount);
            const entry = ingredientMap.get(key);

            if (entry) {
              if (parsed) {
                entry.amounts.set(
                  parsed.unit,
                  (entry.amounts.get(parsed.unit) || 0) + parsed.value
                );
              }
              if (!entry.category && category) entry.category = category;
            } else {
              const amounts = new Map<string, number>();
              if (parsed) amounts.set(parsed.unit, parsed.value);
              ingredientMap.set(key, { name, amounts, category });
            }
          }
        }
      }

      const existing = await this.shoppingListModel.findOne({
        userId: plan.userId,
        planId: plan._id,
      });

      // Keyed by the same normalizer that built them, so an item the user
      // ticked survives a swap that didn't touch it.
      // Indexed by the stored key and by the key its name produces today, so a
      // list written before the key rules changed still keeps its ticks.
      const wasDone = new Map<string, boolean>();
      existing?.ingredients?.forEach((ing) => {
        wasDone.set(ing.key, ing.done);
        const currentKey = this.normalizeIngredientKey(ing.name || "");
        if (!wasDone.get(currentKey)) wasDone.set(currentKey, ing.done);
      });

      const ingredients = Array.from(ingredientMap.entries()).map(
        ([key, ing]) => ({
          name: ing.name,
          amount: this.formatAmounts(ing.amounts),
          category: ing.category,
          done: wasDone.get(key) || false,
          key,
        })
      );

      if (existing) {
        existing.ingredients = ingredients;
        await existing.save();
      } else {
        await this.shoppingListModel.create({
          userId: plan.userId,
          planId: plan._id,
          ingredients,
        });
      }
    } catch (error) {
      // A stale shopping list is a much smaller problem than a swap that
      // fails, so this never propagates.
      console.error("[ShoppingService.syncFromPlan] Error:", error);
    }
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
      const keys = ingredientKeyCandidates(product.name);
      const newParsed = this.parseAmount(product.amount || "");

      // Find existing ingredient with same key that is NOT done
      const existingNotDone = shoppingList.ingredients.find(
        (ing) => keys.includes(ing.key) && !ing.done
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

    const keys = ingredientKeyCandidates(productName);
    const ingredientIndex = shoppingList.ingredients.findIndex(
      (ing) => keys.includes(ing.key) || ing.name === productName
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
    // Accept the pre-plural-merge key as well, so items on a list written by
    // the old rules can still be ticked off.
    const keys = ingredientKeyCandidates(ingredientName);

    const shoppingList = await this.shoppingListModel.findOneAndUpdate(
      { planId, "ingredients.key": { $in: keys } },
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
    const keys = ingredientKeyCandidates(name);

    const shoppingList = await this.shoppingListModel.findOneAndUpdate(
      {
        planId,
        "ingredients.key": { $in: keys },
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
