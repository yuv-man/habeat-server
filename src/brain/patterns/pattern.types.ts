/**
 * What a pattern detector returns.
 *
 * Score and confidence are deliberately separate axes. Score says how strongly
 * the behaviour shows up; confidence says how much data stands behind that
 * reading. A pattern seen twice in three days and one seen twice in thirty are
 * not the same claim, and collapsing them into a single number is how a brain
 * starts telling users things that aren't true.
 */

export type PatternCategory =
  | "timing"
  | "food"
  | "emotional"
  | "planning"
  | "environment";

export interface PatternEvidence {
  description: string;
  value?: number;
}

export interface PatternScore {
  patternId: string;
  /** 0 = not present, 1 = very strong. */
  score: number;
  /** 0–1, from how much data the reading stands on. */
  confidence: number;
  evidence: PatternEvidence[];
}

/**
 * A detector's view of the window it is reasoning about.
 *
 * Detectors receive this rather than raw events plus a day count, because
 * almost every one of them needs the same two denominators — how many days
 * actually had data, and how many events carry a real timestamp — and
 * recomputing those per detector is how they drift apart.
 */
export interface PatternWindow {
  /** How many days the window spans. */
  days: number;
  /** Days that carry any logged activity at all. */
  observedDays: number;
}
