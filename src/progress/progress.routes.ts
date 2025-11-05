import express from 'express';
import { protect } from '../middleware/auth.middleware';
import {
  getTodayProgress,
  getProgressByDate,
  getProgressByDateRange,
  markMealCompletedController,
  addWaterGlass,
  getWeeklySummary,
  addCustomCalories,
  updateWaterIntake,
  resetTodayProgress,
  markWorkoutCompletedController
} from './progress.controller';

const router = express.Router();

// All routes are protected
router.use(protect);

// Get today's progress
router.get('/today/:userId', getTodayProgress);

// Reset today's progress to 0
router.delete('/today/:userId', resetTodayProgress);

// Get progress for a specific date
router.get('/date/:userId/:date', getProgressByDate);

// Get progress for a date range
router.get('/range/:userId', getProgressByDateRange);

// Mark meal as completed (syncs with meal plan)
router.post('/meal/:userId/:mealType', markMealCompletedController);

// Add custom calories (for meals not in plan)
router.post('/custom-calories/:userId', addCustomCalories);

// Add water glass (simple increment)
router.post('/water/:userId', addWaterGlass);

// Update water intake (set specific amount, syncs with plan)
router.put('/water/:userId', updateWaterIntake);

// Update exercise (with minutes and calories burned, syncs with plan)
router.put('/workout-completed/:userId', markWorkoutCompletedController);

// Get weekly summary
router.get('/weekly/:userId', getWeeklySummary);

export default router; 