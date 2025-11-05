import { Request, Response } from 'express';
import { Goal } from './goal.model';
import logger from '../utils/logger';
import aiService from '../generator/generate.service';

const getGoals = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id;
    const goals = await Goal.find({ userId });

    res.status(200).json({
      success: true,
      data: goals
    });
  } catch (error) {
    logger.error('Error getting goals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get goals'
    });
  }
};

const getGoalsByUserId = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id;
    const goal = await Goal.findOne({ userId });

    res.status(200).json({
      success: true,
      data: goal
    });
  } catch (error) {
    logger.error('Error getting goals by user id:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get goals by user id'
    });
  }
};

const getGoalById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const goal = await Goal.findById(id);

    res.status(200).json({
      success: true,
      data: goal
    });
  } catch (error) {
    logger.error('Error getting goal by id:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get goal by id'
    });
  }
};

const createGoal = async (req: Request, res: Response) => {
  try {
    const { goal, description, category, targetDate, startDate, target } = req.body;
    const newGoal = new Goal({ goal, description, category, targetDate, startDate, target });
    await newGoal.save();
    res.status(201).json({
      success: true,
      data: newGoal
    });
  } catch (error) {
    logger.error('Error creating goal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create goal'
    });
  }
};

const updateGoal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { goal, description, category, targetDate, startDate, target } = req.body;
    const updatedGoal = await Goal.findByIdAndUpdate(id, { goal, description, category, targetDate, startDate, target }, { new: true });
    res.status(200).json({
      success: true,
      data: updatedGoal
    });
  } catch (error) {
    logger.error('Error updating goal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update goal'
    });
  }
};

const deleteGoal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await Goal.findByIdAndDelete(id);
    res.status(200).json({
      success: true,
      message: 'Goal deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting goal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete goal'
    });
  }
};

const generateGoal = async (req: Request, res: Response) => {
  try {
    const { description, category, targetDate, startDate, language } = req.body;
    const goal = await aiService.generateGoal(description, category, targetDate, startDate, language);
    res.status(200).json({
      success: true,
      data: goal
    });
  } catch (error) {
    logger.error('Error generating goal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate goal'
    });
  }
};

export { getGoals, getGoalsByUserId, getGoalById, createGoal, updateGoal, deleteGoal, generateGoal   };