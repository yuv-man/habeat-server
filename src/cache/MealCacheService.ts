import { MealCache } from './mealCache.model';
import { IMealCache } from '../types/interfaces';
import logger from '../utils/logger';
  
  export class MealCacheService {
    // Find cached meal that matches criteria
    static async findCachedMeal(
      category: string,
      targetCalories: number,
      path: string,
      dietaryRestrictions: string[] = [],
      language: string = 'en'
    ): Promise<IMealCache | null> {
      try {
        // Define calorie tolerance (±10%)
        const calorieMin = Math.floor(targetCalories * 0.9);
        const calorieMax = Math.ceil(targetCalories * 1.1);
  
        const query: any = {
          category,
          calories: { $gte: calorieMin, $lte: calorieMax },
          path,
          language
        };
  
        // Add dietary restrictions filter if provided
        if (dietaryRestrictions.length > 0) {
          query.dietaryTags = { $all: dietaryRestrictions };
        }
  
        // Find meals matching criteria, prioritize by usage and recency
        const cachedMeal = await MealCache.findOne(query)
          .sort({ usageCount: -1, lastUsed: -1 });
  
        if (cachedMeal) {
          // Update usage statistics
          await MealCache.updateOne(
            { _id: cachedMeal._id },
            { 
              $inc: { usageCount: 1 },
              $set: { lastUsed: new Date() }
            }
          );
  
          logger.info(`Cache hit for meal: ${cachedMeal.mealName}`);
        }
  
        return cachedMeal;
      } catch (error) {
        logger.error('Error finding cached meal:', error);
        return null;
      }
    }
  
    // Store generated meal in cache
    static async cacheMeal(
      mealName: string,
      category: string,
      calories: number,
      protein: number,
      carbs: number,
      fat: number,
      ingredients: string[],
      path: string,
      dietaryRestrictions: string[] = [],
      language: string = 'en'
    ): Promise<void> {
      try {
        // Create calorie range for flexible matching
        const calorieMin = Math.floor(calories * 0.9);
        const calorieMax = Math.ceil(calories * 1.1);
        const calorieRange = `${calorieMin}-${calorieMax}`;
  
        // Check if similar meal already exists
        const existingMeal = await MealCache.findOne({
          mealName: { $regex: new RegExp(mealName, 'i') },
          category,
          calorieRange,
          path,
          language
        });
  
        if (existingMeal) {
          // Update existing meal with new usage
          await MealCache.updateOne(
            { _id: existingMeal._id },
            { 
              $inc: { usageCount: 1 },
              $set: { 
                lastUsed: new Date(),
                calories,
                protein,
                carbs,
                fat,
                ingredients
              }
            }
          );
          logger.info(`Updated existing cached meal: ${mealName}`);
        } else {
          // Create new cache entry
          const newCachedMeal = new MealCache({
            mealName,
            category,
            calories,
            calorieRange,
            protein,
            carbs,
            fat,
            ingredients,
            path,
            dietaryTags: dietaryRestrictions,
            language
          });
  
          await newCachedMeal.save();
          logger.info(`Cached new meal: ${mealName}`);
        }
      } catch (error) {
        logger.error('Error caching meal:', error);
      }
    }
  
    // Get popular meals for suggestions
    static async getPopularMeals(
      category?: string,
      path?: string,
      limit: number = 10
    ): Promise<IMealCache[]> {
      try {
        const query: any = {};
        if (category) query.category = category;
        if (path) query.path = path;
  
        return await MealCache.find(query)
          .sort({ usageCount: -1, lastUsed: -1 })
          .limit(limit);
      } catch (error) {
        logger.error('Error getting popular meals:', error);
        return [];
      }
    }
  
    // Clean old unused meals (maintenance task)
    static async cleanOldMeals(daysOld: number = 90): Promise<void> {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
        const result = await MealCache.deleteMany({
          lastUsed: { $lt: cutoffDate },
          usageCount: { $lt: 3 } // Keep meals used at least 3 times
        });
  
        logger.info(`Cleaned ${result.deletedCount} old cached meals`);
      } catch (error) {
        logger.error('Error cleaning old meals:', error);
      }
    }
  }