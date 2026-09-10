import { BehaviorStage } from "./behavior/behavior.types";

/**
 * The Brain, said out loud.
 *
 * Everything else in this module is written for code or for a model. This file
 * is the vocabulary the *user* sees, kept apart so that changing how Habeat
 * talks never means editing detection logic — and so nobody accidentally ships
 * "Prioritize satisfying, easy-to-prepare dinners" into a UI.
 */

export interface BrainFocus {
  patternId: string;
  patternName: string;
  category: string;
  emoji: string;
  stage: BehaviorStage;
  /** The stage in the user's language, not the model's. */
  stageLabel: string;
  /** 1-based position on the ladder, for a progress indicator. */
  stageIndex: number;
  stageCount: number;
  whatWeAreDoing: string;
  goingWellIf: string;
  /** The observations the detection rests on, verbatim. */
  evidence: string[];
  status: string | null;
  improving: boolean;
  startedAt: Date | null;
  confidence: string;
}

/**
 * Stage names as a person would hear them.
 *
 * The internal vocabulary is clinical on purpose — "replacement" is precise
 * about what the engine is doing. It is also the kind of word that makes
 * someone feel like a case being managed, so it never reaches the screen.
 */
export const STAGE_LABELS: Record<string, string> = {
  [BehaviorStage.AWARENESS]: "Getting to know it",
  [BehaviorStage.PREPARATION]: "Making it easier",
  [BehaviorStage.REPLACEMENT]: "Trying something new",
  [BehaviorStage.REINFORCEMENT]: "Making it stick",
  [BehaviorStage.MAINTENANCE]: "Keeping it going",
};

export const PATTERN_EMOJI: Record<string, string> = {
  P01: "🍽️",
  P02: "🔄",
  P04: "🌙",
  P08: "🛵",
};
