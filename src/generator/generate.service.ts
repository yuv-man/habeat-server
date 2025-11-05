import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import logger from '../utils/logger';
import { enumLanguage } from '../enums/enumLanguage';
import { IUserData, IDailyPlan } from '../types/interfaces';
import mongoose from 'mongoose';
import { generateFullWeek } from '../mocks/mockWeeklyPlan';
import {
  calculateBMR,
  calculateTDEE,
  calculateIdealWeight,
  calculateTargetCalories,
  calculateMacros
} from '../utils/healthCalculations';
import { PATH_WORKOUTS_GOAL } from '../enums/enumPaths';
import { pathGuidelines, workoutCategories } from './helper';
import { Meal } from '../meal/meal.model';

interface MealPlanResponse {
  mealPlan: {
    weeklyPlan: IDailyPlan[];
  };
  planType: 'daily' | 'weekly';
  language: string;
  generatedAt: string;
  fallbackModel?: string;
}

const generateMealPlanWithAI = async (
  userData: IUserData, 
  weekStartDate: Date,
  planType: 'daily' | 'weekly' = 'daily',
  language: string = 'en',
  useMock: boolean = false,
): Promise<MealPlanResponse> => {
  try {
    // If mock data is requested, return it immediately
    if (useMock) {
      logger.info("Using mock data as requested");
      const mockPlan = generateFullWeek();
      return new Promise(resolve => 
        setTimeout(() => {
          resolve({
            mealPlan: mockPlan,
            planType,
            language,
            generatedAt: new Date().toISOString(),
            fallbackModel: "mock"
          });
        }, 3000)
      );
    }

    // Check if API key is configured
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Helper function to build the prompt (shared between Grok and Gemini)
    const buildPrompt = (
      userData: IUserData,
      planType: 'daily' | 'weekly',
      language: string,
      weekStartDate: Date
    ): { prompt: string; jsonStructure: any; dayToName: any; nameToDay: any; dates: Date[]; activeDays: number[]; workoutDays: number[] } => {
      const bmr = calculateBMR(userData.weight, userData.height, userData.age, userData.gender);
      const tdee = calculateTDEE(bmr, userData.activityLevel);
      const targetCalories = calculateTargetCalories(tdee, userData.path);
      const macros = calculateMacros(targetCalories, userData.path);
      
      const startDate = new Date(weekStartDate);
      startDate.setHours(0, 0, 0, 0);
      const currentDay = startDate.getDay();
      const daysToGenerate: number[] = [1, 2, 3, 4, 5, 6, 0];
      const dates: Date[] = [];
      
      for (const day of daysToGenerate) {
        const date = new Date(startDate);
        const currentDayOffset = currentDay === 0 ? 7 : currentDay;
        const targetDayOffset = day === 0 ? 7 : day;
        let daysToAdd = targetDayOffset - currentDayOffset;
        if (daysToAdd < 0) daysToAdd += 7;
        date.setDate(date.getDate() + daysToAdd);
        dates.push(date);
      }
      
      const activeDays = daysToGenerate.filter(day => {
        const dayOffset = day === 0 ? 7 : day;
        const currentDayOffset = currentDay === 0 ? 7 : currentDay;
        return dayOffset >= currentDayOffset;
      });
      
      const dayToName: { [key: number]: string } = {
        1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday', 0: 'sunday'
      };
      
      const nameToDay: { [key: string]: number } = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 0
      };

      const totalWorkoutsPerWeek = PATH_WORKOUTS_GOAL[userData.path as keyof typeof PATH_WORKOUTS_GOAL];
      const daysLeft = daysToGenerate.length;
      const workoutsToInclude = Math.min(totalWorkoutsPerWeek, daysLeft);
      const workoutDays = Array.from({ length: workoutsToInclude }, (_, i) => 
        daysToGenerate[Math.floor(i * daysLeft / workoutsToInclude)]
      );

      const pathGuideline = pathGuidelines[userData.path as keyof typeof pathGuidelines] || pathGuidelines.custom;
      const validWorkoutCategories = Object.keys(workoutCategories).join(',');

      const prompt = `As a certified nutritionist, create a personalized ${planType} meal plan optimized for ${userData.path}. 
    
    Client Profile:
    - ${userData.age} year old ${userData.gender}, ${userData.height}cm, ${userData.weight}kg
    - Daily targets: ${targetCalories} calories
      * Breakfast: ${Math.round(targetCalories * 0.25)} cal (25%) - focus on energy and metabolism
      * Lunch: ${Math.round(targetCalories * 0.35)} cal (35%) - peak nutrition for daily activities
      * Dinner: ${Math.round(targetCalories * 0.30)} cal (30%) - balanced recovery
      * Snacks: ${Math.round(targetCalories * 0.10)} cal (10%) - sustained energy
    - Macro Distribution:
      * Protein: ${macros.protein}g for muscle maintenance and recovery
      * Carbs: ${macros.carbs}g for energy and performance
      * Fat: ${macros.fat}g for hormonal balance and satiety
    ${userData.allergies ? `- Health Considerations: Allergies to ${userData.allergies.join(', ')}` : ''}
    ${userData.dietaryRestrictions ? `- Dietary Protocol: ${userData.dietaryRestrictions.join(', ')}` : ''}

    Path Guidelines for ${userData.path}:
    ${pathGuideline}

    Exercise Integration:
    - ${totalWorkoutsPerWeek} structured workouts/week on: ${workoutDays.map(d => dayToName[d]).join(', ')}
    - Focus on progressive overload and recovery cycles
    
    Meal Plan Period:
    ${daysToGenerate.map((d, i) => `${dayToName[d]} (${dates[i].toISOString().split('T')[0]})`).join(', ')}

    Requirements:
    1. Each meal must be nutrient-dense and support the ${userData.path} goals
    2. Include specific portions and ingredients for accurate tracking
    3. Consider meal timing relative to workouts
    4. Ensure variety while maintaining consistent macro distribution
    5. Follow the path guidelines above for ${userData.path}
    6. Language: ${enumLanguage[language as keyof typeof enumLanguage]}

    Return ONLY a JSON object where each meal includes:
    - name: descriptive and specific
    - category: [breakfast,lunch,dinner,snack]
    - tags: [tag1,tag2,tag3]
    - calories: exact count
    - macros: protein, carbs, fat in grams
    - ingredients: array of strings in format "ingredient_name|portion_amount|unit" (e.g. "potato|200|g", "egg|2|unit", "olive_oil|15|ml")
    - prepTime: in minutes
    - benefits: array of health benefits specific to ${userData.path}

    IMPORTANT: For ingredients, always use base ingredient names (e.g. "potato" not "boiled potato", "chicken_breast" not "grilled chicken") and separate with underscores if needed. This helps with shopping list creation.

    Workouts must specify:
    - category: [${validWorkoutCategories}] - must be one of these exact values
    - duration: minutes
    - caloriesBurned: estimated expenditure
    - intensity: relative to client's level`;

      const jsonStructure = {
        weeklyPlan: [{
          day: "monday",
          meals: {
            breakfast: { name: "string", category: "breakfast", tags: ["string"], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, ingredients: ["string"], prepTime: 0, benefits: ["string"] },
            lunch: { name: "string", category: "lunch", tags: ["string"], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, ingredients: ["string"], prepTime: 0, benefits: ["string"] },
            dinner: { name: "string", category: "dinner", tags: ["string"], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, ingredients: ["string"], prepTime: 0, benefits: ["string"] },
            snacks: [{ name: "string", tags: ["string"], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, ingredients: ["string"], prepTime: 0, category: "snack" }]
          },
          hydration: { waterTarget: 2000, recommendations: ["string"] },
          workouts: [{ name: "string", category: validWorkoutCategories.split(',')[0] || "cardio", duration: 30, caloriesBurned: 300, done: false }]
        }]
      };

      return { prompt, jsonStructure, dayToName, nameToDay, dates, activeDays, workoutDays };
    };

    // Function to call Grok API
    const callGrokModel = async (
      apiKey: string,
      userData: IUserData,
      weekStartDate: Date,
      planType: 'daily' | 'weekly',
      language: string
    ): Promise<MealPlanResponse> => {
      const { prompt, jsonStructure, dayToName, nameToDay, dates, activeDays, workoutDays } = buildPrompt(userData, planType, language, weekStartDate);
      
      const fullPrompt = prompt + "\n\nIMPORTANT: You MUST return ONLY a complete meal plan for all 7 days (Monday through Sunday) as a valid JSON object. No other text, explanations, or markdown formatting.\n\nEXACT required structure:\n" + JSON.stringify(jsonStructure, null, 2) + "\n\nRemember: Return ONLY the JSON object. No other text or formatting.";

      try {
        const response = await axios.post(
          'https://api.x.ai/v1/chat/completions',
          {
            model: 'grok-beta',
            messages: [
              {
                role: 'system',
                content: 'You are a certified nutritionist expert at creating detailed meal plans. Always respond with valid JSON only, no markdown formatting or explanations.'
              },
              {
                role: 'user',
                content: fullPrompt
              }
            ],
            temperature: 0.7,
            max_tokens: 8000
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 120000
          }
        );

        let responseText = response.data.choices[0]?.message?.content || '';
        if (!responseText) {
          throw new Error('Empty response from Grok API');
        }

        // Clean up the response text (same as Gemini)
        let cleanedResponse = responseText;
        const jsonMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          cleanedResponse = jsonMatch[1];
        }
        cleanedResponse = cleanedResponse.replace(/```/g, '').trim();
        const jsonStart = cleanedResponse.indexOf('{');
        const jsonEnd = cleanedResponse.lastIndexOf('}') + 1;
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd);
        }

        const parsedResponse = JSON.parse(cleanedResponse) as { weeklyPlan: Array<any> };
        
        // Use the same transformation logic as Gemini
        return await transformWeeklyPlan(parsedResponse, dayToName, nameToDay, dates, activeDays, workoutDays, planType, language);
      } catch (error: any) {
        logger.error('Grok API error:', error.response?.data || error.message);
        throw new Error(`Grok API failed: ${error.response?.data?.error?.message || error.message}`);
      }
    };

    // Helper function to transform weekly plan (shared between Grok and Gemini)
    const transformWeeklyPlan = async (
      parsedResponse: { weeklyPlan: Array<any> },
      dayToName: any,
      nameToDay: any,
      dates: Date[],
      activeDays: number[],
      workoutDays: number[],
      planType: 'daily' | 'weekly',
      language: string
    ): Promise<MealPlanResponse> => {
      const daysToGenerate: number[] = [1, 2, 3, 4, 5, 6, 0];
      
      const allMeals: { name: string; category: string; calories: number; mealData: any }[] = [];
      parsedResponse.weeklyPlan.forEach((day: any) => {
        if (day.meals.breakfast?.name) allMeals.push({ ...day.meals.breakfast, category: 'breakfast', mealData: day.meals.breakfast });
        if (day.meals.lunch?.name) allMeals.push({ ...day.meals.lunch, category: 'lunch', mealData: day.meals.lunch });
        if (day.meals.dinner?.name) allMeals.push({ ...day.meals.dinner, category: 'dinner', mealData: day.meals.dinner });
        day.meals.snacks?.forEach((snack: any) => {
          if (snack?.name) allMeals.push({ ...snack, category: 'snack', mealData: snack });
        });
      });

      const existingMeals = await Meal.find({
        $or: allMeals.map(meal => ({
          name: meal.name,
          category: meal.category,
          calories: { $gte: meal.calories - 50, $lte: meal.calories + 50 }
        }))
      });

      const mealLookup = new Map();
      existingMeals.forEach(meal => {
        const key = `${meal.name}-${meal.category}-${meal.calories}`;
        mealLookup.set(key, meal);
      });

      const newMeals = allMeals.filter(meal => {
        const key = `${meal.name}-${meal.category}-${meal.calories}`;
        return !mealLookup.has(key);
      });

      if (newMeals.length > 0) {
        try {
          const createdMeals = await Meal.insertMany(
            newMeals.map(meal => ({
              ...meal.mealData,
              category: meal.category,
              done: false
            }))
          );
          createdMeals.forEach(meal => {
            const key = `${meal.name}-${meal.category}-${meal.calories}`;
            mealLookup.set(key, meal);
          });
        } catch (err: any) {
          logger.error(`Error creating meals in batch: ${err?.message || 'Unknown error'}`);
          newMeals.forEach(meal => {
            const key = `${meal.name}-${meal.category}-${meal.calories}`;
            mealLookup.set(key, {
              ...meal.mealData,
              _id: new mongoose.Types.ObjectId(),
              category: meal.category,
              done: false
            });
          });
        }
      }

      const transformedWeeklyPlan = await Promise.all(parsedResponse.weeklyPlan.map(async (day: any) => {
        const findMeal = (mealData: any, category: string) => {
          if (!mealData?.name) return null;
          const key = `${mealData.name}-${category}-${mealData.calories}`;
          const meal = mealLookup.get(key);
          return meal ? { ...mealData, _id: meal._id, category, done: false } : null;
        };

        const breakfast = findMeal(day.meals.breakfast, 'breakfast');
        const lunch = findMeal(day.meals.lunch, 'lunch');
        const dinner = findMeal(day.meals.dinner, 'dinner');
        const snacks = day.meals.snacks.map((snack: any) => findMeal(snack, 'snack')).filter(Boolean);

        const dayNumber = nameToDay[day.day.toLowerCase()];
        if (dayNumber === undefined) {
          throw new Error(`Invalid day name: ${day.day}`);
        }

        const dayIndex = daysToGenerate.indexOf(dayNumber);
        const isActiveDay = activeDays.includes(dayNumber);

        if (!isActiveDay) {
          return {
            day: day.day.toLowerCase() as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
            date: dates[dayIndex],
            meals: {
              breakfast: { _id: new mongoose.Types.ObjectId(), name: 'No meal planned', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, category: 'breakfast', ingredients: [], prepTime: 0, done: false },
              lunch: { _id: new mongoose.Types.ObjectId(), name: 'No meal planned', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, category: 'lunch', ingredients: [], prepTime: 0, done: false },
              dinner: { _id: new mongoose.Types.ObjectId(), name: 'No meal planned', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, category: 'dinner', ingredients: [], prepTime: 0, done: false },
              snacks: []
            },
            totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, waterIntake: 0, workouts: [], netCalories: 0
          };
        }

        return {
          day: day.day.toLowerCase() as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
          date: dates[dayIndex],
          meals: { breakfast, lunch, dinner, snacks },
          totalCalories: breakfast.calories + lunch.calories + dinner.calories + snacks.reduce((total: number, snack: any) => total + snack.calories, 0),
          totalProtein: breakfast.macros.protein + lunch.macros.protein + dinner.macros.protein + snacks.reduce((total: number, snack: any) => total + snack.macros.protein, 0),
          totalCarbs: breakfast.macros.carbs + lunch.macros.carbs + dinner.macros.carbs + snacks.reduce((total: number, snack: any) => total + snack.macros.carbs, 0),
          totalFat: breakfast.macros.fat + lunch.macros.fat + dinner.macros.fat + snacks.reduce((total: number, snack: any) => total + snack.macros.fat, 0),
          waterIntake: Math.round(day.hydration?.waterTarget / 250 || 8),
          workouts: workoutDays.includes(nameToDay[day.day.toLowerCase()]) 
            ? day.workouts.map((w: any) => ({
                name: w.name,
                category: (w.category || 'cardio').toLowerCase(),
                duration: w.duration,
                caloriesBurned: w.caloriesBurned,
                done: w.done || false
              }))
            : [],
          netCalories: breakfast.calories + lunch.calories + dinner.calories + snacks.reduce((total: number, snack: any) => total + snack.calories, 0)
        };
      }));

      return {
        mealPlan: {
          weeklyPlan: transformedWeeklyPlan.filter((day): day is IDailyPlan => day !== null)
        },
        planType,
        language,
        generatedAt: new Date().toISOString()
      };
    };

    // function to call Gemini with a given model
    const callModel = async (modelName: string): Promise<MealPlanResponse> => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const { prompt, jsonStructure, dayToName, nameToDay, dates, activeDays, workoutDays } = buildPrompt(userData, planType, language, weekStartDate);

      try {
        const result = await model.generateContent([
          {
            text: prompt + "\n\nIMPORTANT: You MUST return ONLY a complete meal plan for all 7 days (Monday through Sunday) as a valid JSON object. No other text, explanations, or markdown formatting.\n\nEXACT required structure:\n" + JSON.stringify(jsonStructure, null, 2)
          },
          {
            text: "\n\nRemember: Return ONLY the JSON object. No other text or formatting."
          }
        ]);
        const responseText = result.response.text();
        
        try {
          // Clean up the response text
          let cleanedResponse = responseText;
          
          // Remove markdown code blocks if present
          const jsonMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
          if (jsonMatch) {
            cleanedResponse = jsonMatch[1];
          }
          
          // Remove any remaining markdown formatting and whitespace
          cleanedResponse = cleanedResponse.replace(/```/g, '').trim();
          
          // Remove any text before or after the JSON object
          const jsonStart = cleanedResponse.indexOf('{');
          const jsonEnd = cleanedResponse.lastIndexOf('}') + 1;
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd);
          }
          
          // Try to parse as JSON
          const parsedResponse = JSON.parse(cleanedResponse) as { weeklyPlan: Array<any> };
          
          // Use shared transformation function
          return await transformWeeklyPlan(parsedResponse, dayToName, nameToDay, dates, activeDays, workoutDays, planType, language);
        } catch (error) {
          logger.error('Failed to parse AI response:', error);
          throw new Error('Failed to parse AI response as JSON');
        }
  } catch (error) {
        logger.error(`Error generating content with model ${modelName}:`, error);
        throw error;
      }
    };

    // Retry logic with exponential backoff
    const retryWithBackoff = async (
      fn: () => Promise<MealPlanResponse>,
      maxRetries: number = 3,
      baseDelay: number = 1000
    ): Promise<MealPlanResponse> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err: any) {
          const isRetryable = err?.message?.includes('503') || 
                             err?.message?.includes('overloaded') ||
                             err?.message?.includes('Service Unavailable');
          
          if (!isRetryable || attempt === maxRetries - 1) {
            throw err;
          }
          
          const delay = baseDelay * Math.pow(2, attempt);
          logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, err.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      throw new Error('Max retries exceeded');
    };

    // Try Grok first, then fallback to Gemini models
    const grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    
    if (grokApiKey) {
      try {
        logger.info('Attempting to generate meal plan with Grok');
        return await callGrokModel(grokApiKey, userData, weekStartDate, planType, language);
      } catch (err: any) {
        logger.warn(`Grok model failed: ${err.message}, falling back to Gemini`);
      }
    } else {
      logger.info('Grok API key not found, using Gemini models');
    }
    
    // Fallback to Gemini models (removed deprecated gemini-pro)
    const models = ["gemini-1.5-flash", "gemini-1.5-pro"];
    
    for (const modelName of models) {
      try {
        logger.info(`Attempting to generate meal plan with model: ${modelName}`);
        return await retryWithBackoff(() => callModel(modelName));
      } catch (err: any) {
        logger.warn(`Model ${modelName} failed:`, err.message);
        // Continue to next model if this one fails
        if (models.indexOf(modelName) === models.length - 1) {
          // Last model failed, throw error
          throw new Error(`All models failed. Last error: ${err.message}`);
        }
      }
    }
    
    throw new Error('No models available');

  } catch (error: any) {
    logger.error('Error generating meal plan:', error);

    if (error.message?.includes('401') || error.message?.includes('403')) {
      throw new Error('Invalid or unauthorized API key. Please check your GEMINI_API_KEY configuration.');
    } else if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables');
    }

    throw new Error('Failed to generate personalized meal plan: ' + (error.message || 'Unknown error'));
  }
};

