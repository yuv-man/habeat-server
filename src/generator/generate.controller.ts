import aiService from './generate.service';
import logger from '../utils/logger';
import { Request, Response } from 'express';
import { IUserData } from '../types/interfaces';
import { Plan } from '../plan/plan.model';

// @desc    Generate and save meal plan
// @route   POST /generate
// @access  Private
const generateMealPlan = async (req: Request, res: Response) => {
  try {
    const { userData, startDate, language: reqLanguage, planType: reqPlanType, title } = req.body as { 
      userData: IUserData, 
      startDate: Date,
      language: string, 
      planType: 'daily' | 'weekly',
      title: string 
    };
    
    if (!userData) {
      res.status(400).json({
        status: 'fail',
        message: 'Please provide user data'
      });
      return;
    }
    

    const planType = reqPlanType || 'daily';
    const language = reqLanguage || 'en';
    
    // Generate meal plan using AI
    const { mealPlan, planType: generatedPlanType, language: generatedLanguage, generatedAt } = await aiService.generateMealPlanWithAI(userData, startDate, planType, language);
    
    // Delete existing plan if exists (user can have only one plan)
    const userId = req.user?._id;
    if (userId) {
      await Plan.findOneAndDelete({ userId });
    }
    
    // Create new plan
    const plan = new Plan({
      userId: userId || 'temp-user',
      title: title || 'My Meal Plan',
      userMetrics: {
        bmr: 0, // Will be calculated from userData
        tdee: 0,
        targetCalories: 0,
        idealWeight: 0,
        weightRange: '',
        dailyMacros: {
          protein: 0,
          carbs: 0,
          fat: 0
        }
      },
      userData,
      weeklyPlan: [], // Initialize empty, will be populated from mealPlan text
      language,
      generatedAt: new Date()
    });
    
    await plan.save();
    
    logger.info(`New meal plan generated and saved for user ${userId}`);
    
    res.status(201).json({
      status: 'success',
      message: 'Meal plan generated and saved successfully',
      data: {
        planId: plan._id,
        title: plan.title,
        mealPlan,
        planType,
        language,
        generatedAt
      }
    });
  } catch (error) {
    logger.error('Error generating meal plan:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate meal plan'
    });
  }
};

const generateRecipeDetails = async (req: Request, res: Response) => {
  try {
    const { dishName, servings, targetCalories, dietaryRestrictions, language } = req.body as { dishName: string, servings: number, targetCalories: number, dietaryRestrictions: string[], language: string };
    const recipeDetails = await aiService.generateRecipeDetails(dishName, servings, targetCalories, dietaryRestrictions, language);

    res.status(200).json({
      status: 'success',
      data: recipeDetails
    });
  } catch (error) {
    logger.error('Error generating recipe details:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate recipe details'
    });
  }
};
export { generateMealPlan, generateRecipeDetails };