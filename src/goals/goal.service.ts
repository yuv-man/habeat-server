import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { Goal } from "./goal.model";
import { IGoal, IMilestone, IProgressHistory } from "../types/interfaces";
import logger from "../utils/logger";
import aiService from "../generator/generate.service";
import { CreateGoalDto } from "./dto/create-goal.dto";
import { UpdateGoalDto } from "./dto/update-goal.dto";
import { GenerateGoalDto } from "./dto/generate-goal.dto";

@Injectable()
export class GoalService {
  constructor(@InjectModel(Goal.name) private goalModel: Model<IGoal>) {}

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

  async generateGoal(userId: string, generateData: GenerateGoalDto) {
    try {
      const {
        aiRules,
        numberOfWorkouts,
        dietType,
        startDate,
        targetDate,
        language = "en",
      } = generateData;

      // Generate goal using AI
      const generatedGoal = await this.generateGoalWithAI(
        aiRules,
        numberOfWorkouts,
        dietType,
        `${targetDate.getTime() - startDate.getTime()}`,
        language
      );

      // Create the goal in database
      const newGoal = await this.goalModel.create({
        ...generatedGoal,
        userId: new mongoose.Types.ObjectId(userId),
        current: 0,
        status: "active",
        milestones: generatedGoal.milestones || [],
        progressHistory: [],
      });

      return {
        success: true,
        data: newGoal,
      };
    } catch (error) {
      logger.error("Error generating goal:", error);
      throw new BadRequestException("Failed to generate goal");
    }
  }

  private async generateGoalWithAI(
    aiRules: string,
    numberOfWorkouts: number,
    dietType: string,
    timeframe: string,
    language: string
  ): Promise<Partial<IGoal>> {
    try {
      const generatedGoal = await aiService.generateGoal(
        aiRules,
        numberOfWorkouts,
        dietType,
        timeframe,
        language
      );

      return {
        title: generatedGoal.title,
        description: generatedGoal.description,
        target: generatedGoal.target,
        unit: generatedGoal.unit,
        icon: generatedGoal.icon,
        milestones: generatedGoal.milestones,
        startDate: generatedGoal.startDate,
      };
    } catch (error) {
      logger.warn("AI goal generation failed, using fallback:", error);
      // Fallback: Create a basic goal structure
      return {
        title: aiRules.substring(0, 50),
        description: `Goal: ${aiRules}. Target: ${numberOfWorkouts} workouts per week with ${dietType} diet.`,
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
        startDate: new Date().toISOString().split("T")[0],
      };
    }
  }
}
