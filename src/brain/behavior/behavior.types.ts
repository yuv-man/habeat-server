/**
 * The behaviour-change ladder.
 *
 * A stage is not a week number. Someone who is handed "replace your late
 * snack" in week three when awareness never landed will fail at it, and the
 * failure reads to them as their own rather than the plan's. Stages advance on
 * evidence and, crucially, can move back down — see stage.engine.ts.
 */
export enum BehaviorStage {
  AWARENESS = "awareness",
  PREPARATION = "preparation",
  REPLACEMENT = "replacement",
  REINFORCEMENT = "reinforcement",
  MAINTENANCE = "maintenance",
}

export const STAGE_LADDER: BehaviorStage[] = [
  BehaviorStage.AWARENESS,
  BehaviorStage.PREPARATION,
  BehaviorStage.REPLACEMENT,
  BehaviorStage.REINFORCEMENT,
  BehaviorStage.MAINTENANCE,
];

export const isBehaviorStage = (value: unknown): value is BehaviorStage =>
  typeof value === "string" && STAGE_LADDER.includes(value as BehaviorStage);
