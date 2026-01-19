import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ChallengeDocument = Challenge & Document;

@Schema({ timestamps: true })
export class Challenge {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    required: true,
    enum: [
      "meals_logged",
      "water_intake",
      "streak_days",
      "veggie_meals",
      "protein_goal",
      "workout_complete",
      "balanced_meals",
      "home_cooking",
    ],
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  icon: string;

  @Prop({ required: true })
  target: number;

  @Prop({ required: true, default: 0 })
  progress: number;

  @Prop({ required: true })
  xpReward: number;

  @Prop({ required: true, enum: ["easy", "medium", "hard"] })
  difficulty: string;

  @Prop({
    required: true,
    enum: ["active", "completed", "expired", "claimed"],
    default: "active",
  })
  status: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({
    required: true,
    enum: ["daily", "weekly"],
    default: "daily",
  })
  frequency: string;

  @Prop()
  completedAt?: Date;

  @Prop()
  claimedAt?: Date;
}

export const ChallengeSchema = SchemaFactory.createForClass(Challenge);

// Index for efficient queries
ChallengeSchema.index({ userId: 1, status: 1 });
ChallengeSchema.index({ endDate: 1 });
