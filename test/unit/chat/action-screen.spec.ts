import {
  dislikedProposalNote,
  UNSAFE_PROPOSAL_MESSAGE,
  screenProposedAction,
} from "../../../src/chat/action-screen";

const swap = (proposedMeal: any) =>
  ({ type: "meal_swap", status: "pending", payload: { proposedMeal } }) as any;

describe("screenProposedAction", () => {
  const sandwich = {
    name: "Fried Egg and Tomato Sandwich",
    ingredients: [["egg", "2 unit"], ["tomato", "1 unit"], ["bread", "2 slice"]],
  };

  it("passes a proposal that fits", () => {
    const action = swap(sandwich);
    expect(screenProposedAction("Try this", action, { dislikes: ["Mushrooms"] })).toEqual({
      message: "Try this",
      action,
    });
  });

  it("drops the proposal and the reply when it breaks an allergy", () => {
    const result = screenProposedAction("Try this egg sandwich", swap(sandwich), { allergies: ["Eggs"] });
    expect(result.action).toBeUndefined();
    expect(result.message).toBe(UNSAFE_PROPOSAL_MESSAGE);
    expect(result.blocked?.length).toBeGreaterThan(0);
  });

  it("keeps a swap with a dislike, and says what's in it", () => {
    const action = swap(sandwich);
    const result = screenProposedAction("Try this", action, { dislikes: ["Tomatoes"] });
    expect(result.action).toBe(action);
    expect(result.message).toBe(`Try this\n\n${dislikedProposalNote(["Tomatoes"])}`);
    expect(result.blocked).toBeUndefined();
  });

  it("leaves workout actions alone", () => {
    const action = { type: "workout_change", status: "pending", payload: {} } as any;
    expect(screenProposedAction("Go for a walk", action, { allergies: ["Eggs"] }).action).toBe(action);
  });
});
