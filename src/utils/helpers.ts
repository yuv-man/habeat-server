import { MealCacheService } from "../cache/MealCacheService";
import { IMeal, IRecipe } from "../types/interfaces";
import { ingredientCategories } from "./ingredientCategories";

export const formatRecipeForResponse = (recipe: IRecipe) => {
    return `## ${recipe.title.toUpperCase()}
  
    ### NUTRITION INFO (per serving)
    - Calories: ${recipe.nutrition?.calories || 'N/A'}
    - Protein: ${recipe.nutrition?.protein || 'N/A'}g
    - Carbohydrates: ${recipe.nutrition?.carbs || 'N/A'}g
    - Fat: ${recipe.nutrition?.fat || 'N/A'}g
    - Fiber: ${recipe.nutrition?.fiber || 'N/A'}g
    
    ### PREP & COOK TIME
    - Prep Time: ${recipe.prepTime || 'N/A'} minutes
    - Cook Time: ${recipe.cookTime || 'N/A'} minutes
    - Difficulty: ${recipe.difficulty || 'Medium'}
    
    ### INGREDIENTS
    ${recipe.ingredients?.map((ing: any) => 
        `- ${ing.amount} ${ing.unit} ${ing.name}${ing.notes ? ` (${ing.notes})` : ''}`
    ).join('\n') || 'Ingredients not available'}
    
    ### EQUIPMENT NEEDED
    ${recipe.equipment?.map((eq: string) => `- ${eq}`).join('\n') || '- Basic kitchen equipment'}
    
    ### INSTRUCTIONS
    ${recipe.instructions?.map((inst: any) => 
        `${inst.step}. ${inst.instruction}${inst.time ? ` (${inst.time} minutes)` : ''}${inst.temperature ? ` at ${inst.temperature}°C` : ''}`
    ).join('\n') || 'Instructions not available'}
    
    ### MEAL PREP NOTES
    ${recipe.mealPrepNotes || 'Store in refrigerator for up to 3 days. Reheat before serving.'}
    
    ### VARIATIONS
    ${recipe.variations?.map((variation: string) => `- ${variation}`).join('\n') || 'No variations available'}
    
    ### CHEF'S TIPS
    ${recipe.chefTips?.map((tip: string) => `- ${tip}`).join('\n') || 'Follow instructions carefully for best results'}`;
  };

  export const processMealForIngredients = async (
    meal: IMeal,
    plan: any,
    allIngredients: string[],
    mealsToGenerate: string[]
  ) => {
    // Check if meal exists in cache
    const cachedMeal = await MealCacheService.findCachedMeal(
      meal.category,
      meal.calories,
      plan.userData.path,
      plan.userData.allergies || [],
      plan.language
    );
  
    if (cachedMeal && cachedMeal.mealName.toLowerCase().includes(meal.name.toLowerCase())) {
      // Use cached meal ingredients
      allIngredients.push(...cachedMeal.ingredients);
    } else {
      // Add to list of meals that need ingredient generation
      mealsToGenerate.push(meal.name);
    }
  };    

  export const organizeIngredients = (ingredients: string[]): string => {
    const organized: { [key: string]: string[] } = {};
    
    ingredients.forEach(ingredient => {
      let categorized = false;
      for (const [category, keywords] of Object.entries(ingredientCategories)) {
        if (keywords.some(keyword => ingredient.toLowerCase().includes(keyword))) {
          if (!organized[category]) organized[category] = [];
          organized[category].push(ingredient);
          categorized = true;
          break;
        }
      }
      if (!categorized) {
        if (!organized['Other']) organized['Other'] = [];
        organized['Other'].push(ingredient);
      }
    });
  
    // Format the organized list
    let result = '# SHOPPING LIST\n\n';
    for (const [category, items] of Object.entries(organized)) {
      if (items.length > 0) {
        result += `## ${category.toUpperCase()}\n`;
        items.forEach(item => {
          result += `- ${item}\n`;
        });
        result += '\n';
      }
    }
  
    return result;
  };

  // Progress calculation utilities
  export const calculateProgressPercentage = (current: number, goal: number): number => {
    if (goal === 0) return 0;
    return Math.min(Math.round((current / goal) * 100), 100);
  };

  export const calculateCalorieDeficit = (consumed: number, goal: number): number => {
    return goal - consumed;
  };

  export const calculateMealCompletionRate = (meals: {
    breakfast: any;
    lunch: any;
    dinner: any;
    snacks: any[];
  }): number => {
    const totalMeals = 3; // breakfast, lunch, dinner
    const completedMainMeals = [
      meals.breakfast?.done,
      meals.lunch?.done,
      meals.dinner?.done
    ].filter(Boolean).length;
    
    return Math.round((completedMainMeals / totalMeals) * 100);
  };

  export const getProgressStatus = (percentage: number): string => {
    if (percentage >= 90) return 'excellent';
    if (percentage >= 75) return 'good';
    if (percentage >= 50) return 'fair';
    return 'needs_improvement';
  };

  export const formatProgressStats = (progress: any) => {
    return {
      calories: {
        consumed: progress.caloriesConsumed,
        goal: progress.caloriesGoal,
        percentage: calculateProgressPercentage(progress.caloriesConsumed, progress.caloriesGoal),
        deficit: calculateCalorieDeficit(progress.caloriesConsumed, progress.caloriesGoal),
        status: getProgressStatus(calculateProgressPercentage(progress.caloriesConsumed, progress.caloriesGoal))
      },
      macros: {
        protein: {
          consumed: progress.protein.consumed,
          goal: progress.protein.goal,
          percentage: calculateProgressPercentage(progress.protein.consumed, progress.protein.goal)
        },
        carbs: {
          consumed: progress.carbs.consumed,
          goal: progress.carbs.goal,
          percentage: calculateProgressPercentage(progress.carbs.consumed, progress.carbs.goal)
        },
        fat: {
          consumed: progress.fat.consumed,
          goal: progress.fat.goal,
          percentage: calculateProgressPercentage(progress.fat.consumed, progress.fat.goal)
        }
      },
      water: {
        consumed: progress.water.consumed,
        goal: progress.water.goal,
        percentage: calculateProgressPercentage(progress.water.consumed, progress.water.goal),
        status: getProgressStatus(calculateProgressPercentage(progress.water.consumed, progress.water.goal))
      },
      workouts: {
        completed: progress.workouts.filter((w: any) => w.done).length,
        goal: progress.workouts.length,
        percentage: calculateProgressPercentage(
          progress.workouts.filter((w: any) => w.done).length,
          progress.workouts.length
        ),
        status: getProgressStatus(calculateProgressPercentage(
          progress.workouts.filter((w: any) => w.done).length,
          progress.workouts.length
        ))
      },
      meals: {
        completed: {
          breakfast: progress.meals.breakfast?.done || false,
          lunch: progress.meals.lunch?.done || false,
          dinner: progress.meals.dinner?.done || false,
          snacks: progress.meals.snacks.filter((s: any) => s.done).length
        },
        details: {
          breakfast: progress.meals.breakfast ? {
            name: progress.meals.breakfast.name,
            calories: progress.meals.breakfast.calories,
            macros: progress.meals.breakfast.macros,
            prepTime: progress.meals.breakfast.prepTime,
            done: progress.meals.breakfast.done
          } : null,
          lunch: progress.meals.lunch ? {
            name: progress.meals.lunch.name,
            calories: progress.meals.lunch.calories,
            macros: progress.meals.lunch.macros,
            prepTime: progress.meals.lunch.prepTime,
            done: progress.meals.lunch.done
          } : null,
          dinner: progress.meals.dinner ? {
            name: progress.meals.dinner.name,
            calories: progress.meals.dinner.calories,
            macros: progress.meals.dinner.macros,
            prepTime: progress.meals.dinner.prepTime,
            done: progress.meals.dinner.done
          } : null,
          snacks: progress.meals.snacks.map((s: any) => ({
            name: s.name,
            calories: s.calories,
            macros: s.macros,
            prepTime: s.prepTime,
            done: s.done
          }))
        },
        completionRate: calculateMealCompletionRate(progress.meals),
        status: getProgressStatus(calculateMealCompletionRate(progress.meals))
      },
      exercise: {
        minutes: progress.workouts.reduce((total: number, w: any) => total + (w.done ? w.duration : 0), 0),
        workouts: progress.workouts.filter((w: any) => w.done).length,
        details: progress.workouts.map((w: any) => ({
          name: w.name,
          duration: w.duration,
          caloriesBurned: w.caloriesBurned,
          done: w.done
        }))
      }
    };
  };