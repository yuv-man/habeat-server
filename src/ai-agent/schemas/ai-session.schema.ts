import { Schema } from 'mongoose';

export const AiSession = { name: 'AiSession' };

const aiSessionSchema = new Schema(
  {
    aiUserId: { type: Schema.Types.ObjectId, ref: 'AiTestUser', required: true },
    day: { type: Number, required: true },
    scenarioId: { type: String, required: true },
    // Scenario context, denormalised so a session reads on its own.
    title: { type: String },
    dayOfWeek: { type: String },
    timeOfDay: { type: String },
    mood: { type: String },
    goal: { type: String, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed'],
      default: 'running',
    },
    actionCount: { type: Number, default: 0 },
    maxActions: { type: Number },
    /** Why the session ended: the agent's own words, or 'ran out of actions'. */
    finishReason: { type: String },
    /** First-person memory carried into the next session for this user. */
    summary: { type: String },
    error: { type: String },
  },
  { timestamps: true, collection: 'ai_sessions' },
);

export const AiSessionSchema = aiSessionSchema;
