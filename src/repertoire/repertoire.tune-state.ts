/**
 * How a user's answers move a dish between tune levels — docs/the-repertoire.md §5.
 *
 * - Accepting a level makes it current, and lifts the dish's ceiling to it:
 *   the user asked for it, so it is tolerated by definition.
 * - Rejecting a level drops the dish below it.
 * - Two rejections at the same level pin the dish below it for good (until
 *   the user accepts that level themselves).
 *
 * Pure, so the rules are testable without a database; the service persists
 * whatever these return.
 */

import { IRepertoireDish, IRepertoireTune } from "./repertoire-dish.schema";

export type Level = 0 | 1 | 2 | 3;

/** Rejections at one level before the dish is pinned below it. */
export const PIN_AFTER_REJECTIONS = 2;

export interface TuneState {
  tunes: IRepertoireTune[];
  currentTuneLevel: Level;
  tuneCeiling: Level;
}

export class TuneStateError extends Error {}

const stateOf = (dish: Pick<IRepertoireDish, keyof TuneState>): TuneState => ({
  tunes: dish.tunes.map((t) => ({ ...t })),
  currentTuneLevel: dish.currentTuneLevel,
  tuneCeiling: dish.tuneCeiling,
});

const tuneAt = (state: TuneState, level: number): IRepertoireTune => {
  const tune = state.tunes.find((t) => t.level === level);
  if (!tune) throw new TuneStateError(`No level ${level} tune for this dish`);
  return tune;
};

/** Level 0 is always acceptable: "as I make it now" needs no tune. */
export const acceptLevel = (
  dish: Pick<IRepertoireDish, keyof TuneState>,
  level: Level,
  now = new Date(),
): TuneState => {
  const state = stateOf(dish);
  if (level > 0) tuneAt(state, level).acceptedAt = now;
  state.currentTuneLevel = level;
  state.tuneCeiling = Math.max(state.tuneCeiling, level) as Level;
  return state;
};

export const rejectLevel = (
  dish: Pick<IRepertoireDish, keyof TuneState>,
  level: Exclude<Level, 0>,
  now = new Date(),
): TuneState => {
  const state = stateOf(dish);
  const tune = tuneAt(state, level);
  tune.rejectedAt = now;
  tune.rejections = (tune.rejections ?? 0) + 1;

  const below = (level - 1) as Level;
  state.currentTuneLevel = Math.min(state.currentTuneLevel, below) as Level;
  if (tune.rejections >= PIN_AFTER_REJECTIONS) {
    state.tuneCeiling = Math.min(state.tuneCeiling, below) as Level;
  }
  return state;
};

/**
 * After a re-tune the set of levels may shrink (a level failed validation this
 * time). The current level can't point at a tune that no longer exists.
 */
export const clampToAvailable = (current: Level, tunes: { level: number }[]): Level => {
  let top = 0;
  while (tunes.some((t) => t.level === top + 1)) top++;
  return Math.min(current, top) as Level;
};
