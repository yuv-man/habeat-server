import { Schema } from "mongoose";

/**
 * A pattern as it stands for one user, tracked over time.
 *
 * The detector produces a reading; this document is the *history* of that
 * reading. That distinction is what lets the Brain say "this is easing" rather
 * than only "this is present", and it is why status transitions live here
 * rather than in the engine.
 */

export const BehaviorPattern = { name: "BehaviorPattern" };

export enum PatternStatus {
  /** Seen once, not yet confirmed by a second independent run. */
  DISCOVERED = "discovered",
  /** Seen across runs — real enough to act on. */
  CONFIRMED = "confirmed",
  /** Currently the pattern the Brain is working on. */
  ACTIVE = "active",
  /** Still present, but measurably weaker than when it was confirmed. */
  IMPROVING = "improving",
  /** Present and unchanging. */
  STABLE = "stable",
  /** No longer detected. */
  RESOLVED = "resolved",
}

export interface IPatternEvidence {
  description: string;
  value?: number;
}

export interface IBehaviorPatternDoc {
  userId: Schema.Types.ObjectId;
  patternId: string;
  name: string;
  status: PatternStatus;
  score: number;
  confidence: number;
  /** The score when the pattern was first confirmed, so "improving" is
   *  measured against where the user started rather than against last week. */
  baselineScore: number | null;
  evidence: IPatternEvidence[];
  /** How many analysis runs have seen this pattern. One sighting is a
   *  coincidence; the status ladder will not leave DISCOVERED without two. */
  detectionCount: number;
  firstDetectedAt?: Date;
  lastDetectedAt?: Date;
  resolvedAt?: Date;
}

const evidenceSchema = new Schema<IPatternEvidence>(
  { description: { type: String, required: true }, value: Number },
  { _id: false },
);

const behaviorPatternSchema = new Schema<IBehaviorPatternDoc>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      // No single-field index here: every query is scoped by user *and*
      // something else, and the compound indexes below already lead on userId.
      required: true,
    },
    patternId: { type: String, required: true, index: true },
    name: String,
    status: {
      type: String,
      enum: Object.values(PatternStatus),
      default: PatternStatus.DISCOVERED,
    },
    score: { type: Number, min: 0, max: 1 },
    confidence: { type: Number, min: 0, max: 1 },
    baselineScore: { type: Number, default: null },
    evidence: { type: [evidenceSchema], default: [] },
    detectionCount: { type: Number, default: 0 },
    firstDetectedAt: Date,
    lastDetectedAt: Date,
    resolvedAt: Date,
  },
  { timestamps: true, collection: "behavior_patterns" },
);

behaviorPatternSchema.index({ userId: 1, patternId: 1 }, { unique: true });

export const BehaviorPatternSchema = behaviorPatternSchema;
