import { Schema } from "mongoose";
import { BehaviorStage } from "../behavior/behavior.types";

/**
 * The persisted Brain state: what was decided, and how that decision has been
 * going.
 *
 * Kept as its own document rather than folded into BehaviorProfile because the
 * two answer different questions. The profile describes how someone eats; this
 * records what Habeat is *doing about it* and since when — which is the part
 * that has to survive across runs for staging to mean anything.
 */

export const BrainStateDoc = { name: "BrainStateDoc" };

export interface IActiveBehavior {
  patternId: string;
  interventionId: string;
  stage: BehaviorStage;
  startedAt: Date;
  /** Runs completed at this stage, so a user cannot sit at one indefinitely
   *  without the Brain noticing the intervention is not landing. */
  runsAtStage: number;
  /** 0–1, from the last measured evaluation of the success metric. */
  lastSuccessRate: number | null;
}

export interface IBrainStateDoc {
  userId: Schema.Types.ObjectId;
  version: number;
  generatedAt: Date;
  confidence: string;
  activeBehavior: IActiveBehavior | null;
  /** Pattern IDs by how they last resolved, for quick reads. */
  improvingPatterns: string[];
  stablePatterns: string[];
  resolvedPatterns: string[];
  /** The rendered brief last handed to the meal generator. Stored so "why is
   *  this week shaped like this?" is answerable from state, not guesswork. */
  plannerContext: string | null;
  lastAppliedToPlanAt: Date | null;
  lastAnalysisAt: Date | null;
}

const activeBehaviorSchema = new Schema<IActiveBehavior>(
  {
    patternId: String,
    interventionId: String,
    stage: {
      type: String,
      enum: Object.values(BehaviorStage),
    },
    startedAt: Date,
    runsAtStage: { type: Number, default: 0 },
    lastSuccessRate: { type: Number, default: null },
  },
  { _id: false },
);

const brainStateSchema = new Schema<IBrainStateDoc>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      // `unique` already builds the index; adding `index: true` on top of it
      // makes Mongoose warn about a duplicate definition at boot.
      unique: true,
    },
    version: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
    confidence: { type: String, default: "insufficient" },
    activeBehavior: { type: activeBehaviorSchema, default: null },
    improvingPatterns: { type: [String], default: [] },
    stablePatterns: { type: [String], default: [] },
    resolvedPatterns: { type: [String], default: [] },
    plannerContext: { type: String, default: null },
    lastAppliedToPlanAt: { type: Date, default: null },
    lastAnalysisAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "brain_states" },
);

export const BrainStateSchema = brainStateSchema;
