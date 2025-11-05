import { body, param } from "express-validator";
import { protect } from "../middleware/auth.middleware";
import express from 'express';
import { getGoals, getGoalsByUserId, getGoalById, createGoal, updateGoal, deleteGoal, generateGoal } from './goal.controller';
import aiService from "../generator/generate.service";

const BASE_PATH = "/api/goals";

const router = express.Router();

router.use(protect);

router.get(`${BASE_PATH}/`, protect, getGoals);
router.get(`${BASE_PATH}/:id`, protect, getGoalById);
router.get(`${BASE_PATH}/:id/user`, protect, getGoalsByUserId);
router.post(`${BASE_PATH}/`, protect, createGoal);
router.put(`${BASE_PATH}/:id`, protect, updateGoal);
router.delete(`${BASE_PATH}/:id`, protect, deleteGoal);
router.post(`${BASE_PATH}/generate`, protect, generateGoal);

export default router;
