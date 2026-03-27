import { Schema } from "mongoose";

export const Follow = { name: "Follow" };

export const FollowSchema = new Schema(
  {
    followerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    followingId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "follows",
  }
);

// Compound unique index to prevent duplicate follows
FollowSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

// Indexes for efficient queries
FollowSchema.index({ followerId: 1 });
FollowSchema.index({ followingId: 1 });
