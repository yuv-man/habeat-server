import mongoose, { Schema } from "mongoose";
import { IChat, IChatMessage } from "../types/interfaces";

// Model name constant for NestJS
export const Chat = { name: "Chat" };

// Proposed action payload schema
const proposedActionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["meal_swap", "workout_change", "add_snack", "none"],
      default: "none",
    },
    payload: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "expired"],
      default: "pending",
    },
  },
  { _id: false }
);

// Chat message embedded schema
const chatMessageSchema = new Schema<IChatMessage>(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    proposedAction: { type: proposedActionSchema, default: undefined },
  },
  { _id: true }
);

// Main Chat schema
const chatSchema = new Schema<IChat>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    messages: {
      type: [chatMessageSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "chats",
  }
);

// Auto-trim messages to last 30 on save
chatSchema.pre("save", function (next) {
  const maxMessages = 30;
  if (this.messages.length > maxMessages) {
    this.messages = this.messages.slice(-maxMessages);
  }
  next();
});

export const ChatSchema = chatSchema;
