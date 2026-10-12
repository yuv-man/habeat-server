/**
 * Check a meal the chat assistant proposes before the user can apply it.
 *
 * The assistant's prompt lists allergies, restrictions and dislikes, but a
 * prompt is not a guarantee, and nothing checked the proposal afterwards. The
 * planner's output has always been checked; the assistant now gets the same
 * rules from the same matchers, so the two can't disagree.
 *
 * Allergies and restrictions remove the proposal. A dislike is a preference:
 * the swap stays, with a note naming what's in it, so the user decides.
 */
import { findMealViolations, resolveDietaryConstraints } from "../utils/dietary-constraints";
import { findMealDislikes } from "../utils/ingredient-match";
import type { IProposedAction } from "../types/interfaces";

export const UNSAFE_PROPOSAL_MESSAGE =
  "I couldn't put together a suggestion that fits your dietary needs this time. " +
  "Try asking again, maybe with what you have on hand.";

export const dislikedProposalNote = (ingredients: string[]): string =>
  `Heads up: this has ${ingredients.join(" and ")}, which you told us you don't love.`;

export interface ScreenedResponse {
  message: string;
  action?: IProposedAction;
  /** Why the action was removed, for logs. */
  blocked?: string[];
  /** Dislikes the kept action contains. */
  disliked?: string[];
}

export const screenProposedAction = (
  message: string,
  action: IProposedAction | undefined,
  user: { dietaryRestrictions?: string[]; allergies?: string[]; dislikes?: string[] },
): ScreenedResponse => {
  if (!action || (action.type !== "meal_swap" && action.type !== "add_snack")) return { message, action };
  const meal = (action.payload as any)?.proposedMeal;
  if (!meal) return { message, action };

  const hard = findMealViolations(meal, resolveDietaryConstraints(user));
  if (hard.length) {
    // The reply text recommends the same meal, so it has to go too.
    return { message: UNSAFE_PROPOSAL_MESSAGE, blocked: hard };
  }
  const disliked = findMealDislikes(meal, user.dislikes ?? []);
  if (disliked.length) {
    return { message: `${message}\n\n${dislikedProposalNote(disliked)}`, action, disliked };
  }
  return { message, action };
};
