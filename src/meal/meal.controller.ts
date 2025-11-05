import { Request, Response } from 'express';
import { Plan } from '../plan/plan.model';
import aiService from '../generator/generate.service';
import logger from '../utils/logger';
import { formatRecipeForResponse } from '../utils/helpers';
import { Recipe } from '../recipe/recipe.model'; // Added import for Recipe model
import { Meal } from './meal.model';

const getRecipeDetails = async (req: Request, res: Response) => {
  try {
    const { mealName, targetCalories, language } = req.query;
    
    if (!mealName || typeof mealName !== 'string') {
       res.status(400).json({
        success: false,
        message: 'Meal name is required'
      });
      return; 
    }

    const targetCaloriesNum = targetCalories ? parseInt(targetCalories as string) : 500;
    const languageStr = language as string || 'en';

    // First, try to find recipe in database
    const existingRecipe = await Recipe.findOne({ 
      mealName: { $regex: new RegExp(mealName, 'i') },
      language: languageStr
    });

    let recipeResponse;

    if (existingRecipe) {
      // Use existing recipe from database
      logger.info(`Using existing recipe for ${mealName} from database`);
      recipeResponse = {
        recipe: formatRecipeForResponse(existingRecipe),
        dishName: existingRecipe.title,
        servings: existingRecipe.servings,
        targetCalories: existingRecipe.nutrition.calories * existingRecipe.servings,
        generatedAt: existingRecipe.lastUsed.toISOString(),
        fromCache: true
      };
    } else {
      // Generate new recipe with AI
      logger.info(`Generating new recipe for ${mealName} - AI cost incurred`);
      const generatedRecipe = await aiService.generateRecipeDetails(
        mealName,
        1, // servings
        targetCaloriesNum,
        [], // dietaryRestrictions
        languageStr
      );
      
      // Save the generated recipe to database for future use
      const newRecipe = new Recipe({
        mealName: mealName,
        title: mealName,
        category: generatedRecipe.category, // Default category
        servings: 1,
        prepTime: generatedRecipe.prepTime, // Default values
        cookTime: generatedRecipe.cookTime,
        difficulty: generatedRecipe.difficulty,
        nutrition: {
          calories: generatedRecipe.calories,
          protein: generatedRecipe.protein,
          carbs: generatedRecipe.carbs,
          fat: generatedRecipe.fat
        },
        ingredients: generatedRecipe.ingredients,
        instructions: generatedRecipe.instructions,
        tags: [],
        dietaryInfo: {
          isVegetarian: false,
          isVegan: false,
          isGlutenFree: false,
          isDairyFree: false,
          isKeto: false,
          isLowCarb: false
        },
        language: languageStr
      });

      await newRecipe.save();
      logger.info(`Saved new recipe for ${mealName} to database`);

      recipeResponse = { ...generatedRecipe, fromCache: false };
    }

    res.json({
      success: true,
      data: {
        meal: {
          name: mealName,
          servings: 1,
          targetCalories: targetCaloriesNum
        },
        ...recipeResponse
      }
    });

  } catch (error) {
    logger.error('Error getting meal recipe:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get meal recipe'
    });
  }
};

  const getPopularMeals = async (req: Request, res: Response) => {
    try {
      const { category, path, limit = 10 } = req.query;
  
      // Find all plans with the specified path
      const plans = await Plan.find({ 
        'userData.path': path 
      });
  
      // Collect all meals from all plans
      const allMeals: { name: string; category: string; calories: number; usageCount: number }[] = [];
      
      plans.forEach(plan => {
        plan.weeklyPlan.forEach(dayPlan => {
          // Process each meal type
          const mealTypes = ['breakfast', 'lunch', 'dinner', 'snacks'];
          
          mealTypes.forEach(mealType => {
            const meals = dayPlan.meals[mealType as keyof typeof dayPlan.meals];
            
            if (Array.isArray(meals)) {
              // Handle snacks array
              meals.forEach(meal => {
                if (!category || meal.category === category) {
                  allMeals.push({
                    name: meal.name,
                    category: meal.category,
                    calories: meal.calories,
                    usageCount: meal.usageCount || 1
                  });
                }
              });
            } else {
              // Handle single meal
              if (!category || meals.category === category) {
                allMeals.push({
                  name: meals.name,
                  category: meals.category,
                  calories: meals.calories,
                  usageCount: meals.usageCount || 1
                });
              }
            }
          });
        });
      });
  
      // Count occurrences and sort by popularity
      const mealCounts = new Map<string, { name: string; category: string; calories: number; usageCount: number }>();
      
      allMeals.forEach(meal => {
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
  
      res.json({
        success: true,
        data: {
          popularMeals
        }
      });
  
    } catch (error) {
      logger.error('Error getting popular meals:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get popular meals'
      });
    }
  };

  const getMealDetailsByName = async (req: Request, res: Response) => {
    const { mealName, language } = req.query;
    try {
      const meal = await Meal.findOne({ name: mealName, language });
      if (!meal) {
        res.status(404).json({
          success: false,
          message: 'Meal not found'
        });
        return;
      }
      res.json({
        success: true,
        data: {
          meal
        }
      });
    } catch (error) {
      logger.error('Error getting meal details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get meal details'
      });
    }
  };

  export {
    getRecipeDetails,
    getPopularMeals,
    getMealDetailsByName
  };