const generateRecipeDetails = async (
  dishName: string,
  servings: number,
  targetCalories: number,
  dietaryRestrictions: string[] = [],
  language: string = 'en'
): Promise<any> => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Recipe for "${dishName}" (${enumLanguage[language as keyof typeof enumLanguage]}):
    ${servings} servings, ${Math.round(targetCalories / servings)} cal/serving
    ${dietaryRestrictions.length > 0 ? `Restrictions: ${dietaryRestrictions.join(', ')}` : ''}
    Return ONLY JSON with:
    - name: recipe name
    - ingredients: array of strings in format "ingredient_name|amount|unit" (e.g. "potato|200|g", "egg|2|unit")
    - instructions: array of steps
    - nutritional_info: {calories, protein, carbs, fat}
    - timing: {prepTime, cookTime}
    - metadata: {
      category: [breakfast|lunch|dinner|snack],
      difficulty: [easy|medium|hard],
      servings,
      dietaryInfo: {isVegetarian,isVegan,isGlutenFree,isDairyFree,isKeto,isLowCarb}
    }
    - tags: relevant keywords

    IMPORTANT: For ingredients, use base ingredient names (e.g. "potato" not "boiled potato", "chicken_breast" not "grilled chicken") and separate multi-word ingredients with underscores.`;
    
    const result = await model.generateContent([
      { text: prompt + "\n\nIMPORTANT: Return ONLY the JSON object. No other text or formatting." }
    ]);
    const responseText = result.response.text();
    
    try {
      // Clean up the response text
      let cleanedResponse = responseText;
      
      // Remove markdown code blocks if present
      const jsonMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[1];
      }
      
      // Remove any remaining markdown formatting and whitespace
      cleanedResponse = cleanedResponse.replace(/```/g, '').trim();
      
      // Remove any text before or after the JSON object
      const jsonStart = cleanedResponse.indexOf('{');
      const jsonEnd = cleanedResponse.lastIndexOf('}') + 1;
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd);
      }
      
      // Try to parse as JSON
      const recipeData = JSON.parse(cleanedResponse);
    return {
        _id: new mongoose.Types.ObjectId(),
      name: recipeData.name,
      ingredients: recipeData.ingredients,
      instructions: recipeData.instructions,
      calories: recipeData.calories,
      protein: recipeData.protein,
      carbs: recipeData.carbs,
      fat: recipeData.fat,
      category: recipeData.category,
      prepTime: recipeData.prepTime,
      cookTime: recipeData.cookTime,
      difficulty: recipeData.difficulty,
      servings: recipeData.servings,
      dietaryInfo: recipeData.dietaryInfo,
      tags: recipeData.tags,
      generatedAt: new Date().toISOString()
    };
    } catch (error) {
      logger.error('Failed to parse recipe response:', error);
      throw new Error('Failed to parse recipe response as JSON');
    }
  } catch (error) {
    logger.error('Error generating recipe details:', error);
    throw new Error('Failed to generate recipe details');
  }
};

