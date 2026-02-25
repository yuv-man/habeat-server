import mongoose, { Schema, Document } from "mongoose";

// Type definitions
export type MoodLevel = 1 | 2 | 3 | 4 | 5;

export type MoodCategory =
  | "happy"
  | "calm"
  | "energetic"
  | "neutral"
  | "tired"
  | "stressed"
  | "anxious"
  | "sad"
  | "angry";

export type MoodTrigger =
  | "work"
  | "relationships"
  | "health"
  | "finances"
  | "sleep"
  | "food"
  | "exercise"
  | "weather"
  | "social"
  | "other";

export type CognitiveDistortionType =
  | "all_or_nothing"
  | "overgeneralization"
  | "mental_filter"
  | "disqualifying_positive"
  | "jumping_to_conclusions"
  | "magnification"
  | "emotional_reasoning"
  | "should_statements"
  | "labeling"
  | "personalization";

export type CBTExerciseType =
  | "thought_record"
  | "behavioral_activation"
  | "mindful_eating"
  | "gratitude"
  | "progressive_relaxation"
  | "breathing"
  | "cognitive_restructuring"
  | "urge_surfing"
  | "self_compassion"
  | "body_scan";

export type CBTExerciseCategory = "mood" | "eating" | "stress" | "general";
export type CBTExerciseDifficulty = "beginner" | "intermediate" | "advanced";
export type MealType = "breakfast" | "lunch" | "dinner" | "snacks";

// Model name constants for NestJS
export const MoodEntry = { name: "MoodEntry" };
export const ThoughtEntry = { name: "ThoughtEntry" };
export const CBTExerciseCompletion = { name: "CBTExerciseCompletion" };
export const MealMoodCorrelation = { name: "MealMoodCorrelation" };

// Interfaces
export interface IMoodEntry extends Document {
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  moodLevel: MoodLevel;
  moodCategory: MoodCategory;
  energyLevel?: MoodLevel;
  stressLevel?: MoodLevel;
  notes?: string;
  triggers?: MoodTrigger[];
  linkedMealId?: mongoose.Types.ObjectId;
  linkedMealType?: MealType;
  createdAt: Date;
  updatedAt: Date;
}

export interface IThoughtEmotion {
  emotion: string;
  intensity: MoodLevel;
}

export interface IThoughtEntry extends Document {
  userId: mongoose.Types.ObjectId;
  date: string;
  time: string;
  situation: string;
  automaticThought: string;
  emotions: IThoughtEmotion[];
  cognitiveDistortions?: CognitiveDistortionType[];
  evidence?: {
    supporting: string[];
    contradicting: string[];
  };
  balancedThought?: string;
  outcomeEmotion?: IThoughtEmotion;
  linkedMealId?: mongoose.Types.ObjectId;
  linkedMealType?: MealType;
  isEmotionalEating?: boolean;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICBTExerciseCompletion extends Document {
  userId: mongoose.Types.ObjectId;
  exerciseId: string;
  exerciseType: CBTExerciseType;
  date: string;
  duration: number; // actual time spent in minutes
  responses?: Record<string, any>;
  reflection?: string;
  moodBefore?: MoodLevel;
  moodAfter?: MoodLevel;
  linkedMealId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface IMealMoodCorrelation extends Document {
  userId: mongoose.Types.ObjectId;
  mealId: mongoose.Types.ObjectId;
  mealName: string;
  mealType: MealType;
  date: string;
  moodBefore?: {
    moodLevel: MoodLevel;
    moodCategory: MoodCategory;
  };
  moodAfter?: {
    moodLevel: MoodLevel;
    moodCategory: MoodCategory;
  };
  wasEmotionalEating: boolean;
  hungerLevelBefore?: MoodLevel;
  satisfactionAfter?: MoodLevel;
  notes?: string;
  createdAt: Date;
}

// Mood Entry Schema
const moodEntrySchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    time: {
      type: String,
      required: true,
    },
    moodLevel: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    moodCategory: {
      type: String,
      required: true,
      enum: [
        "happy",
        "calm",
        "energetic",
        "neutral",
        "tired",
        "stressed",
        "anxious",
        "sad",
        "angry",
      ],
    },
    energyLevel: {
      type: Number,
      min: 1,
      max: 5,
    },
    stressLevel: {
      type: Number,
      min: 1,
      max: 5,
    },
    notes: String,
    triggers: [
      {
        type: String,
        enum: [
          "work",
          "relationships",
          "health",
          "finances",
          "sleep",
          "food",
          "exercise",
          "weather",
          "social",
          "other",
        ],
      },
    ],
    linkedMealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
    },
    linkedMealType: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snacks"],
    },
  },
  {
    timestamps: true,
    collection: "mood_entries",
  }
);

