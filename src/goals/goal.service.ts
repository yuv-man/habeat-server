import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { Goal } from "./goal.model";
import {
  IGoal,
  IMilestone,
  IProgressHistory,
  IUserData,
} from "../types/interfaces";
import logger from "../utils/logger";
import aiService from "../generator/generate.service";
import { CreateGoalDto } from "./dto/create-goal.dto";
import { UpdateGoalDto } from "./dto/update-goal.dto";
import { GenerateGoalDto } from "./dto/generate-goal.dto";
import { User } from "../user/user.model";

@Injectable()
export class GoalService {
  constructor(
    @InjectModel(Goal.name) private goalModel: Model<IGoal>,
    @InjectModel(User.name) private userModel: Model<IUserData>
  ) {}

  async findAll(userId: string) {
    const goals = await this.goalModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .lean()
      .exec();
    return {
      success: true,
      data: goals,
    };
  }

  async findById(id: string) {
    const goal = await this.goalModel.findById(id).lean().exec();
    if (!goal) {
      throw new NotFoundException("Goal not found");
    }
    return {
      success: true,
      data: goal,
    };
  }

  async create(userId: string, goalData: CreateGoalDto) {
    // Generate IDs for milestones if not provided
    const milestones = (goalData.milestones || []).map((milestone, index) => ({
      ...milestone,
      id: milestone.id || `m${index + 1}`,
      completed: milestone.completed || false,
    }));

    const newGoal = await this.goalModel.create({
      ...goalData,
      userId: new mongoose.Types.ObjectId(userId),
      current: goalData.current || 0,
      status: goalData.status || "active",
      milestones,
      progressHistory: goalData.progressHistory || [],
    });

    return {
      success: true,
      data: newGoal,
    };
  }

  async update(id: string, updateData: UpdateGoalDto) {
    const updatedGoal = await this.goalModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .lean()
      .exec();

    if (!updatedGoal) {
      throw new NotFoundException("Goal not found");
    }

    // Auto-update status based on current vs target
    if (updatedGoal.current >= updatedGoal.target) {
      await this.goalModel.findByIdAndUpdate(id, { status: "achieved" });
      updatedGoal.status = "achieved";
    }

    return {
      success: true,
      data: updatedGoal,
    };
  }

  async delete(id: string) {
    const goal = await this.goalModel.findByIdAndDelete(id).lean().exec();
    if (!goal) {
      throw new NotFoundException("Goal not found");
    }
    return {
      success: true,
      message: "Goal deleted successfully",
    };
  }

  async addProgressEntry(goalId: string, value: number, date?: string) {
    const goal = await this.goalModel.findById(goalId);
    if (!goal) {
      throw new NotFoundException("Goal not found");
    }

    const entryDate = date || new Date().toISOString().split("T")[0];
    const progressEntry: IProgressHistory = {
      date: entryDate,
      value,
    };

    goal.progressHistory.push(progressEntry);
    goal.current = value;
    await goal.save();

    // Auto-update status
    if (goal.current >= goal.target && goal.status !== "achieved") {
      goal.status = "achieved";
      await goal.save();
    }

    return {
      success: true,
      data: goal,
    };
  }

  async updateMilestone(
    goalId: string,
    milestoneId: string,
    completed: boolean
  ) {
    const goal = await this.goalModel.findById(goalId);
    if (!goal) {
      throw new NotFoundException("Goal not found");
    }

    const milestone = goal.milestones.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new NotFoundException("Milestone not found");
    }

    milestone.completed = completed;
    if (completed && !milestone.completedDate) {
      milestone.completedDate = new Date().toISOString().split("T")[0];
    }

    await goal.save();