const generateMeal = async (
  mealName: string,
  targetCalories: number,
  category: string,
  dietaryRestrictions: string[] = [],
  language: string = 'en'
): Promise<any> => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `${category} meal "${mealName}" (${enumLanguage[language as keyof typeof enumLanguage]}):
    ${targetCalories} calories
    ${dietaryRestrictions.length > 0 ? `Restrictions: ${dietaryRestrictions.join(', ')}` : ''}
    Return ONLY JSON with:
    - name: meal name
    - calories: total calories
    - macros: {protein, carbs, fat}
    - category: meal type
    - ingredients: array of strings in format "ingredient_name|amount|unit" (e.g. "potato|200|g", "egg|2|unit")

    IMPORTANT: For ingredients, use base ingredient names (e.g. "potato" not "boiled potato", "chicken_breast" not "grilled chicken") and separate multi-word ingredients with underscores.`;
    
    const result = await model.generateContent([
      { text: prompt + "\n\nIMPORTANT: Return ONLY the JSON object. No other text or formatting." }
    ]);
    const responseText = result.response.text();
    
    try {
      // Clean up the response text
      let cleanedResponse = responseText;
      
      // Remove markdown code blocks if present
      const jsonMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[1];
      }
      
      // Remove any remaining markdown formatting and whitespace
      cleanedResponse = cleanedResponse.replace(/```/g, '').trim();
      
      // Remove any text before or after the JSON object
      const jsonStart = cleanedResponse.indexOf('{');
      const jsonEnd = cleanedResponse.lastIndexOf('}') + 1;
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd);
      }
      
      // Try to parse as JSON
      const mealData = JSON.parse(cleanedResponse);
    return {
        _id: new mongoose.Types.ObjectId(),
      name: mealData.name,
      calories: mealData.calories,
      protein: mealData.protein,
      carbs: mealData.carbs,
      fat: mealData.fat,
      category: mealData.category,
      ingredients: mealData.ingredients,
        isCustom: true,
      generatedAt: new Date().toISOString()
    };
    } catch (error) {
      logger.error('Failed to parse meal response:', error);
      throw new Error('Failed to parse meal response as JSON');
    }
  } catch (error) {
    logger.error('Error generating meal:', error);
    throw new Error('Failed to generate meal');
  }
};

const aiService = {
  generateMealPlanWithAI,
  generateRecipeDetails,
  generateMeal
};

export default aiService;
