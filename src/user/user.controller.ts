import logger from "../utils/logger";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "./user.model";
import { Meal } from "../meal/meal.model";

export const getUserFavorites = async (req: Request, res: Response) => {

    try {
        const userId = req.params.userId;
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                message: 'User not found'
            });
            return;
        }
        // Ensure we have an array of IDs
        const favoriteMealsIds = Array.isArray(user.favoriteMeals) 
            ? user.favoriteMeals 
            : Object.values(user.favoriteMeals || {});
            
        logger.info('Original favorite meal IDs:', favoriteMealsIds);
        
        // Try to convert each ID, skipping invalid ones
        const validIds = favoriteMealsIds
            .filter(id => id) // Remove any null/undefined values
            .map(id => {
                try {
                    return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
                } catch (e) {
                    logger.error('Invalid meal ID:', id);
                    return null;
                }
            })
            .filter(id => id !== null);
            
        logger.info('Converted valid ObjectIds:', validIds);
        
        const favoriteMeals = await Meal.find({ 
            _id: { $in: validIds }
        }).lean();
        
        logger.info('Found meals:', favoriteMeals.length);
        res.status(200).json({
            success: true,
            data: favoriteMeals
        });
    } catch (error) {
        logger.error('Error getting user favorites:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get user favorites'
        });
    }
}

export const updateUserFavorites = async (req: Request, res: Response) => {
    try {
        const { isFavorite, mealId } = req.body;
        const userId = req.params.userId;
        
        logger.info('Updating favorites - Input mealId:', mealId);
        
        // Convert mealId to string if it's an object
        const mealIdStr = typeof mealId === 'object' ? JSON.stringify(mealId) : mealId;
        
        // First verify the meal exists
        const meal = await Meal.findById(mealIdStr);
        if (!meal) {
            logger.error('Meal not found with ID:', mealId);
            res.status(404).json({
                success: false,
                message: 'Meal not found'
            });
            return;
        }
        logger.info('Found meal:', meal._id.toString(), meal.name);
        
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                message: 'User not found'
            });
            return;
        }
        
        let favoriteMeals = Array.isArray(user.favoriteMeals) ? user.favoriteMeals : [];
        logger.info('Current favorite meals:', favoriteMeals);
        
        if (isFavorite && !favoriteMeals.includes(mealIdStr)) {
            favoriteMeals.push(mealIdStr);
            logger.info('Added to favorites:', mealIdStr);
        } else {
            favoriteMeals = favoriteMeals.filter((id: string) => id !== mealIdStr);
            logger.info('Removed from favorites:', mealIdStr);
        }

        user.favoriteMeals = favoriteMeals;
        await user.save();
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        logger.error('Error updating user favorites:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user favorites'
        });
    }
}