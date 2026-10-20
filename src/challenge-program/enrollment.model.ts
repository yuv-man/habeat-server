import { Document, Schema } from "mongoose";
import { EnrollmentState } from "./enrollment.rules";

export const ChallengeEnrollment = { name: "ChallengeEnrollment" };

/** A user's journey through one pinned program version (design spec §3.2). */
export interface IChallengeEnrollment extends Document, EnrollmentState {
  userId: string;
  programId: string;
  programVersion: number;
  startedAt: Date;
  leftAt?: Date;
  pausedAt?: Date;
  totalPausedMs: number;
  /** Set when the enrollment carried answers over from one the user left. */
  continuedFrom?: string;
  createdAt: Date;
  updatedAt: Date;
}

const daySchema = new Schema(
  {
    day: { type: Number, required: true },
    lessonOpenedAt: Date,
    lessonReadAt: Date,
    actionStatus: {
      type: String,
      enum: ["not_started", "started", "done", "partly", "skipped"],
      default: "not_started",
    },
    actionAt: Date,
    answer: Schema.Types.Mixed,
    draft: Schema.Types.Mixed, // unfinished answers while "started"
    extras: Schema.Types.Mixed, // answers to the day's optional questions, by index
    note: String, // private; never posted
    outcome: String,
    source: { type: String, enum: ["manual", "meal_log", "swap"] },
  },
  { _id: false },
);

export const ChallengeEnrollmentSchema = new Schema<IChallengeEnrollment>(
  {
    userId: { type: String, required: true, index: true },
    programId: { type: String, required: true },
    programVersion: { type: Number, required: true },
    status: {
      type: String,
      enum: ["active", "paused", "completed", "left"],
      default: "active",
    },
    startedAt: { type: Date, required: true },
    completedAt: Date,
    leftAt: Date,
    pausedAt: Date,
    totalPausedMs: { type: Number, default: 0 },
    currentDay: { type: Number, default: 1 },
    dayUnlockedOn: { type: String, required: true },
    lastActivityAt: { type: Date, required: true },
    days: { type: [daySchema], default: [] },
    answers: { type: Schema.Types.Mixed, default: {} },
    milestones: {
      type: [{ id: String, reachedAt: Date, _id: false }],
      default: [],
    },
    continuedFrom: String,
  },
  { timestamps: true, minimize: false },
);

// One live journey at a time: a second active/paused enrollment fails to insert.
ChallengeEnrollmentSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["active", "paused"] } },
    name: "one_live_enrollment_per_user",
  },
);
ChallengeEnrollmentSchema.index({ userId: 1, status: 1, updatedAt: -1 });
