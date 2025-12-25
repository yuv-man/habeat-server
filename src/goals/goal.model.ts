import mongoose, { Schema } from "mongoose";
import { IGoal } from "../types/interfaces";

// Model name constant for NestJS
export const Goal = { name: "Goal" };

const milestoneSchema = new Schema(
  {
    id: { type: String },
    title: { type: String, required: true },
    targetValue: { type: Number, required: true },
    completed: { type: Boolean, default: false },
    completedDate: { type: String },
  },
  { _id: false }
);

const progressHistorySchema = new Schema(
  {
    date: { type: String, required: true },
    value: { type: Number, required: true },
  },
  { _id: false }
);

const goalSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    current: { type: Number, default: 0 },
    target: { type: Number, required: true },
    unit: { type: String, required: true },
    icon: { type: String },
    status: {
      type: String,
      enum: ["active", "achieved", "in_progress", "paused"],
      default: "active",
    },
    startDate: { type: String, required: true },
    milestones: { type: [milestoneSchema], default: [] },
    progressHistory: { type: [progressHistorySchema], default: [] },
  },
  {
    timestamps: true,
    collection: "goals",
  }
);

export const GoalSchema = goalSchema;
