import { ShoppingListCache } from './shoppingListCache.model';
import { IShoppingListCache } from '../types/interfaces';
import crypto from 'crypto';
import logger from '../utils/logger';
  
  export class ShoppingListCacheService {
    // Create hash for ingredients array
    static createIngredientsHash(ingredients: string[]): string {
      const sortedIngredients = [...ingredients].sort();
      return crypto.createHash('md5').update(JSON.stringify(sortedIngredients)).digest('hex');
    }
  
    // Find cached shopping list
    static async findCachedShoppingList(
      ingredients: string[],
      path: string,
      language: string = 'en'
    ): Promise<IShoppingListCache | null> {
      try {
        const ingredientsHash = this.createIngredientsHash(ingredients);
  
        const cachedList = await ShoppingListCache.findOne({
          ingredientsHash,
          path,
          language
        });
  
        if (cachedList) {
          // Update usage statistics
          await ShoppingListCache.updateOne(
            { _id: cachedList._id },
            { 
              $inc: { usageCount: 1 },
              $set: { lastUsed: new Date() }
            }
          );
  
          logger.info('Cache hit for shopping list');
        }
  
        return cachedList;
      } catch (error) {
        logger.error('Error finding cached shopping list:', error);
        return null;
      }
    }
  
    // Cache shopping list
    static async cacheShoppingList(
      ingredients: string[],
      path: string,
      shoppingList: string,
      language: string = 'en'
    ): Promise<void> {
      try {
        const ingredientsHash = this.createIngredientsHash(ingredients);
  
        // Check if already exists
        const existing = await ShoppingListCache.findOne({ ingredientsHash });
  
        if (existing) {
          // Update existing
          await ShoppingListCache.updateOne(
            { _id: existing._id },
            { 
              $inc: { usageCount: 1 },
              $set: { 
                shoppingList,
                lastUsed: new Date()
              }
            }
          );
        } else {
          // Create new
          const newCachedList = new ShoppingListCache({
            ingredientsHash,
            ingredients,
            path,
            language,
            shoppingList
          });
  
          await newCachedList.save();
          logger.info('Cached new shopping list');
        }
      } catch (error) {
        logger.error('Error caching shopping list:', error);
      }
    }
  }