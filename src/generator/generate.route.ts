import express from 'express';
import { generateMealPlan, generateRecipeDetails } from './generate.controller';
import { protect } from '../middleware/auth.middleware';

const router = express.Router();

router.post('/generate-meal-plan', protect, generateMealPlan);
router.post('/generate-recipe-details', protect, generateRecipeDetails);

export default router;

  
  
  
  
  
 
  