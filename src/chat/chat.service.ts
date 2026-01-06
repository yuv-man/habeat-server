import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { Chat } from "./chat.model";
import {
  IChat,
  IChatMessage,
  IProposedAction,
  IMealSwapPayload,
  IWorkoutChangePayload,
  IAddSnackPayload,
  IPlan,
  IUserData,
} from "../types/interfaces";
import { PlanService } from "../plan/plan.service";
import logger from "../utils/logger";

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Chat.name) private chatModel: Model<IChat>,
    @Inject(forwardRef(() => PlanService)) private planService: PlanService
  ) {}

  /**
   * Get or create chat for a user
   */
  async getOrCreateChat(userId: string): Promise<IChat> {
    let chat = await this.chatModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .exec();

    if (!chat) {
      chat = await this.chatModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        messages: [],
      });
    }

    return chat;
  }

  /**
   * Get chat history for a user
   */
  async getHistory(userId: string, limit: number = 30) {
    const chat = await this.getOrCreateChat(userId);
    const messages = chat.messages.slice(-limit);

    return {
      success: true,
      data: {
        messages,
        totalMessages: chat.messages.length,
      },
    };
  }

  /**
   * Add a message to the chat
   */
  async addMessage(
    userId: string,
    message: Omit<IChatMessage, "_id" | "timestamp">
  ): Promise<IChatMessage> {
    const chat = await this.getOrCreateChat(userId);

    const newMessage: IChatMessage = {
      ...message,
      timestamp: new Date(),
    };

    chat.messages.push(newMessage as any);
    await chat.save();

    // Return the last added message with its generated _id
    const savedMessage = chat.messages[chat.messages.length - 1];
    return savedMessage;
  }

  /**
   * Update the status of a proposed action
   */
  async updateActionStatus(
    userId: string,
    messageId: string,
    status: "accepted" | "rejected"
  ): Promise<IChatMessage | null> {
    const chat = await this.chatModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .exec();

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    const message = chat.messages.find(
      (m) => m._id?.toString() === messageId
    );

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    if (!message.proposedAction) {
      throw new BadRequestException("Message has no proposed action");
    }

    if (message.proposedAction.status !== "pending") {
      throw new BadRequestException(
        `Action already ${message.proposedAction.status}`
      );
    }

    message.proposedAction.status = status;
    await chat.save();

    return message;
  }

  /**
   * Apply a proposed action (meal swap or workout change)
   */
  async applyAction(
    userId: string,
    messageId: string,
    plan: IPlan
  ): Promise<{ plan?: IPlan; message: string }> {
    const chat = await this.chatModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .exec();

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    const message = chat.messages.find(
      (m) => m._id?.toString() === messageId
    );

    if (!message || !message.proposedAction) {
      throw new NotFoundException("Action not found");
    }

    const action = message.proposedAction;

    if (action.status !== "pending") {
      throw new BadRequestException(`Action already ${action.status}`);
    }

    try {
      switch (action.type) {
        case "meal_swap": {
          const payload = action.payload as IMealSwapPayload;
          const result = await this.planService.replaceMeal(
            userId,
            plan._id.toString(),
            payload.dateKey,
            payload.mealType,
            payload.proposedMeal,
            payload.snackIndex,
            "en"
          );

          // Mark action as accepted
          message.proposedAction.status = "accepted";
          await chat.save();

          return {
            plan: result.data.plan,
            message: `Swapped ${payload.currentMeal.name} with ${payload.proposedMeal.name}`,
          };
        }

        case "workout_change": {
          const payload = action.payload as IWorkoutChangePayload;

          if (payload.action === "add" && payload.proposedWorkout) {
            await this.planService.addWorkout(
              userId,
              payload.dateKey,
              payload.proposedWorkout.name,
              payload.proposedWorkout.category,
              payload.proposedWorkout.duration,
              payload.proposedWorkout.caloriesBurned,
              payload.proposedWorkout.time
            );

            message.proposedAction.status = "accepted";
            await chat.save();

            return {
              message: `Added workout: ${payload.proposedWorkout.name}`,
            };
          } else if (payload.action === "remove" && payload.currentWorkout) {
            await this.planService.deleteWorkout(
              userId,
              payload.dateKey,
              payload.currentWorkout.name
            );

            message.proposedAction.status = "accepted";
            await chat.save();

            return {
              message: `Removed workout: ${payload.currentWorkout.name}`,
            };
          } else if (payload.action === "update" && payload.proposedWorkout && payload.workoutIndex !== undefined) {
            await this.planService.updateWorkoutInPlan(
              userId,
              payload.dateKey,
              payload.workoutIndex,
              payload.proposedWorkout
            );

            message.proposedAction.status = "accepted";
            await chat.save();

            return {
              message: `Updated workout to: ${payload.proposedWorkout.name}`,
            };
          }

          throw new BadRequestException("Invalid workout change action");
        }

        case "add_snack": {
          const payload = action.payload as IAddSnackPayload;
          const result = await this.planService.replaceMeal(
            userId,
            plan._id.toString(),
            payload.dateKey,
            "snack",
            payload.proposedSnack,
            undefined,
            "en"
          );

          message.proposedAction.status = "accepted";
          await chat.save();

          return {
            plan: result.data.plan,
            message: `Added snack: ${payload.proposedSnack.name}`,
          };
        }

        default:
          throw new BadRequestException("Unknown action type");
      }
    } catch (error) {
      logger.error("Error applying chat action:", error);
      throw new BadRequestException(
        `Failed to apply action: ${error.message}`
      );
    }
  }

  /**
   * Clear chat history for a user
   */
  async clearHistory(userId: string) {
    const result = await this.chatModel.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      { messages: [] },
      { new: true }
    );

    if (!result) {
      throw new NotFoundException("Chat not found");
    }

    return {
      success: true,
      message: "Chat history cleared",
    };
  }
}
