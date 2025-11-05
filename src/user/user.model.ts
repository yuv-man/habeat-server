import { BaseSchema, model } from "../db";
import { IUserData } from "../types/interfaces";
import bcrypt from 'bcrypt';
import mongoose, { CallbackError } from 'mongoose';

// name
const modelName = "User";

// project schema
const userSchema = BaseSchema<IUserData>({
  name: String,
  email: String,
  password: String, // Add password field for OAuth users
  phone: String,
  picture: String,
  age: Number,
  gender: String,
  height: Number,
  weight: Number,
  activityLevel: String,
  path: String,
  targetWeight: Number,
  allergies: [String],
  dietaryRestrictions: [String],
  favoriteMeals: [String],
  preferences: { type: Map, of: String, default: {} },
  // OAuth fields
  oauthProvider: String, // 'google', 'facebook', or null
  oauthId: String, // OAuth provider's user ID
});

// Hash password before saving (only if password is provided and not OAuth)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || this.password?.startsWith('google_oauth_') || this.password?.startsWith('facebook_oauth_')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as CallbackError);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword: string) {
  // Skip password comparison for OAuth users
  if (this.password?.startsWith('google_oauth_') || this.password?.startsWith('facebook_oauth_')) {
    return false; // OAuth users should not use password login
  }
  return bcrypt.compare(candidatePassword, this.password);
};

// model
export const User = model<IUserData>(modelName, userSchema);
