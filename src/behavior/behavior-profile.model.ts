import mongoose, { Schema, Document } from "mongoose";

/**
 * The living user profile — the single source of truth about how a user eats.
 *
 * This absorbed the former `EatingProfile` collection. Two profiles meant two
 * schedules, two LLM calls and two answers to the same question, and nothing
 * decided which one won when they disagreed. Everything now lands here, from
 * one analysis run.
 *
 * Three halves, kept deliberately apart:
 *
 *  - `behavior` and `context` are **computed**. Rates, day-of-week clusters,
 *    prep-time tolerance — code derives them from the behavioural summary, so
 *    they are reproducible and never drift because a model had an off day.
 *  - `patterns`, `narrative`, `recommendations` and `planningDirectives` are
 *    **written by the analyst**, and carry their own evidence and confidence —
 *    each tied to a named check that actually fired.
 *  - `checks` and `selfCheck` are the **verification record**: the predicates
 *    as they stood when the claims were made, and how those claims have held up
 *    since. See behavior-checks.ts.
 *
 * Anything the planner acts on comes from the computed half or from a directive
 * that survived validation. A profile is a standing description of how someone
 * actually lives, not a transcript of one model call.
 */

export const BehaviorProfile = { name: "BehaviorProfile" };

export type ProfileConfidence = "insufficient" | "low" | "medium" | "high";

export interface IBehaviorPattern {
  id: string;
  /** The check that licenced this claim. A pattern citing a check that did not
   *  fire is refused at validation — the model explains findings, it does not
   *  get to invent them. */
  checkId: string;
  area: string;
  pattern: string;
  evidence: string;
  frequency: string;
  occurrences: number;
  possibleExplanation: string;
  impactOnGoal: string;
  suggestedIntervention: string;
  confidence: number;
}

export interface IPlanningDirectives {
  maxPrepMinutes: number | null;
  simplifySlots: string[];
  flexibleSlots: string[];
  weekendNeedsOwnShape: boolean;
  increaseVariety: boolean;
  reduceLateEating: boolean;
  emphasiseMacro: string | null;
  notes: string[];
}

export interface IBehaviorProfile extends Document {
  userId: mongoose.Types.ObjectId;
  version: number;
  generatedAt: Date;
  confidence: ProfileConfidence;
  /** What the profile stands on, so a thin week can't be read as a firm finding. */
  dataSnapshot: {
    periodDays: number;
    daysWithData: number;
    mealsLogged: number;
    moodCheckIns: number;
    plannedMeals: number;
  };

  behavior: {
    breakfastAdherence: number | null;
    lunchAdherence: number | null;
    dinnerAdherence: number | null;
    snacksAdherence: number | null;
    overallAdherence: number | null;
    weekdayAdherence: number | null;
    weekendAdherence: number | null;
    prefersQuickMeals: number | null;
    varietyTolerance: number | null;
    waterConsistency: number | null;
    exerciseAdherence: number | null;
  };

  context: {
    busyDays: number[];
    lowMotivationDays: number[];
    lateEatingRate: number | null;
    stressCorrelatedWithSnacking: number | null;
    lowMoodAdherenceDrop: number | null;
    typicalMealTimes: Record<string, string>;
  };

  preferences: {
    favoriteMeals: string[];
    avoidMeals: string[];
    favoriteCategories: string[];
    effectiveMaxPrepMinutes: number | null;
  };

  /** ── absorbed from the former EatingProfile ──────────────────────────── */
  eatingType: "mindful" | "emotional" | "habitual" | "social" | "mixed";
  emotionalEatingRisk: "low" | "medium" | "high";
  triggerScores: Record<string, number>;
  riskWindows: { dayOfWeek: number; hourStart: number; hourEnd: number; risk: "medium" | "high" }[];
  bestMeals: { mealName: string; avgMoodLift: number }[];
  /** Tag vocabularies that select rows from the pattern and suggestion banks. */
  patternTags: string[];
  suggestionTags: string[];
  nutritionTendency: {
    calorieAccuracy: "under" | "on-target" | "over";
    macroWeakness: string | null;
  };

  /** ── the verification record ──────────────────────────────────────────── */
  /** Every check and its value at the moment these claims were made. */
  checks: {
    id: string;
    fired: boolean;
    value: number | null;
    threshold: number;
    direction: string;
    basis: number;
    evidence: string;
  }[];
  /** How the last verification found the previous run's claims holding up. */
  selfCheck: {
    verifiedAt: Date;
    /** The profile version whose claims were tested. */
    testedVersion: number;
    results: {
      id: string;
      outcome: "holds" | "eased" | "resolved" | "unverifiable";
      before: number | null;
      after: number | null;
      note: string;
    }[];
    /** Counts, so a caller doesn't have to tally the list. */
    holds: number;
    eased: number;
    resolved: number;
    unverifiable: number;
  } | null;

  patterns: IBehaviorPattern[];
  feelingFoodRelationship: { observation: string; evidence: string; confidence: number }[];
  habitOpportunities: { area: string; priority: string; reason: string }[];
  recommendations: { recommendation: string; rationale: string; confidence: number }[];
  narrative: {
    behavioralSummary: string;
    whatWorked: string[];
    whatDidNotWork: string[];
  };
  /** The analyst's instructions to the meal planner, verbatim. Stored so the
   *  brief that shaped a week can be read back beside the plan it produced. */
  plannerBrief: string;
  planningDirectives: IPlanningDirectives;