// Compound indexes for efficient queries
moodEntrySchema.index({ userId: 1, date: 1 });
moodEntrySchema.index({ userId: 1, createdAt: -1 });

// Thought Entry Schema
const thoughtEntrySchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    time: {
      type: String,
      required: true,
    },
    situation: {
      type: String,
      required: true,
    },
    automaticThought: {
      type: String,
      required: true,
    },
    emotions: [
      {
        emotion: { type: String, required: true },
        intensity: { type: Number, required: true, min: 1, max: 5 },
      },
    ],
    cognitiveDistortions: [
      {
        type: String,
        enum: [
          "all_or_nothing",
          "overgeneralization",
          "mental_filter",
          "disqualifying_positive",
          "jumping_to_conclusions",
          "magnification",
          "emotional_reasoning",
          "should_statements",
          "labeling",
          "personalization",
        ],
      },
    ],
    evidence: {
      supporting: [String],
      contradicting: [String],
    },
    balancedThought: String,
    outcomeEmotion: {
      emotion: String,
      intensity: { type: Number, min: 1, max: 5 },
    },
    linkedMealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
    },
    linkedMealType: {
      type: String,
      enum: ["breakfast", "lunch", "dinner", "snacks"],
    },
    isEmotionalEating: {
      type: Boolean,
      default: false,
    },
    tags: [String],
  },
  {
    timestamps: true,
    collection: "thought_entries",
  }
);

thoughtEntrySchema.index({ userId: 1, createdAt: -1 });
thoughtEntrySchema.index({ userId: 1, isEmotionalEating: 1 });

// CBT Exercise Completion Schema
const cbtExerciseCompletionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    exerciseId: {
      type: String,
      required: true,
    },
    exerciseType: {
      type: String,
      required: true,
      enum: [
        "thought_record",
        "behavioral_activation",
        "mindful_eating",
        "gratitude",
        "progressive_relaxation",
        "breathing",
        "cognitive_restructuring",
        "urge_surfing",
        "self_compassion",
        "body_scan",
      ],
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    responses: {
      type: mongoose.Schema.Types.Mixed,
    },
    reflection: String,
    moodBefore: {
      type: Number,
      min: 1,
      max: 5,
    },
    moodAfter: {
      type: Number,
      min: 1,
      max: 5,
    },
    linkedMealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "cbt_exercise_completions",
  }
);

cbtExerciseCompletionSchema.index({ userId: 1, createdAt: -1 });
cbtExerciseCompletionSchema.index({ userId: 1, exerciseType: 1 });

// Meal-Mood Correlation Schema
const mealMoodCorrelationSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
      required: true,
    },
    mealName: {
      type: String,
      required: true,
    },
    mealType: {
      type: String,
      required: true,
      enum: ["breakfast", "lunch", "dinner", "snacks"],
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    moodBefore: {
      moodLevel: { type: Number, min: 1, max: 5 },
      moodCategory: {
        type: String,
        enum: [
          "happy",
          "calm",
          "energetic",
          "neutral",
          "tired",
          "stressed",
          "anxious",
          "sad",
          "angry",
        ],
      },
    },
    moodAfter: {
      moodLevel: { type: Number, min: 1, max: 5 },
      moodCategory: {
        type: String,
        enum: [
          "happy",
          "calm",
          "energetic",
          "neutral",
          "tired",
          "stressed",
          "anxious",
          "sad",
          "angry",
        ],
      },
    },
    wasEmotionalEating: {
      type: Boolean,
      required: true,
      default: false,
    },
    hungerLevelBefore: {
      type: Number,
      min: 1,
      max: 5,
    },
    satisfactionAfter: {
      type: Number,
      min: 1,
      max: 5,
    },
    notes: String,
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "meal_mood_correlations",
  }
);

mealMoodCorrelationSchema.index({ userId: 1, createdAt: -1 });
mealMoodCorrelationSchema.index({ userId: 1, wasEmotionalEating: 1 });
mealMoodCorrelationSchema.index({ userId: 1, mealType: 1 });

// Export schemas
export const MoodEntrySchema = moodEntrySchema;
export const ThoughtEntrySchema = thoughtEntrySchema;
export const CBTExerciseCompletionSchema = cbtExerciseCompletionSchema;
export const MealMoodCorrelationSchema = mealMoodCorrelationSchema;
