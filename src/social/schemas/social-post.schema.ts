import mongoose, { Schema } from "mongoose";

export const SocialPost = { name: "SocialPost" };

export enum PostType {
  ACHIEVEMENT = "achievement",
  STREAK = "streak",
  WEEKLY_SUMMARY = "weekly_summary",
  HABIT_SCORE = "habit_score",
  CBT_MILESTONE = "cbt_milestone",
  TEXT = "text",
}

export enum PostVisibility {
  PUBLIC = "public",
  FRIENDS = "friends",
  PRIVATE = "private",
}

const commentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const postContentSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    stats: { type: Map, of: Schema.Types.Mixed },
    imageUrl: { type: String },
    badgeId: { type: String },
    badgeName: { type: String },
    badgeIcon: { type: String },
    streakDays: { type: Number },
    habitScore: { type: Number },
    weeklyData: {
      daysTracked: { type: Number },
      consistencyScore: { type: Number },
      avgCalories: { type: Number },
    },
    cbtData: {
      moodsLogged: { type: Number },
      exercisesCompleted: { type: Number },
      moodImprovement: { type: Number },
    },
  },
  { _id: false }
);

export const SocialPostSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: Object.values(PostType),
      required: true,
    },
    content: { type: postContentSchema, required: true },
    visibility: {
      type: String,
      enum: Object.values(PostVisibility),
      default: PostVisibility.PUBLIC,
    },
    caption: { type: String, maxlength: 280 },
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    comments: [commentSchema],
    shares: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "social_posts",
  }
);

// Indexes
SocialPostSchema.index({ userId: 1, createdAt: -1 });
SocialPostSchema.index({ visibility: 1, createdAt: -1 });
SocialPostSchema.index({ type: 1 });
