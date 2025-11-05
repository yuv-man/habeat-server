import mongoose, { Document, Schema } from 'mongoose';
import { IDailyPlan, IPlan, IWorkout } from '../types/interfaces';
import { Meal } from '../meal/meal.model';

const embeddedMealSchema = new Schema({
    name: { type: String, required: true },
    calories: { type: Number, required: true },
    macros: {
        protein: { type: Number, required: true },
        carbs: { type: Number, required: true },
        fat: { type: Number, required: true }
    },
    category: { type: String, enum: ['breakfast', 'lunch', 'dinner', 'snack'], required: true },
    ingredients: [String],
    prepTime: { type: Number, required: true },
    done: { type: Boolean, required: true, default: false },
    _id: { type: Schema.Types.ObjectId, ref: 'Meal', required: true }
}, { _id: false });

const workoutSchema = new Schema<IWorkout>({
    name: { type: String, required: true },
    duration: { type: Number, required: true },
    caloriesBurned: { type: Number, required: true },
    done: { type: Boolean, required: true, default: false }
});

const dayPlanSchema = new Schema<IDailyPlan>({
    day: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      required: true
    },
    date: {
      type: Date,
      required: true
    },
    meals: {
      breakfast: embeddedMealSchema,
      lunch: embeddedMealSchema,
      dinner: embeddedMealSchema,
      snacks: [embeddedMealSchema]
    },
    totalCalories: { type: Number, required: true },
    totalProtein: { type: Number, required: true },
    totalCarbs: { type: Number, required: true },
    totalFat: { type: Number, required: true },
    waterIntake: { type: Number },
    workouts: [{ type: workoutSchema }],
    netCalories: { type: Number, required: true }
  });
  
  const planSchema = new Schema<IPlan>({
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true // Each user can have only ONE plan
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    userMetrics: {
      bmr: { type: Number, required: true },
      tdee: { type: Number, required: true },
      targetCalories: { type: Number, required: true },
      idealWeight: { type: Number, required: true },
      weightRange: { type: String, required: true },
      dailyMacros: {
        protein: { type: Number },
        carbs: { type: Number },
        fat: { type: Number }
      }
    },
    userData: {
      age: { type: Number, required: true },
      gender: { type: String, enum: ['male', 'female'], required: true },
      height: { type: Number, required: true },
      weight: { type: Number, required: true },
      activityLevel: { type: String },
      path: { type: String, required: true },
      targetWeight: { type: Number },
      allergies: [{ type: String }],
      dietaryRestrictions: [{ type: String }]
    },
    weeklyPlan: [{ type: dayPlanSchema, required: true }],
    language: {
      type: String,
      default: 'en'
    }
  }, {
    timestamps: true
  });
  
  export const Plan = mongoose.model<IPlan>('Plan', planSchema);


