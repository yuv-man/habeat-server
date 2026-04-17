/**
 * Types for WebSocket streaming of meal plan generation
 *
 * Flow:
 * 1. Client connects and emits 'generate-plan' with GeneratePlanRequest
 * 2. Server emits 'plan-skeleton' with just meal names (fast, ~5-8s)
 * 3. Server emits 'plan-progress' as details are filled in
 * 4. Server emits 'plan-complete' with final plan
 * 5. On error, server emits 'plan-error'
 */

import { IGoal } from "../../types/interfaces";

// === Client -> Server Events ===

export interface GeneratePlanRequest {
  userId: string;
  weekStartDate?: string; // ISO date string
  planType?: "daily" | "weekly";
  language?: string;
  useMock?: boolean;
  goals?: IGoal[];
  planTemplate?: string;
}

// === Server -> Client Events ===

// Skeleton meal (just name, no details)
export interface SkeletonMeal {
  name: string;
  category: "breakfast" | "lunch" | "dinner" | "snack";
  calories?: number; // Rough estimate
}

// Skeleton day (minimal data for fast display)
export interface SkeletonDay {
  date: string; // YYYY-MM-DD
  day: string; // "monday", "tuesday", etc.
  meals: {
    breakfast: SkeletonMeal;
    lunch: SkeletonMeal;
    dinner: SkeletonMeal;
    snacks: SkeletonMeal[];
  };
  hasWorkout: boolean;
}

// Full meal with all details
export interface FullMeal {
  _id?: string;
  name: string;
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  category: string;
  ingredients: Array<[string, string, string?]>; // [name, amount, category?]
  prepTime: number;
  done?: boolean;
}

// Full day with all details
export interface FullDay {
  date: string;
  day: string;
  meals: {
    breakfast: FullMeal;
    lunch: FullMeal;
    dinner: FullMeal;
    snacks: FullMeal[];
  };
  workouts: Array<{
    name: string;
    category: string;
    duration: number;
    caloriesBurned: number;
    completed?: boolean;
  }>;
  hydration?: {
    waterTarget: number;
    recommendations: string[];
  };
  totalMacros?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

// Event payloads
export interface PlanSkeletonPayload {
  status: "skeleton";
  weeklyPlan: SkeletonDay[];
  estimatedCompletionMs: number; // Estimated time for full details
  message: string;
}

export interface PlanProgressPayload {
  status: "progress";
  phase: "details" | "enrichment";
  completedDays: number;
  totalDays: number;
  updatedDays: FullDay[];
  percentComplete: number;
  message: string;
}

export interface PlanCompletePayload {
  status: "complete";
  mealPlan: {
    weeklyPlan: FullDay[];
  };
  planType: string;
  language: string;
  generatedAt: string;
  totalTimeMs: number;
  message: string;
}

export interface PlanErrorPayload {
  status: "error";
  error: string;
  phase?: "skeleton" | "details" | "enrichment";
  recoverable: boolean;
  partialData?: SkeletonDay[] | FullDay[];
}

// Socket event names
export const SOCKET_EVENTS = {
  // Client -> Server
  GENERATE_PLAN: "generate-plan",
  CANCEL_GENERATION: "cancel-generation",

  // Server -> Client
  PLAN_SKELETON: "plan-skeleton",
  PLAN_PROGRESS: "plan-progress",
  PLAN_COMPLETE: "plan-complete",
  PLAN_ERROR: "plan-error",

  // Connection events
  CONNECTION: "connection",
  DISCONNECT: "disconnect",
  AUTHENTICATED: "authenticated",
  AUTH_ERROR: "auth-error",
} as const;

// Generation phases for tracking
export enum GenerationPhase {
  CONNECTING = "connecting",
  SKELETON = "skeleton",
  DETAILS = "details",
  ENRICHMENT = "enrichment",
  COMPLETE = "complete",
  ERROR = "error",
  CANCELLED = "cancelled",
}
