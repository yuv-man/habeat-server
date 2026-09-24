import { Schema, Types } from "mongoose";

export const LlmUsageDay = { name: "LlmUsageDay" };

/**
 * What the LLM cost, per day, user, feature and model. One small document per
 * combination, incremented on every call — enough to answer "what does a user
 * cost a month" and "which feature is spending" without keeping every call.
 */
export interface ILlmUsageDay {
  date: string; // YYYY-MM-DD, server local time
  userId: Types.ObjectId | null; // null for calls outside any user (library jobs)
  feature: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
}

export const LlmUsageDaySchema = new Schema<ILlmUsageDay>(
  {
    date: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    feature: { type: String, required: true },
    model: { type: String, required: true },
    calls: { type: Number, default: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    thinkingTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
  },
  { collection: "llm_usage_daily", timestamps: false },
);

LlmUsageDaySchema.index({ date: 1, userId: 1, feature: 1, model: 1 }, { unique: true });
LlmUsageDaySchema.index({ userId: 1, date: 1 });