    return {
      success: true,
      data: goal,
    };
  }

  async generateGoal(
    userId: string,
    generateData: GenerateGoalDto
  ): Promise<IGoal> {
    try {
      const {
        userId,
        title,
        description,
        startDate,
        targetDate,
        language = "en",
      } = generateData;

      // Generate goal using AI
      const user = await this.userModel.findById(userId).lean().exec();
      if (!user) {
        throw new NotFoundException("User not found");
      }

      // Calculate timeframe from startDate and targetDate if provided, otherwise use default
      let timeframe = "3 months";
      if (targetDate && startDate) {
        const diffMs = targetDate.getTime() - startDate.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays >= 30) {
          const months = Math.round(diffDays / 30);
          timeframe = `${months} months`;
        } else if (diffDays >= 7) {
          const weeks = Math.round(diffDays / 7);
          timeframe = `${weeks} weeks`;
        } else {
          timeframe = `${diffDays} days`;
        }
      }

      const generatedGoal = await this.generateGoalWithAI(
        title,
        description,
        user.workoutFrequency,
        user.path,
        timeframe,
        language,
        startDate
      );

      // Use AI-generated targetDate if not provided, otherwise use the provided one
      const finalTargetDate = targetDate
        ? targetDate.toISOString().split("T")[0]
        : generatedGoal.targetDate;

      // Create the goal in database
      const newGoal = await this.goalModel.create({
        ...generatedGoal,
        userId: new mongoose.Types.ObjectId(userId),
        current: 0,
        status: "active",
        targetDate: finalTargetDate,
        milestones: generatedGoal.milestones || [],
        progressHistory: [],
      });

      return newGoal;
    } catch (error) {
      logger.error("Error generating goal:", error);
      throw new BadRequestException("Failed to generate goal");
    }
  }

  private async generateGoalWithAI(
    title: string,
    description: string,
    numberOfWorkouts: number,
    dietType: string,
    timeframe: string,
    language: string,
    startDate: Date
  ): Promise<Partial<IGoal> & { targetDate?: string }> {
    try {
      const generatedGoal = await aiService.generateGoal(
        title,
        description,
        numberOfWorkouts,
        dietType,
        timeframe,
        language,
        startDate
      );

      return {
        title: generatedGoal.title,
        description: generatedGoal.description,
        target: generatedGoal.target,
        unit: generatedGoal.unit,
        icon: generatedGoal.icon,
        milestones: generatedGoal.milestones,
        startDate: generatedGoal.startDate,
        targetDate: generatedGoal.targetDate,
      };
    } catch (error) {
      logger.warn("AI goal generation failed, using fallback:", error);

      // Calculate targetDate from timeframe for fallback
      const actualStartDate = startDate || new Date();
      const calculateTargetDate = (timeframe: string): Date => {
        const start = new Date(actualStartDate);
        const timeframeLower = timeframe.toLowerCase().trim();

        const monthsMatch = timeframeLower.match(/(\d+)\s*(?:month|months|mo)/);
        const weeksMatch = timeframeLower.match(/(\d+)\s*(?:week|weeks|w)/);
        const daysMatch = timeframeLower.match(/(\d+)\s*(?:day|days|d)/);

        if (monthsMatch) {
          const months = parseInt(monthsMatch[1], 10);
          start.setMonth(start.getMonth() + months);
        } else if (weeksMatch) {
          const weeks = parseInt(weeksMatch[1], 10);
          start.setDate(start.getDate() + weeks * 7);
        } else if (daysMatch) {
          const days = parseInt(daysMatch[1], 10);
          start.setDate(start.getDate() + days);
        } else {
          start.setMonth(start.getMonth() + 3); // Default to 3 months
        }

        return start;
      };

      // Fallback: Create a basic goal structure
      return {
        title: title.substring(0, 50),
        description: `Goal: ${description}. Target: ${numberOfWorkouts} workouts per week with ${dietType} diet.`,
        target: 100,
        unit: "points",
        icon: "target",
        milestones: [
          {
            id: "m1",
            title: "Start tracking progress",
            targetValue: 25,
            completed: false,
          },
          {
            id: "m2",
            title: "Reach halfway point",
            targetValue: 50,
            completed: false,
          },
          {
            id: "m3",
            title: "Complete goal",
            targetValue: 100,
            completed: false,
          },
        ],
        startDate: actualStartDate.toISOString().split("T")[0],
        targetDate: calculateTargetDate(timeframe).toISOString().split("T")[0],
      };
    }
  }
}
