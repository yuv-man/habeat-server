import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Recipe } from "./recipe.model";
import { IMeal, IRecipe, IUserData } from "../types/interfaces";
import logger from "../utils/logger";
import aiService from "src/generator/generate.service";
import { Meal } from "src/meal/meal.model";
import { User } from "src/user/user.model";

@Injectable()
export class RecipeService {
  constructor(@InjectModel(Recipe.name) private recipeModel: Model<IRecipe>) {}
  @InjectModel(Meal.name) private mealModel: Model<IMeal>;
  @InjectModel(User.name) private userModel: Model<IUserData>;
  async findAll(filters?: {
    category?: string;
    language?: string;
    tags?: string[];
  }) {
    const query: any = {};
    if (filters?.category) query.category = filters.category;
    if (filters?.language) query.language = filters.language;
    if (filters?.tags && filters.tags.length > 0) {
      query.tags = { $in: filters.tags };
    }

    const recipes = await this.recipeModel
      .find(query)
      .sort({ usageCount: -1, lastUsed: -1 })
      .lean()
      .exec();

    return {
      success: true,
      data: recipes,
    };
  }

  async findById(id: string) {
    const recipe = await this.recipeModel.findById(id).lean().exec();
    if (!recipe) {
      throw new NotFoundException("Recipe not found");
    }

    // Update usage stats
    await this.recipeModel.findByIdAndUpdate(id, {
      $inc: { usageCount: 1 },
      lastUsed: new Date(),
    });

    return {
      success: true,
      data: recipe,
    };
  }

  async findByMealId(mealId: string, userId: string, language: string = "en") {
    let recipe = await this.recipeModel
      .findOne({
        mealId: mealId,
        language,
      })
      .lean()
      .exec();

    if (recipe) {
      // Update usage stats
      await this.recipeModel.findOneAndUpdate(
        { mealId: mealId },
        {
          $inc: { usageCount: 1 },
          lastUsed: new Date(),
        }
      );
    } else {
      const meal = await this.mealModel.findById(mealId).lean().exec();
      if (!meal) {
        throw new NotFoundException("Meal not found");
      }
      const user = await this.userModel.findById(userId).lean().exec();
      const recipeDetails: IRecipe = await aiService.generateRecipeDetails(
        meal.name,
        meal.category,
        meal.calories,
        meal.ingredients,
        user.dietaryRestrictions,
        1,
        language
      );
      recipe = await this.recipeModel.create({
        mealId: mealId,
        mealName: meal.name,
        category: meal.category,
        servings: 1,
        prepTime: recipeDetails.prepTime,
        cookTime: recipeDetails.cookTime,
        difficulty: recipeDetails.difficulty,
        macros: recipeDetails.macros,
        ingredients: recipeDetails.ingredients,
        instructions: recipeDetails.instructions,
        tags: recipeDetails.tags,
        dietaryInfo: recipeDetails.dietaryInfo,
        notes: recipeDetails.notes,
        language: language,
        usageCount: 1,
        lastUsed: new Date(),
      });
    }

    return {
      success: true,
      data: recipe,
    };
  }

  async create(recipeData: Partial<IRecipe>) {
    const recipe = await this.recipeModel.create({
      ...recipeData,
      usageCount: 1,
      lastUsed: new Date(),
    });

    return {
      success: true,
      data: recipe,
    };
  }

  async update(id: string, updateData: Partial<IRecipe>) {
    const recipe = await this.recipeModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .lean()
      .exec();

    if (!recipe) {
      throw new NotFoundException("Recipe not found");
    }

    return {
      success: true,
      data: recipe,
    };
  }

  async delete(id: string) {
    const recipe = await this.recipeModel.findByIdAndDelete(id).lean().exec();
    if (!recipe) {
      throw new NotFoundException("Recipe not found");
    }

    return {
      success: true,
      message: "Recipe deleted successfully",
    };
  }

  async search(
    query: string,
    filters?: { category?: string; language?: string }
  ) {
    const searchQuery: any = {
      $or: [
        { title: { $regex: new RegExp(query, "i") } },
        { mealName: { $regex: new RegExp(query, "i") } },
        { tags: { $in: [new RegExp(query, "i")] } },
      ],
    };

    if (filters?.category) searchQuery.category = filters.category;
    if (filters?.language) searchQuery.language = filters.language;

    const recipes = await this.recipeModel
      .find(searchQuery)
      .sort({ usageCount: -1 })
      .limit(20)
      .lean()
      .exec();

    return {
      success: true,
      data: recipes,
    };
  }

  async getPopular(limit: number = 10, category?: string) {
    const query: any = {};
    if (category) query.category = category;

    const recipes = await this.recipeModel
      .find(query)
      .sort({ usageCount: -1, lastUsed: -1 })
      .limit(limit)
      .lean()
      .exec();

    return {
      success: true,
      data: recipes,
    };
  }
}
