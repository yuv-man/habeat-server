import { body, param } from "express-validator";
import { protect } from "../middleware/auth.middleware";
import express from 'express';
import { generatePlan, getPlanByUserId, updatePlan, deletePlan, replaceMeal, addWorkout, getDayPlan, updateWaterIntake, trackMealConsumption, updateMeal } from './plan.controller';

const router = express.Router();
//const BASE_PATH = "/api/plan";

router.use(protect);

const generatePlanValidation = [
    body('title').notEmpty().withMessage('Title is required').isLength({ max: 200 }),
    body('userData.age').isInt({ min: 16, max: 100 }).withMessage('Age must be between 16-100'),
    body('userData.gender').isIn(['male', 'female']).withMessage('Invalid gender'),
    body('userData.height').isFloat({ min: 100, max: 250 }).withMessage('Height must be between 100-250 cm'),
    body('userData.weight').isFloat({ min: 30, max: 300 }).withMessage('Weight must be between 30-300 kg'),
    body('userData.path').notEmpty().withMessage('Path is required'),
  ];

  const dayValidation = [
    param('day').isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
  ];
  
  const mealTypeValidation = [
    param('mealType').isIn(['breakfast', 'lunch', 'dinner'])
  ];
  
  const replaceMealValidation = [
    ...dayValidation,
    ...mealTypeValidation,
    body('newMealName').notEmpty().withMessage('New meal name is required'),
    body('dietaryRestrictions').optional().isArray()
  ];
  
  const exerciseValidation = [
    ...dayValidation,
    body('exerciseType').notEmpty().withMessage('Exercise type is required'),
    body('duration').isInt({ min: 1 }).withMessage('Duration must be positive'),
    body('caloriesBurned').isInt({ min: 1 }).withMessage('Calories burned must be positive')
  ];
  
  const waterValidation = [
    ...dayValidation,
    body('glasses').isInt({ min: 0, max: 20 }).withMessage('Glasses must be between 0-20')
  ];

  const trackMealValidation = [
    body('day').isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).withMessage('Invalid day'),
    body('mealType').isIn(['breakfast', 'lunch', 'dinner', 'snacks']).withMessage('Invalid meal type'),
    body('consumed').isBoolean().withMessage('Consumed must be a boolean'),
    body('snackIndex').optional().isInt({ min: 0 }).withMessage('Snack index must be a positive integer')
  ];

  router.post(`/generate`, generatePlanValidation, protect, generatePlan);
  router.get(`/:id`, protect, getPlanByUserId);
  router.put(`/:id`, protect, updatePlan);
  router.put(`/:id/replace`, protect, replaceMeal);
  router.put(`/:id/update-meal`, protect, updateMeal);
  router.post(`/:id/add-workout`, protect, addWorkout);
  router.delete(`/:id`, protect, deletePlan);
  router.get(`/day/:day`, protect, getDayPlan);
  router.put(`/day/:day/water`, protect, updateWaterIntake);
  router.post(`/track-meal`, trackMealValidation, protect, trackMealConsumption);
  

  export default router;

