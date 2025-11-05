import { Recipe } from '../recipe/recipe.model';
import { IRecipe } from '../types/interfaces';
import logger from '../utils/logger';
  
  export class RecipeCacheService {
    // Find cached recipe
    static async findCachedRecipe(
      mealName: string,
      language: string = 'en'
    ): Promise<IRecipe | null> {
      try {
        const cachedRecipe = await Recipe.findOne({
          mealName: { $regex: new RegExp(mealName, 'i') },
          language
        }).sort({ usageCount: -1, lastUsed: -1 });
  
        if (cachedRecipe) {
          // Update usage statistics
          await Recipe.updateOne(
            { _id: cachedRecipe._id },
            { 
              $inc: { usageCount: 1 },
              $set: { lastUsed: new Date() }
            }
          );
  
          logger.info(`Cache hit for recipe: ${cachedRecipe.title}`);
        }
  
        return cachedRecipe;
      } catch (error) {
        logger.error('Error finding cached recipe:', error);
        return null;
      }
    }
  
    // Store generated recipe in cache
    static async cacheRecipe(recipeData: Partial<IRecipe>): Promise<void> {
      try {
        // Check if recipe already exists
        const existingRecipe = await Recipe.findOne({
          mealName: recipeData.mealName,
          language: recipeData.language
        });
  
        if (existingRecipe) {
          // Update existing recipe
          await Recipe.updateOne(
            { _id: existingRecipe._id },
            { 
              $inc: { usageCount: 1 },
              $set: { 
                ...recipeData,
                lastUsed: new Date()
              }
            }
          );
          logger.info(`Updated existing cached recipe: ${recipeData.mealName}`);
        } else {
          // Create new cache entry
          const newCachedRecipe = new Recipe({
            ...recipeData,
            usageCount: 1,
            lastUsed: new Date()
          });
  
          await newCachedRecipe.save();
          logger.info(`Cached new recipe: ${recipeData.mealName}`);
        }
      } catch (error) {
        logger.error('Error caching recipe:', error);
      }
    }
  }