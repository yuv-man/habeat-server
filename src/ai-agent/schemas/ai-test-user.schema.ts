import { Schema } from 'mongoose';

export const AiTestUser = { name: 'AiTestUser' };

const aiTestUserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // plaintext — only used by browser to log in
    personaId: { type: String, required: true },
    startDate: { type: Date, required: true },
    currentDay: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['active', 'paused', 'completed'],
      default: 'active',
    },
    isAiTestUser: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'ai_test_users' },
);

export const AiTestUserSchema = aiTestUserSchema;
