import { Injectable } from "@nestjs/common";
import {
  BehaviorStage,
  STAGE_LADDER,
  isBehaviorStage,
} from "../behavior/behavior.types";
import { StageEngine } from "../behavior/stage.engine";
import { interventionFor } from "../behavior/intervention.definitions";
import { patternById } from "../patterns/pattern.definitions";
import { PatternStatus } from "../schemas/behavior-pattern.schema";
import {
  BrainConfidence,
  BrainDecision,
  BrainPatternView,
  BrainState,
} from "./brain-state.types";

export interface DecisionInput {
  userId: string;
  patterns: BrainPatternView[];
  windowDays: number;
  observedDays: number;
  events: number;
  mealsLogged: number;
  /** Where the user currently sits, from the last run. */
  currentStage?: string | null;
  currentPatternId?: string | null;
  /** 0–1: how often the current intervention's success metric was met. */
  successRate?: number | null;
  userFeedback?: number | null;
  /** The behaviour analyst's output, to be reconciled rather than appended. */
  analysis?: BrainState["analysis"];
}

/**
 * Chooses the one behaviour Habeat works on next, and hands the meal generator
 * a single instruction.
 *
 * Two rules do most of the work here:
 *
 *  1. **One pattern at a time.** A user given three things to fix changes
 *     none of them. The Brain ranks by score × confidence and commits to the
 *     top one; the rest stay visible as findings but do not shape the plan.
 *  2. **Continuity beats novelty.** Once a pattern is being worked on, it
 *     keeps priority even if another edges ahead on score, until it resolves
 *     or the user stops responding. Switching targets weekly is how a plan
 *     stops feeling like it is about the person using it.
 */
@Injectable()
export class DecisionEngine {
  constructor(private readonly stageEngine: StageEngine) {}

  decide(input: DecisionInput): BrainState {
    const {
      userId,
      patterns,
      windowDays,
      observedDays,
      events,
      mealsLogged,
      analysis,
    } = input;

    const confidence = this.gradeConfidence(observedDays, patterns);
    const target = this.chooseTarget(patterns, input.currentPatternId);

    const decision = target
      ? this.buildDecision(target, input)
      : this.noDecision(confidence, patterns.length);

    return {
      userId,
      generatedAt: new Date(),
      confidence,
      dataSnapshot: { windowDays, observedDays, events, mealsLogged },
      patterns,
      decision,
      analysis: this.reconcile(analysis, decision),
    };
  }

  /**
   * Rank by score weighted by confidence, but let the pattern already being
   * worked on keep its place unless it has resolved.
   */
  private chooseTarget(
    patterns: BrainPatternView[],
    currentPatternId?: string | null,
  ): BrainPatternView | null {
    const actionable = patterns.filter(
      (p) => p.status !== PatternStatus.RESOLVED,
    );
    if (actionable.length === 0) return null;

    if (currentPatternId) {
      const continuing = actionable.find(
        (p) => p.patternId === currentPatternId,
      );
      if (continuing) return continuing;
    }

    return [...actionable].sort(
      (a, b) => b.score * b.confidence - a.score * a.confidence,
    )[0];
  }

  private buildDecision(
    target: BrainPatternView,
    input: DecisionInput,
  ): BrainDecision {
    const continuing = input.currentPatternId === target.patternId;

    // A new target always starts at awareness. Dropping someone straight into
    // "replace the behaviour" for a pattern they have not been told about yet
    // is the single most reliable way to make an intervention fail.
    const startingStage =
      continuing && isBehaviorStage(input.currentStage)
        ? input.currentStage
        : BehaviorStage.AWARENESS;

    const currentIntervention = interventionFor(
      target.patternId,
      startingStage,
    );

    // Only re-stage when there is a result to judge. Without a success rate
    // the honest move is to hold position, not to guess.
    const stage =
      continuing && typeof input.successRate === "number"
        ? this.stageEngine.decide({
            currentStage: startingStage,
            successRate: input.successRate,
            difficulty: currentIntervention?.difficulty ?? 0.3,
            userFeedback: input.userFeedback ?? undefined,
          })
        : startingStage;

    const intervention = interventionFor(target.patternId, stage);
    const definition = patternById(target.patternId);

    return {
      patternId: target.patternId,
      patternName: definition?.name ?? target.name,
      stage,
      interventionId: intervention?.id ?? null,
      interventionName: intervention?.name ?? null,
      mealStrategy: intervention?.mealStrategy ?? null,
      successMetric: intervention?.successMetric ?? null,
      difficulty: intervention?.difficulty ?? null,
      whatWeAreDoing: intervention?.userFacing.whatWeAreDoing ?? null,
      goingWellIf: intervention?.userFacing.goingWellIf ?? null,
      stageIndex: STAGE_LADDER.indexOf(stage) + 1,
      stageCount: STAGE_LADDER.length,
      rationale: this.explain(target, stage, continuing, input),
    };
  }

