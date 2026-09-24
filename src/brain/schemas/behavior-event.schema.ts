import { Schema } from "mongoose";

/**
 * The Brain's unit of observation.
 *
 * Everything else in Habeat records *what food was involved*. The Brain needs
 * to know *what happened*: when, whether it was planned, and what the user was
 * feeling at the time. "Pizza at 21:30" is a meal log; "an unplanned dinner at
 * 21:30 on a high-stress, low-energy day" is a behaviour, and only the second
 * one can be reasoned about.
 *
 * Events are **projected**, not written twice. `event.projector.ts` derives
 * them from the collections the app already writes (DailyProgress, MoodEntry,
 * MealMoodCorrelation), so there is exactly one system of record and the Brain
 * cannot drift from it. This collection is a materialised cache of that
 * projection, keyed so a re-run overwrites rather than duplicates.
 */

export const BehaviorEvent = { name: "BehaviorEvent" };

export enum BehaviorEventType {
  MEAL_LOGGED = "meal_logged",
  SNACK_LOGGED = "snack_logged",
  MEAL_SKIPPED = "meal_skipped",
  WATER_LOGGED = "water_logged",
  WELLNESS_LOGGED = "wellness_logged",
  PLAN_MEAL_COMPLETED = "plan_meal_completed",
  PLAN_MEAL_REPLACED = "plan_meal_replaced",
  TAKEAWAY_LOGGED = "takeaway_logged",
  WORKOUT_COMPLETED = "workout_completed",
}

/**
 * What was true around the event. Every field is optional and stays absent
 * when unknown — the pattern engine weighs "we never asked" differently from
 * "the answer was no", and a default here would erase that distinction.
 */
export interface IBehaviorEventContext {
  feeling?: string;
  hunger?: number;
  planned?: boolean;
  energy?: number;
  stress?: number;
  location?: string;
  social?: boolean;
  /** MEAL_SKIPPED only: the user said so, rather than the slot being left untouched. */
  explicitSkip?: boolean;
  /** MEAL_SKIPPED only: why, when they said ("time-pressure", "stress", …). */
  skipReason?: string;
}

export interface IBehaviorEvent {
  userId: Schema.Types.ObjectId;
  type: BehaviorEventType;
  mealId?: string;
  mealType?: string;
  mealName?: string;
  /** When it happened, local to the user. */
  timestamp: Date;
  /**
   * False when `timestamp` is a slot-typical fallback rather than something
   * the tracker actually recorded. Any claim about time of day — late-night
   * eating above all — must ignore inexact events, or it is inventing the
   * very thing it claims to have observed.
   */
  timestampIsExact: boolean;
  /** YYYY-MM-DD in the user's local zone. The day-level join key. */
  dateKey: string;
  context?: IBehaviorEventContext;
  /** Which collection this was projected from, so evidence can be traced. */
  source: string;
  /**
   * Stable identity for the underlying record. Re-projecting the same window
   * updates in place instead of doubling every pattern's evidence count.
   */
  fingerprint: string;
}

const contextSchema = new Schema<IBehaviorEventContext>(
  {
    feeling: String,
    hunger: Number,
    planned: Boolean,
    energy: Number,
    stress: Number,
    location: String,
    social: Boolean,
    explicitSkip: Boolean,
    skipReason: String,
  },
  { _id: false },
);

const behaviorEventSchema = new Schema<IBehaviorEvent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      // No single-field index here: every query is scoped by user *and*
      // something else, and the compound indexes below already lead on userId.
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(BehaviorEventType),
      required: true,
      index: true,
    },
    mealId: String,
    mealType: String,
    mealName: String,
    timestamp: { type: Date, required: true },
    timestampIsExact: { type: Boolean, default: false },
    dateKey: { type: String, required: true },
    context: { type: contextSchema, required: false },
    source: String,
    fingerprint: { type: String, required: true },
  },
  { timestamps: true, collection: "behavior_events" },
);

// The projection is idempotent: re-running a window replaces its events.
behaviorEventSchema.index({ userId: 1, fingerprint: 1 }, { unique: true });
behaviorEventSchema.index({ userId: 1, timestamp: -1 });

export const BehaviorEventSchema = behaviorEventSchema;
