import { Schema } from 'mongoose';

export const AiAction = { name: 'AiAction' };

const aiActionSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'AiSession', required: true },
    aiUserId: { type: Schema.Types.ObjectId, ref: 'AiTestUser', required: true },
    day: { type: Number, required: true },
    action: { type: String, required: true },
    target: { type: String },
    value: { type: String },
    reasoning: { type: String },
    url: { type: String },
    success: { type: Boolean, required: true },
  },
  { timestamps: true, collection: 'ai_actions' },
);

export const AiActionSchema = aiActionSchema;