  private explain(
    target: BrainPatternView,
    stage: BehaviorStage,
    continuing: boolean,
    input: DecisionInput,
  ): string {
    const strength = `score ${target.score.toFixed(2)} at confidence ${target.confidence.toFixed(2)}`;

    if (!continuing) {
      return `Selected ${target.patternId} (${target.name}) as the strongest actionable pattern — ${strength}. Starting at awareness.`;
    }

    if (typeof input.successRate !== "number") {
      return `Continuing ${target.patternId} (${target.name}) at ${stage} — ${strength}. No completed success metric yet, so the stage is held.`;
    }

    const moved = stage !== input.currentStage;
    if (!moved) {
      return `Continuing ${target.patternId} at ${stage} — ${strength}, success rate ${(input.successRate * 100).toFixed(0)}%. Holding the stage and improving the intervention.`;
    }

    return `Continuing ${target.patternId}, moved to ${stage} — ${strength}, success rate ${(input.successRate * 100).toFixed(0)}%.`;
  }

  private noDecision(
    confidence: BrainConfidence,
    patternCount: number,
  ): BrainDecision {
    return {
      patternId: null,
      patternName: null,
      stage: null,
      interventionId: null,
      interventionName: null,
      mealStrategy: null,
      successMetric: null,
      difficulty: null,
      whatWeAreDoing: null,
      goingWellIf: null,
      stageIndex: null,
      stageCount: STAGE_LADDER.length,
      rationale:
        patternCount === 0
          ? `No pattern met its detection threshold (confidence: ${confidence}). The Brain has nothing to claim yet.`
          : "Every detected pattern is resolved. Nothing to work on.",
    };
  }

  /**
   * Grades how much the state can be trusted.
   *
   * Deliberately driven by observed days rather than event count: a single
   * heavy logging day produces plenty of events and tells you almost nothing
   * about how someone lives.
   */
  private gradeConfidence(
    observedDays: number,
    patterns: BrainPatternView[],
  ): BrainConfidence {
    if (observedDays < 5) return "insufficient";
    if (patterns.length === 0) return "low";

    const best = Math.max(...patterns.map((p) => p.confidence));
    if (observedDays >= 21 && best >= 0.8) return "high";
    if (observedDays >= 10 && best >= 0.5) return "medium";
    return "low";
  }

  /**
   * Reconciles the analyst's directives with the committed decision.
   *
   * This is the arbitration that did not exist before. The analyst may have
   * concluded "reduce late eating" while the Brain is still at the awareness
   * stage for that very pattern — and awareness explicitly means *do not
   * restrict yet*. Where they conflict, the staged decision wins, because it
   * is the one tracking whether the user can actually act on it.
   */
  private reconcile(
    analysis: BrainState["analysis"] | undefined,
    decision: BrainDecision,
  ): BrainState["analysis"] {
    if (!analysis) return { plannerBrief: null, directives: null };
    if (!analysis.directives) return analysis;

    const directives = { ...analysis.directives };

    const earlyStage =
      decision.stage === BehaviorStage.AWARENESS ||
      decision.stage === BehaviorStage.PREPARATION;

    if (
      directives.reduceLateEating &&
      decision.patternId === "P04" &&
      earlyStage
    ) {
      directives.reduceLateEating = false;
      directives.notes = [
        ...directives.notes,
        "Late eating is the active pattern but the user is at an early stage: the plan makes dinner more satisfying rather than restricting evening food.",
      ];
    }

    return { plannerBrief: analysis.plannerBrief, directives };
  }
}
