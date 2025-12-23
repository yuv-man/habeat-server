import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Meal } from "./meal.model";
import { Plan } from "../plan/plan.model";
import { Recipe } from "../recipe/recipe.model";
import { IMeal, IPlan, IRecipe, IUserData } from "../types/interfaces";
import logger from "../utils/logger";
import { formatRecipeForResponse } from "../utils/helpers";
import aiService from "../generator/generate.service";
import crypto from "crypto";
import { User } from "src/user/user.model";

@Injectable()
export class MealService {
  constructor(
    @InjectModel(Meal.name) private mealModel: Model<IMeal>,
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    @InjectModel(Recipe.name) private recipeModel: Model<IRecipe>,
    @InjectModel(User.name) private userModel: Model<IUserData>
  ) {}

  async getRecipeDetails(
    mealId: string,
    userId: string,
    language: string = "en"
  ) {
    if (!mealId || typeof mealId !== "string") {
      throw new BadRequestException("Meal name is required");
    }
    const languageStr = language || "en";

    // First, try to find recipe in database
    const existingRecipe = await this.recipeModel
      .findOne({
        mealId: mealId,
        language: languageStr,
      })
      .lean()
      .exec();

    let recipeResponse: IRecipe;

    if (existingRecipe) {
      // Use existing recipe from database
      logger.info(
        `Using existing recipe for ${existingRecipe?.mealName} from database`
      );
      recipeResponse = existingRecipe;
    } else {
      const meal = await this.mealModel.findById(mealId).lean().exec();
      if (!meal) {
        throw new NotFoundException("Meal not found");
      }
      const user = await this.userModel.findById(userId).lean().exec();
      // Generate new recipe with AI
      logger.info(`Generating new recipe for ${meal.name} - AI cost incurred`);
      const generatedRecipe = await aiService.generateRecipeDetails(
        meal.name,
        meal.category,
        meal.calories,
        meal.ingredients,
        user.dietaryRestrictions,
        1,
        languageStr
      );
      // Save the generated recipe to database for future use
      const newRecipe = await this.recipeModel.create({
        mealId: mealId,
        mealName: meal.name,
        category: generatedRecipe.category || "dinner",
        servings: 1,
        prepTime: generatedRecipe.prepTime || 30,
        cookTime: generatedRecipe.cookTime || 30,
        difficulty: generatedRecipe.difficulty || "medium",
        nutrition: {
          calories: generatedRecipe.macros.calories || meal.calories,
          protein: generatedRecipe.macros.protein || meal.macros.protein,
          carbs: generatedRecipe.macros.carbs || meal.macros.carbs,
          fat: generatedRecipe.macros.fat || meal.macros.fat,
        },
        ingredients: generatedRecipe.ingredients || [],
        instructions: generatedRecipe.instructions || [],
        tags: [],
        dietaryInfo: {
          isVegetarian: false,
          isVegan: false,
          isGlutenFree: false,
          isDairyFree: false,
          isKeto: false,
          isLowCarb: false,
        },
        language: languageStr,
      });

      logger.info(`Saved new recipe for ${meal.name} to database`);

      recipeResponse = newRecipe;
    }

    return {
      success: true,
      data: {
        recipe: recipeResponse,
      },
    };
  }

  async getPopularMeals(category?: string, path?: string, limit: number = 10) {
    try {
      // Find all plans with the specified path
      const plans = await this.planModel
        .find(path ? { "userData.path": path } : {})
        .lean()
        .exec();

      // Collect all meals from all plans
      const allMeals: {
        name: string;
        category: string;
        calories: number;
        usageCount: number;
      }[] = [];

      plans.forEach((plan) => {
        const weeklyPlan = (plan as any).weeklyPlan || {};
        Object.values(weeklyPlan).forEach((dayPlan: any) => {
          // Process each meal type
          const mealTypes = ["breakfast", "lunch", "dinner", "snacks"];

          mealTypes.forEach((mealType) => {
            const meals = dayPlan.meals?.[mealType];

            if (Array.isArray(meals)) {
              // Handle snacks array
              meals.forEach((meal: any) => {
                if (!category || meal.category === category) {
                  allMeals.push({
                    name: meal.name,
                    category: meal.category,
                    calories: meal.calories,
                    usageCount: meal.usageCount || 1,
                  });
                }
              });
            } else if (meals) {
              // Handle single meal
              if (!category || meals.category === category) {
                allMeals.push({
                  name: meals.name,
                  category: meals.category,
                  calories: meals.calories,
                  usageCount: meals.usageCount || 1,
                });
              }
            }
          });
        });
      });

      // Count occurrences and sort by popularity
      const mealCounts = new Map<
        string,
        {
          name: string;
          category: string;
          calories: number;
          usageCount: number;
        }
      >();

      allMeals.forEach((meal) => {
        const key = `${meal.name}-${meal.category}`;
        if (mealCounts.has(key)) {
          const existing = mealCounts.get(key)!;
          existing.usageCount += meal.usageCount;
        } else {
          mealCounts.set(key, { ...meal });
        }
      });

      // Convert to array and sort by usage count
      const popularMeals = Array.from(mealCounts.values())
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, Number(limit));

      return {
        success: true,
        data: {
          popularMeals,
        },
      };
    } catch (error) {
      logger.error("Error getting popular meals:", error);
      throw new BadRequestException("Failed to get popular meals");
    }
  }

  async getMealDetailsByName(mealName: string, language?: string) {
    const meal = await this.mealModel
      .findOne({ name: mealName, ...(language && { language }) })
      .lean()
      .exec();

    if (!meal) {
      throw new NotFoundException("Meal not found");
    }

    return {
      success: true,
      data: {
        meal,
      },
    };
  }

  async createOrFindMeal(mealData: IMeal, generationContext: string) {
    // Calculate meal signature for deduplication
    const mealSignature = this.calculateMealSignature(mealData);

    // Look for existing similar meal
    const existingMeal = await this.mealModel
      .findOne({
        $or: [
          { "analytics.signature": mealSignature },
          {
            name: { $regex: new RegExp(mealData.name, "i") },
            category: mealData.category,
            calories: {
              $gte: mealData.calories - 50,
              $lte: mealData.calories + 50,
            },
          },
        ],
      })
      .lean()
      .exec();

    if (existingMeal) {
      // Update analytics
      await this.mealModel.findByIdAndUpdate(existingMeal._id, {
        $inc: { "analytics.timesGenerated": 1 },
      });
      return existingMeal._id;
    }

    // Create new meal
    const newMeal = await this.mealModel.create({
      ...mealData,
      aiGenerated: true,
      generationContext,
      analytics: {
        timesGenerated: 1,
        signature: mealSignature,
      },
    });

    return newMeal._id;
  }

  private calculateMealSignature(meal: IMeal) {
    // Create a hash based on key characteristics
    const ingredientsStr = Array.isArray(meal.ingredients)
      ? meal.ingredients
          .map((ing) => (Array.isArray(ing) ? ing[0] : ing))
          .sort()
          .join("_")
      : "";
    const key = `${meal.category}_${meal.calories}_${meal.macros.protein}_${ingredientsStr}`;
    return crypto.createHash("md5").update(key).digest("hex");
  }
}
