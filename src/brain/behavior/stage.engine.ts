import { Injectable } from "@nestjs/common";
import { BehaviorStage, STAGE_LADDER } from "./behavior.types";

export interface StageDecisionInput {
  currentStage: BehaviorStage;
  /** 0–1: how often the current intervention's success metric was met. */
  successRate: number;
  /** 0–1: how hard the current intervention is. */
  difficulty: number;
  /** 0–1, optional. Absent means neutral, not negative. */
  userFeedback?: number;
}

/**
 * Decides whether a user moves up the behaviour-change ladder, down it, or
 * stays put.
 *
 * The important case is the middle one. A brain that only ever advances turns
 * every plateau into escalating demands, and a brain that advances on a timer
 * hands someone a replacement task before awareness has landed. Staying at a
 * stage and improving the intervention is a real answer, and it is the default
 * here rather than the exception.
 */
@Injectable()
export class StageEngine {
  decide(input: StageDecisionInput): BehaviorStage {
    const { currentStage, successRate, difficulty, userFeedback = 0.5 } = input;

    // Working, and the user says so.
    if (successRate >= 0.75 && userFeedback >= 0.6) {
      return this.nextStage(currentStage);
    }

    // Too hard. Stepping back is a correction, not a punishment — the
    // intervention was mis-set, and leaving the user to keep failing it is how
    // they conclude the problem is them.
    if (successRate < 0.35 && difficulty > 0.5) {
      return this.previousStage(currentStage);
    }

    return currentStage;
  }

  nextStage(stage: BehaviorStage): BehaviorStage {
    const index = STAGE_LADDER.indexOf(stage);
    if (index === -1 || index === STAGE_LADDER.length - 1) {
      return BehaviorStage.MAINTENANCE;
    }
    return STAGE_LADDER[index + 1];
  }

  previousStage(stage: BehaviorStage): BehaviorStage {
    const index = STAGE_LADDER.indexOf(stage);
    if (index <= 0) return BehaviorStage.AWARENESS;
    return STAGE_LADDER[index - 1];
  }
}
