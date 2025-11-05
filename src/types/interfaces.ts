import mongoose, { Document } from 'mongoose';

export interface IUserData {
    email: string;
    password: string;
    name: string;
    phone?: string;
    picture?: string;
    age: number;
    gender: 'male' | 'female';
    height: number; // in cm
    weight: number; // in kg
    activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
    path: 'healthy' | 'lose' | 'muscle' | 'keto' | 'fasting' | 'custom';
    targetWeight?: number; // optional target weight
    allergies?: string[]; // food allergies
    dietaryRestrictions?: string[]; // dietary restrictions
    favoriteMeals: string[]; // favorite meals
    oauthProvider?: 'google' | 'facebook';
    preferences: { [key: string]: string | boolean | number };
    oauthId?: string;
    token?: string;
    createdAt?: Date;
    updatedAt?: Date;
    comparePassword?: (candidatePassword: string) => Promise<boolean>;
}

export interface IMeal {
    _id: string;
    name: string;
    ingredients: string[];
    calories: number;
    macros: {
      protein: number;
      carbs: number;
      fat: number;
    };
    category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    prepTime: number;
    done: boolean;
    usageCount?: number;
}   

export interface IDailyPlan {
    day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
    date: Date;
    meals: {
      breakfast: IMeal;
      lunch: IMeal;
      dinner: IMeal;
      snacks: IMeal[];
    };
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    waterIntake: number; // in glasses
    workouts: IWorkout[]; // calories burned through exercise
    netCalories: number; 
}

export interface IPlanData {
    userData: IUserData;
    weeklyPlan: IDailyPlan[];
}

export interface IWorkout {
    name: string;
    category: string;
    duration: number;
    caloriesBurned: number;
    done: boolean;
}

export interface IPlan extends Document {
    userId: mongoose.Types.ObjectId;
    title: string;
    userMetrics: {
      bmr: number;
      tdee: number;
      targetCalories: number;
      idealWeight: number;
      weightRange: string;
      dailyMacros: {
        protein: number;
        carbs: number;
        fat: number;
      };
    };
    userData: {
      age: number;
      gender: 'male' | 'female';
      height: number;
      weight: number;
      activityLevel: string;
      path: string;
      targetWeight?: number;
      allergies?: string[];
      dietaryRestrictions?: string[];
    };
    weeklyPlan: IDailyPlan[];
    language: string;
    generatedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface IMealCache extends Document {
    mealName: string;
    category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    calories: number;
    calorieRange: string; // e.g., "350-450" for flexible matching
    protein: number;
    carbs: number;
    fat: number;
    ingredients: string[];
    path: string; // healthy, lose, muscle, keto, fasting, custom
    dietaryTags: string[]; // vegetarian, gluten-free, dairy-free, etc.
    language: string;
    usageCount: number; // Track popularity
    lastUsed: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface IRecipe extends Document {
    mealName: string; // Reference to the meal this recipe is for
    title: string;
    description?: string;
    category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    servings: number;
    prepTime: number;
    cookTime: number;
    difficulty: 'easy' | 'medium' | 'hard';
    nutrition: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      fiber?: number;
    };
    ingredients: Array<{
      name: string;
      amount: string;
      unit: string;
      notes?: string;
    }>;
    instructions: Array<{
      step: number;
      instruction: string;
      time?: number;
      temperature?: number;
    }>;
    equipment: string[];
    tags: string[];
    dietaryInfo: {
      isVegetarian: boolean;
      isVegan: boolean;
      isGlutenFree: boolean;
      isDairyFree: boolean;
      isKeto: boolean;
      isLowCarb: boolean;
    };
    mealPrepNotes?: string;
    variations?: string[];
    chefTips?: string[];
    language: string;
    usageCount: number; // Track how often this recipe is requested
    lastUsed: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface IShoppingListCache extends Document {
    ingredientsHash: string; // Hash of ingredients array for quick lookup
    ingredients: string[];
    path: string;
    language: string;
    shoppingList: string;
    usageCount: number;
    lastUsed: Date;
    createdAt: Date;
  }

  export interface IGoal extends Document {
    userId: mongoose.Types.ObjectId;
    goal: string;
    description: string;
    category: string;
    targetDate: Date;
    startDate: Date;
    progress: number;
    status: string;
    target: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface IDailyProgress extends Document {
    userId: mongoose.Types.ObjectId;
    date: Date;
    planId: mongoose.Types.ObjectId;
    caloriesConsumed: number;
    caloriesGoal: number;
    protein: {
        consumed: number;
        goal: number;
    };
    carbs: {
        consumed: number;
        goal: number;
    };
    fat: {
        consumed: number;
        goal: number;
    };
    water: {
        consumed: number;
        goal: number;
    }
    meals: {
        breakfast: IMeal;
        lunch: IMeal;
        dinner: IMeal;
        snacks: IMeal[]; // number of snacks completed
    };
    workouts: { name: string, category: string, duration: number, caloriesBurned: number, done: boolean }[];
    weight?: number; // optional daily weight tracking
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface JwtPayload {
  id: string;
}