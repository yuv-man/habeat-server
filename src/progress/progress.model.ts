import mongoose, { Schema } from 'mongoose';
import { IDailyProgress, IMeal } from '../types/interfaces';

const mealSnapshotSchema = new Schema({
    name: { type: String, required: true },
    calories: { type: Number, required: true },
    macros: {
        protein: { type: Number, required: true },
        carbs: { type: Number, required: true },
        fat: { type: Number, required: true }
    },
    category: { type: String, enum: ['breakfast', 'lunch', 'dinner', 'snack'], required: true },
    prepTime: { type: Number, required: true },
    done: { type: Boolean, required: true, default: false },
    _id: { type: Schema.Types.ObjectId, ref: 'Meal', required: true }
}, { _id: false });

const dailyProgressSchema = new Schema<IDailyProgress>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    planId: {
        type: Schema.Types.ObjectId,
        ref: 'Plan',
        required: true
    },
    caloriesConsumed: {
        type: Number,
        required: true,
        default: 0
    },
    caloriesGoal: {
        type: Number,
        required: true,
        default: 2000
    },
    water: {
        consumed: {
            type: Number,
            required: true,
            default: 0
        },
        goal: {
            type: Number,
            required: true,
            default: 8
        }
    },
    workouts: [{
        name: {
            type: String,
            required: true
        },
        category: {
            type: String,
            enum: ['cardio', 'strength', 'flexibility', 'balance', 'endurance', 'yoga', 'pilates', 'hiit', 'running', 'cycling', 'swimming', 'walking', 'bodyweight', 'weights', 'core', 'stretching'],
            required: true
        },
        duration: {
            type: Number,
            required: true
        },
        caloriesBurned: {
            type: Number,
            required: true
        },
        done: {
            type: Boolean,
            required: true
        }
    }],
    meals: {
        breakfast: mealSnapshotSchema,
        lunch: mealSnapshotSchema,
        dinner: mealSnapshotSchema,
        snacks: [mealSnapshotSchema]
    },
    protein: { consumed: { type: Number, default: 0 }, goal: { type: Number, default: 0 } },
    carbs: { consumed: { type: Number, default: 0 }, goal: { type: Number, default: 0 } },
    fat: { consumed: { type: Number, default: 0 }, goal: { type: Number, default: 0 } },
    weight: {
        type: Number
    },
    notes: {
        type: String
    }
}, {
    timestamps: true
});

// Compound index for efficient queries by user and date
dailyProgressSchema.index({ userId: 1, date: 1 }, { unique: true });

// Index for date range queries
dailyProgressSchema.index({ date: 1 });

export const DailyProgress = mongoose.model<IDailyProgress>('DailyProgress', dailyProgressSchema); 