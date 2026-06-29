import mongoose, { Schema, Document } from "mongoose";

export const EatingProfile = { name: "EatingProfile" };

export interface IRiskWindow {
  dayOfWeek: number;
  hourStart: number;
  hourEnd: number;
  risk: "medium" | "high";
}

export interface INutritionTendency {
  calorieAccuracy: "under" | "on-target" | "over";
  macroWeakness: "protein" | "fiber" | "healthy-fats" | null;
}

export interface IEatingProfile extends Document {
  userId: mongoose.Types.ObjectId;
  version: number;
  generatedAt: Date;
  confidence: "seed" | "low" | "medium" | "high";
  dataSnapshot: { meals: number; moodLogs: number; correlations: number };
  eatingType: "mindful" | "emotional" | "habitual" | "social" | "mixed";
  emotionalEatingRisk: "low" | "medium" | "high";
  triggerScores: Record<string, number>;
  riskWindows: IRiskWindow[];
  bestMeals: { mealName: string; avgMoodLift: number }[];
  patternTags: string[];
  suggestionTags: string[];
  nutritionTendency: INutritionTendency;
  lastCorrelationCount: number;
}

const riskWindowSchema = new Schema(
  { dayOfWeek: Number, hourStart: Number, hourEnd: Number, risk: String },
  { _id: false }
);

export const EatingProfileSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    version: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
    confidence: { type: String, enum: ["seed", "low", "medium", "high"], default: "seed" },
    dataSnapshot: {
      meals: { type: Number, default: 0 },
      moodLogs: { type: Number, default: 0 },
      correlations: { type: Number, default: 0 },
    },
    eatingType: {
      type: String,
      enum: ["mindful", "emotional", "habitual", "social", "mixed"],
      default: "mixed",
    },
    emotionalEatingRisk: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    triggerScores: { type: Map, of: Number, default: new Map() },
    riskWindows: { type: [riskWindowSchema], default: [] },
    bestMeals: {
      type: [{ mealName: String, avgMoodLift: Number }],
      default: [],
      _id: false,
    },
    patternTags: { type: [String], default: [] },
    suggestionTags: { type: [String], default: [] },
    nutritionTendency: {
      calorieAccuracy: { type: String, enum: ["under", "on-target", "over"], default: "on-target" },
      macroWeakness: { type: String, default: null },
    },
    lastCorrelationCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

EatingProfileSchema.index({ userId: 1 }, { unique: true });
