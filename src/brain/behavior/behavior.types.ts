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

/**
 * How far a dish the user cooks may be tuned at each stage
 * (docs/the-repertoire.md §5, §7).
 *
 * The point of the whole system: nobody's food is replaced, it is made better
 * a step at a time. Early on that means portion only — the plate stays the
 * plate they know. Composition moves only once a change is holding.
 *
 * 0 = as they make it · 1 = portion · 2 = composition · 3 = upgraded
 */
export const STAGE_TUNE_CEILING: Record<BehaviorStage, 0 | 1 | 2 | 3> = {
  [BehaviorStage.AWARENESS]: 1,
  [BehaviorStage.PREPARATION]: 1,
  [BehaviorStage.REPLACEMENT]: 2,
  [BehaviorStage.REINFORCEMENT]: 3,
  [BehaviorStage.MAINTENANCE]: 3,
};

/** With no Brain reading yet, tune portions only — the safest real change. */
export const DEFAULT_TUNE_CEILING: 0 | 1 | 2 | 3 = 1;

export const tuneCeilingForStage = (stage: unknown): 0 | 1 | 2 | 3 =>
  isBehaviorStage(stage) ? STAGE_TUNE_CEILING[stage] : DEFAULT_TUNE_CEILING;
