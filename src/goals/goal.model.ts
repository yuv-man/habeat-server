import mongoose, { Schema } from "mongoose";
import { IGoal } from "../types/interfaces";

// Model name constant for NestJS
export const Goal = { name: "Goal" };

const goalSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    goal: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    targetDate: { type: Date, required: true },
    startDate: { type: Date, required: true },
    progress: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      required: true,
      enum: ["active", "completed", "archived", "deleted"],
      default: "active",
    },
    target: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: "goals",
  }
);

export const GoalSchema = goalSchema;
