import { BehaviorStage } from "../behavior/behavior.types";
import { PatternEvidence } from "../patterns/pattern.types";

/**
 * BrainState — the one object the rest of Habeat is allowed to act on.
 *
 * Before this existed, two systems independently decided what a user needed:
 * the deterministic pattern work and the LLM behaviour analyst. Nothing
 * arbitrated when they disagreed, so the meal generator could receive
 * "prioritise quick dinners" and "build cooking confidence" in the same brief.
 *
 * BrainState is the resolution. It is assembled once per analysis run, carries
 * its own provenance, and is the only thing the generator reads. Anything that
 * wants to influence a meal plan has to get into this object first.
 */

export interface BrainPatternView {
  patternId: string;
  name: string;
  category: string;
  score: number;
  confidence: number;
  status: string;
  evidence: PatternEvidence[];
}

export interface BrainDecision {
  /** The pattern the Brain has chosen to work on, if any. */
  patternId: string | null;
  patternName: string | null;
  stage: BehaviorStage | null;
  interventionId: string | null;
  interventionName: string | null;
  /** The sentence handed to the meal generator. */
  mealStrategy: string | null;
  successMetric: string | null;
  difficulty: number | null;
  /** The same intervention said to the user. Rendered by the client; never
   *  sent to the model, which needs the planner phrasing instead. */
  whatWeAreDoing: string | null;
  goingWellIf: string | null;
  /** Position on the five-rung ladder, so a UI can show progress without
   *  knowing the stage vocabulary. 1-based; null when nothing is active. */
  stageIndex: number | null;
  stageCount: number;
  /** Why this pattern and not another — carried so the choice is auditable. */
  rationale: string;
}

export type BrainConfidence = "insufficient" | "low" | "medium" | "high";

export interface BrainState {
  userId: string;
  generatedAt: Date;
  confidence: BrainConfidence;

  /** What the state stands on, so a thin week can't read as a firm finding. */
  dataSnapshot: {
    windowDays: number;
    observedDays: number;
    events: number;
    mealsLogged: number;
  };

  /** Everything currently detected, strongest first. */
  patterns: BrainPatternView[];

  /** The single behaviour being worked on now. */
  decision: BrainDecision;

  /**
   * The behaviour analyst's contribution, already reconciled against the
   * decision above. Null when the profile is too thin to be worth citing.
   */
  analysis: {
    plannerBrief: string | null;
    directives: {
      maxPrepMinutes: number | null;
      simplifySlots: string[];
      flexibleSlots: string[];
      weekendNeedsOwnShape: boolean;
      increaseVariety: boolean;
      reduceLateEating: boolean;
      emphasiseMacro: string | null;
      notes: string[];
    } | null;
  };
}
