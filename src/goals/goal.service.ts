import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Goal } from "./goal.model";
import { IGoal } from "../types/interfaces";
import logger from "../utils/logger";
import aiService from "../generator/generate.service";

@Injectable()
export class GoalService {
  constructor(@InjectModel(Goal.name) private goalModel: Model<IGoal>) {}

  async findAll(userId: string) {
    const goals = await this.goalModel.find({ userId }).lean().exec();
    return {
      success: true,
      data: goals,
    };
  }

  async findByUserId(userId: string) {
    const goal = await this.goalModel.findOne({ userId }).lean().exec();
    return {
      success: true,
      data: goal,
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

  async create(
    userId: string,
    goalData: {
      goal: string;
      description: string;
      category: string;
      targetDate: Date;
      startDate: Date;
      target: number;
    }
  ) {
    const newGoal = await this.goalModel.create({
      ...goalData,
      userId,
      progress: 0,
      status: "active",
    });
    return {
      success: true,
      data: newGoal,
    };
  }

  async update(
    id: string,
    updateData: {
      goal?: string;
      description?: string;
      category?: string;
      targetDate?: Date;
      startDate?: Date;
      target?: number;
      progress?: number;
      status?: string;
    }
  ) {
    const updatedGoal = await this.goalModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .lean()
      .exec();

    if (!updatedGoal) {
      throw new NotFoundException("Goal not found");
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

  async generateGoal(
    userId: string,
    description: string,
    category: string,
    targetDate: Date,
    startDate: Date,
    language: string = "en"
  ) {
    try {
      // Check if generateGoal exists in aiService, otherwise create a basic goal
      let generatedGoal: any;

      if (typeof (aiService as any).generateGoal === "function") {
        generatedGoal = await (aiService as any).generateGoal(
          description,
          category,
          targetDate,
          startDate,
          language
        );
      } else {
        // Fallback: create a basic goal structure
        generatedGoal = {
          goal: description,
          description: `AI-generated goal: ${description}`,
          category,
          targetDate,
          startDate,
          target: 100, // Default target
        };
      }

      // Create the goal in database
      const newGoal = await this.goalModel.create({
        ...generatedGoal,
        userId,
        progress: 0,
        status: "active",
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
}
