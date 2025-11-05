import { IMeal } from "../types/interfaces";
import { Meal } from "./meal.model";


export async function createOrFindMeal(mealData: IMeal, generationContext: string) {
    // Calculate meal signature for deduplication
    const mealSignature = calculateMealSignature(mealData);
    
    // Look for existing similar meal
    const existingMeal = await Meal.findOne({
      $or: [
        { 'analytics.signature': mealSignature },
        { 
          name: { $regex: new RegExp(mealData.name, 'i') },
          category: mealData.category,
          calories: { $gte: mealData.calories - 50, $lte: mealData.calories + 50 }
        }
      ]
    });
    
    if (existingMeal) {
      // Update analytics
      await Meal.findByIdAndUpdate(existingMeal._id, {
        $inc: { 'analytics.timesGenerated': 1 }
      });
      return existingMeal._id;
    }
    
    // Create new meal
    const newMeal = new Meal({
      ...mealData,
      aiGenerated: true,
      generationContext,
      analytics: {
        timesGenerated: 1,
        signature: mealSignature
      }
    });
    
    const saved = await newMeal.save();
    return saved._id;
  }

  function calculateMealSignature(meal: IMeal) {
    // Create a hash based on key characteristics
    const key = `${meal.category}_${meal.calories}_${meal.macros.protein}_${meal.ingredients.sort().join('_')}`;
    return require('crypto').createHash('md5').update(key).digest('hex');
  }