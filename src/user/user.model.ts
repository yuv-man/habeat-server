import { IUserData } from "../types/interfaces";
import bcrypt from "bcrypt";
import mongoose, { CallbackError, Schema } from "mongoose";

// Model name constant
export const User = { name: "User" };

// project schema - All fields are optional for debugging
const userSchemaDefinition = {
  name: { type: String, required: false },
  email: { type: String, required: false },
  password: { type: String, required: false }, // Add password field for OAuth users
  phone: { type: String, required: false },
  profilePicture: { type: String, required: false },
  age: { type: Number, required: false },
  gender: { type: String, required: false },
  height: { type: Number, required: false },
  weight: { type: Number, required: false },
  path: { type: String, required: false },
  targetWeight: { type: Number, required: false },
  allergies: { type: [String], required: false, default: [] },
  dietaryRestrictions: { type: [String], required: false, default: [] },
  foodPreferences: { type: [String], required: false, default: [] }, // food preferences from KYC (e.g., "Italian", "Seafood")
  favoriteMeals: { type: [String], required: false, default: [] }, // actual meal IDs that user has favorited
  dislikes: { type: [String], required: false, default: [] }, // disliked meals/foods
  fastingHours: { type: Number, required: false }, // For 8-16 fasting diet type
  fastingStartTime: { type: String, required: false }, // Fasting start time
  preferences: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: false,
    default: new Map(),
  },
  // Health metrics
  workoutFrequency: { type: Number, required: false }, // Number of workouts per week
  bmr: { type: Number, required: false }, // Basal Metabolic Rate
  tdee: { type: Number, required: false }, // Total Daily Energy Expenditure
  idealWeight: { type: Number, required: false },
  // Premium status
  isPremium: { type: Boolean, default: false, required: false },
  // OAuth fields
  oauthProvider: { type: String, required: false }, // 'google', 'facebook', or null
  oauthId: { type: String, required: false }, // OAuth provider's user ID
};

// Export schema for NestJS
export const UserSchema = new Schema(userSchemaDefinition, {
  timestamps: true,
  versionKey: false,
  strict: true, // Prevent arbitrary data injection - only allow defined fields
  collection: "users",
});

// Apply the same pre-save hook and methods to the exported schema
UserSchema.pre("save", async function (next) {
  if (
    !this.isModified("password") ||
    (this as any).password?.startsWith("google_oauth_") ||
    (this as any).password?.startsWith("facebook_oauth_")
  ) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    (this as any).password = await bcrypt.hash((this as any).password, salt);
    next();
  } catch (error) {
    next(error as CallbackError);
  }
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string
) {
  if (
    (this as any).password?.startsWith("google_oauth_") ||
    (this as any).password?.startsWith("facebook_oauth_")
  ) {
    return false;
  }
  return bcrypt.compare(candidatePassword, (this as any).password);
};

// Index for email lookups (unique)
UserSchema.index({ email: 1 }, { unique: true, sparse: true });

// Index for OAuth lookups
UserSchema.index({ oauthProvider: 1, oauthId: 1 });
