import { Schema } from 'mongoose';

export const AiObservation = { name: 'AiObservation' };

const aiObservationSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'AiSession', required: true },
    aiUserId: { type: Schema.Types.ObjectId, ref: 'AiTestUser', required: true },
    day: { type: Number, required: true },
    scenarioId: { type: String },
    feature: { type: String, required: true },
    type: {
      type: String,
      enum: ['usability', 'confusion', 'success', 'abandonment', 'engagement'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      required: true,
    },
    description: { type: String, required: true },
    evidence: [{ type: String }],
    recommendation: { type: String },
  },
  { timestamps: true, collection: 'ai_observations' },
);

export const AiObservationSchema = aiObservationSchema;
