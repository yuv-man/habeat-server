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
  P09: "🥪",
};

/**
 * One pattern, as it has moved since the Brain first saw it.
 *
 * Deliberately qualitative. Scores are the Brain's internal strength reading,
 * and "43% → 21%" invites someone to optimise a number rather than notice
 * their week. `trendLabel` says what changed; `evidence` is the checkable
 * sentence behind it.
 */
export interface PatternProgress {
  patternId: string;
  name: string;
  emoji: string;
  trend: "improving" | "steady" | "resolved";
  trendLabel: string;
  /** Whether this is the one the Brain is actively working on. */
  isFocus: boolean;
  evidence: string | null;
  tips: string[];
  since: Date | null;
}

export const TREND_LABELS: Record<PatternProgress["trend"], string> = {
  improving: "Happening less than when we started",
  steady: "About the same as when we started",
  resolved: "Hasn't shown up lately",
};

/**
 * Small, concrete things to try, per pattern. Written to the tone rules the
 * rest of this file keeps: no "you failed to", no calorie maths, nothing that
 * reads as a restriction. Each is something a busy person could do tomorrow.
 */
export const PATTERN_TIPS: Record<string, string[]> = {
  P01: [
    "Pick one meal to protect every day — even a small one counts.",
    "Keep a 'nothing in the fridge' meal ready: eggs on toast, or yogurt and granola.",
    "Set a gentle reminder at the time your meals usually slip.",
  ],
  P02: [
    "Missed a meal? The next one is a normal one — no making up for it.",
    "Keep one 5-minute restart meal in the house for the days that go sideways.",
    "A small snack counts as getting back on track.",
  ],
  P04: [
    "Plan the evening treat instead of fighting it — a couple of squares of dark chocolate with tea, on a plate rather than from the pack.",
    "Make dinner a little more filling, with some protein and something warm.",
    "Give the kitchen a closing time: tea, brushing your teeth, or wiping the counter.",
  ],
  P08: [
    "Keep two 10-minute meals you can make from the freezer and cupboard.",
    "Order when you've decided to, not when you're starving — have a snack first.",
    "Cook double on a quieter night and freeze half.",
  ],
  P09: [
    "Block 15 minutes for lunch in your calendar — treat it like a meeting.",
    "Make one extra portion at dinner; it's tomorrow's lunch.",
    "Keep a no-prep lunch at work: a wrap, hummus, nuts and fruit.",
    "If lunch really can't happen, have a proper snack at 3–4pm so the evening starts calmer.",
  ],
};
