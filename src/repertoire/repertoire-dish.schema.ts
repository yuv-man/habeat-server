import { Schema } from "mongoose";

/**
 * A dish the user cooks — the content of their plan. See docs/the-repertoire.md.
 *
 * One document per dish per user. A dish the user declined is kept too, with
 * status `declined`, so capture never proposes it again.
 */

export const RepertoireDish = { name: "RepertoireDish" };

export const REPERTOIRE_STATUSES = ["active", "paused", "retired", "declined"] as const;
export type RepertoireStatus = (typeof REPERTOIRE_STATUSES)[number];

export const REPERTOIRE_SOURCES = [
  "onboarding",
  "logged",
  "promoted",
  "manual",
  /** Added by hearting a meal in the plan — the favourites feature. */
  "favourite",
] as const;
export type RepertoireSource = (typeof REPERTOIRE_SOURCES)[number];

export const NUTRITION_CONFIDENCE = ["estimated", "logged", "user-confirmed", "photo"] as const;

export interface IDishNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export interface IRepertoireTune {
  level: 1 | 2 | 3;
  /** What this version is called — the user sees this name on their plan.
   *  A version without its own name is a change nobody notices. */
  name?: string;
  /** One line relating it to their dish: "Your schnitzel, oven-baked". */
  swapNote?: string;
  /** The full diff from the usual version, not just this level's additions. */
  changes: string[];
  ingredients: { name: string; amount: string }[];
  nutritionPerServing: IDishNutrition;
  acceptedAt?: Date;
  rejectedAt?: Date;
  /** Two rejections at one level pin the dish below it (§5). */
  rejections: number;
}

export interface IRepertoireDish {
  userId: Schema.Types.ObjectId;
  name: string;
  canonicalKey: string;
  slots: ("breakfast" | "lunch" | "dinner" | "snack")[];
  source: RepertoireSource;
  /** Hearted by the user. "My meals" is one list: dishes they cook and meals
   *  they loved from a plan are the same thing to a person, and both are what
   *  the planner should build around. */
  favourite: boolean;
  /** The meal document this came from, when it was hearted in a plan. */
  mealId?: string;
  /** Picture for the my-meals screen; `icon` is the fallback when there is none. */
  imageUrl?: string;
  icon?: string;
  usual: {
    /** Unknown for dishes captured from logs — progress snapshots carry no
     *  ingredients. Filled when the dish is first tuned. */
    ingredients: { name: string; amount: string }[];
    /** How many people the pot feeds. Null until asked. Habeat only ever
     *  tunes the user's own portion (§12). */
    servings: number | null;
    prepMinutes: number | null;
    nutritionPerServing: IDishNutrition | null;
    nutritionConfidence: (typeof NUTRITION_CONFIDENCE)[number];
  };
  tunes: IRepertoireTune[];
  currentTuneLevel: 0 | 1 | 2 | 3;
  /** The highest level this user tolerates for this dish. The Brain's own
   *  limit (§7) never takes a dish past it. */
  tuneCeiling: 0 | 1 | 2 | 3;
  /** Diet path the tunes were written for. A different path makes them stale. */
  tunedForPath: string | null;
  tunedAt: Date | null;
  rhythm: {
    /** What the user told us. Null for dishes captured from logs. */
    usualPerMonth: number | null;
    /** What the logs show, refreshed on read. */
    observedPerMonth: number;
    lastCookedOn: string | null;
    leftoversFriendly: boolean;
  };
  status: RepertoireStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const nutritionSchema = new Schema<IDishNutrition>(
  {
    calories: { type: Number, required: true },
    protein: { type: Number, required: true },
    carbs: { type: Number, required: true },
    fat: { type: Number, required: true },
    fiber: { type: Number, required: false },
  },
  { _id: false },
);

const tuneSchema = new Schema<IRepertoireTune>(
  {
    level: { type: Number, enum: [1, 2, 3], required: true },
    name: { type: String, required: false },
    swapNote: { type: String, required: false },
    changes: { type: [String], default: [] },
    ingredients: { type: [{ name: String, amount: String, _id: false }], default: [] },
    nutritionPerServing: { type: nutritionSchema, required: true },
    acceptedAt: { type: Date, required: false },
    rejectedAt: { type: Date, required: false },
    rejections: { type: Number, default: 0 },
  },
  { _id: false },
);

const repertoireDishSchema = new Schema<IRepertoireDish>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    canonicalKey: { type: String, required: true },
    slots: {
      type: [String],
      enum: ["breakfast", "lunch", "dinner", "snack"],
      default: [],
    },
    source: { type: String, enum: REPERTOIRE_SOURCES, required: true },
    favourite: { type: Boolean, default: false },
    mealId: { type: String, required: false },
    imageUrl: { type: String, required: false },
    icon: { type: String, required: false },
    usual: {
      ingredients: {
        type: [{ name: String, amount: String, _id: false }],
        default: [],
      },
      servings: { type: Number, default: null },
      prepMinutes: { type: Number, default: null },
      nutritionPerServing: { type: nutritionSchema, default: null },
      nutritionConfidence: {
        type: String,
        enum: NUTRITION_CONFIDENCE,
        default: "estimated",
      },
    },
    tunes: { type: [tuneSchema], default: [] },
    currentTuneLevel: { type: Number, enum: [0, 1, 2, 3], default: 0 },
    tuneCeiling: { type: Number, enum: [0, 1, 2, 3], default: 3 },
    tunedForPath: { type: String, default: null },
    tunedAt: { type: Date, default: null },
    rhythm: {
      usualPerMonth: { type: Number, default: null },
      observedPerMonth: { type: Number, default: 0 },
      lastCookedOn: { type: String, default: null },
      leftoversFriendly: { type: Boolean, default: false },
    },
    status: { type: String, enum: REPERTOIRE_STATUSES, default: "active" },
  },
  { timestamps: true, collection: "repertoire_dishes" },
);

// One document per dish per user — capture relies on this to stay idempotent.
repertoireDishSchema.index({ userId: 1, canonicalKey: 1 }, { unique: true });
repertoireDishSchema.index({ userId: 1, status: 1 });
repertoireDishSchema.index({ userId: 1, favourite: 1 });

export const RepertoireDishSchema = repertoireDishSchema;
