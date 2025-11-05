import { body, param } from "express-validator";
import { protect } from "../middleware/auth.middleware";
import express from 'express';
import { getPopularMeals, getRecipeDetails } from "./meal.controller";

const BASE_PATH = "/api/meal";

const router = express.Router();

router.use(protect);

router.get(`${BASE_PATH}/recipe`, protect, getRecipeDetails);
router.get(`${BASE_PATH}/popular`, protect, getPopularMeals);

export default router;