  /** The plan this profile last informed, so "why is this week different?" can
   *  be answered from stored state rather than guessed at. */
  lastAppliedToPlanAt: Date | null;
}

const patternSchema = new Schema(
  {
    id: String,
    checkId: String,
    area: String,
    pattern: String,
    evidence: String,
    frequency: String,
    occurrences: { type: Number, default: 0 },
    possibleExplanation: String,
    impactOnGoal: String,
    suggestedIntervention: String,
    confidence: { type: Number, default: 0 },
  },
  { _id: false },
);

const nullableNumber = { type: Number, default: null };

export const BehaviorProfileSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    version: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
    confidence: {
      type: String,
      enum: ["insufficient", "low", "medium", "high"],
      default: "insufficient",
    },
    dataSnapshot: {
      periodDays: { type: Number, default: 0 },
      daysWithData: { type: Number, default: 0 },
      mealsLogged: { type: Number, default: 0 },
      moodCheckIns: { type: Number, default: 0 },
      plannedMeals: { type: Number, default: 0 },
    },
    behavior: {
      breakfastAdherence: nullableNumber,
      lunchAdherence: nullableNumber,
      dinnerAdherence: nullableNumber,
      snacksAdherence: nullableNumber,
      overallAdherence: nullableNumber,
      weekdayAdherence: nullableNumber,
      weekendAdherence: nullableNumber,
      prefersQuickMeals: nullableNumber,
      varietyTolerance: nullableNumber,
      waterConsistency: nullableNumber,
      exerciseAdherence: nullableNumber,
    },
    context: {
      busyDays: { type: [Number], default: [] },
      lowMotivationDays: { type: [Number], default: [] },
      lateEatingRate: nullableNumber,
      stressCorrelatedWithSnacking: nullableNumber,
      lowMoodAdherenceDrop: nullableNumber,
      typicalMealTimes: { type: Map, of: String, default: new Map() },
    },
    preferences: {
      favoriteMeals: { type: [String], default: [] },
      avoidMeals: { type: [String], default: [] },
      favoriteCategories: { type: [String], default: [] },
      effectiveMaxPrepMinutes: nullableNumber,
    },
    eatingType: {
      type: String,
      enum: ["mindful", "emotional", "habitual", "social", "mixed"],
      default: "mixed",
    },
    emotionalEatingRisk: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    triggerScores: { type: Map, of: Number, default: new Map() },
    riskWindows: {
      type: [{ dayOfWeek: Number, hourStart: Number, hourEnd: Number, risk: String }],
      default: [],
      _id: false,
    },
    bestMeals: {
      type: [{ mealName: String, avgMoodLift: Number }],
      default: [],
      _id: false,
    },
    patternTags: { type: [String], default: [] },
    suggestionTags: { type: [String], default: [] },
    nutritionTendency: {
      calorieAccuracy: {
        type: String,
        enum: ["under", "on-target", "over"],
        default: "on-target",
      },
      macroWeakness: { type: String, default: null },
    },
    checks: {
      type: [
        {
          id: String,
          fired: Boolean,
          value: { type: Number, default: null },
          threshold: Number,
          direction: String,
          basis: Number,
          evidence: String,
        },
      ],
      default: [],
      _id: false,
    },
    selfCheck: {
      type: {
        verifiedAt: Date,
        testedVersion: Number,
        results: {
          type: [
            {
              id: String,
              outcome: String,
              before: { type: Number, default: null },
              after: { type: Number, default: null },
              note: String,
            },
          ],
          default: [],
          _id: false,
        },
        holds: Number,
        eased: Number,
        resolved: Number,
        unverifiable: Number,
      },
      default: null,
      _id: false,
    },
    patterns: { type: [patternSchema], default: [] },
    feelingFoodRelationship: {
      type: [{ observation: String, evidence: String, confidence: Number }],
      default: [],
      _id: false,
    },
    habitOpportunities: {
      type: [{ area: String, priority: String, reason: String }],
      default: [],
      _id: false,
    },
    recommendations: {
      type: [{ recommendation: String, rationale: String, confidence: Number }],
      default: [],
      _id: false,
    },
    narrative: {
      behavioralSummary: { type: String, default: "" },
      whatWorked: { type: [String], default: [] },
      whatDidNotWork: { type: [String], default: [] },
    },
    plannerBrief: { type: String, default: "" },
    planningDirectives: {
      maxPrepMinutes: nullableNumber,
      simplifySlots: { type: [String], default: [] },
      flexibleSlots: { type: [String], default: [] },
      weekendNeedsOwnShape: { type: Boolean, default: false },
      increaseVariety: { type: Boolean, default: false },
      reduceLateEating: { type: Boolean, default: false },
      emphasiseMacro: { type: String, default: null },
      notes: { type: [String], default: [] },
    },
    lastAppliedToPlanAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

BehaviorProfileSchema.index({ userId: 1 }, { unique: true });
