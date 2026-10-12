import {
  applyMealLearningEvents,
  swapAvoidNames,
  UNEXPLAINED_SWAPS_TO_AVOID,
} from "../../../src/utils/meal-learning";

const fresh = () => applyMealLearningEvents(undefined, []);

describe("swapAvoidNames", () => {
  it("does not avoid a dish after a single unexplained swap", () => {
    // It used to: any swap at all kept the dish out of every future plan.
    const p = applyMealLearningEvents(fresh(), [{ type: "swap", name: "Beef Tacos" }]);
    expect(swapAvoidNames(p)).toEqual([]);
  });

  it(`avoids a dish after ${UNEXPLAINED_SWAPS_TO_AVOID} unexplained swaps`, () => {
    const p = applyMealLearningEvents(fresh(), [
      { type: "swap", name: "Beef Tacos" },
      { type: "swap", name: "Beef Tacos" },
    ]);
    expect(swapAvoidNames(p)).toEqual(["Beef Tacos"]);
  });

  it("avoids a dish the user said they don't like, after one swap", () => {
    const p = applyMealLearningEvents(fresh(), [{ type: "swap", name: "Liver", reason: "dont_like" }]);
    expect(swapAvoidNames(p)).toEqual(["Liver"]);
  });

  it("never avoids a dish for circumstantial reasons, however often", () => {
    const p = applyMealLearningEvents(fresh(), [
      { type: "swap", name: "Roast Chicken", reason: "no_time" },
      { type: "swap", name: "Roast Chicken", reason: "missing_ingredients" },
      { type: "swap", name: "Roast Chicken", reason: "not_in_mood" },
    ]);
    expect(swapAvoidNames(p)).toEqual([]);
  });

  it("reads records from before swap reasons as all unexplained", () => {
    expect(swapAvoidNames({ swappedMeals: [{ name: "Old", count: 1 }] })).toEqual([]);
    expect(swapAvoidNames({ swappedMeals: [{ name: "Old", count: 3 }] })).toEqual(["Old"]);
  });

  it("carries an old record's history forward when it is next written", () => {
    const legacy = { swappedMeals: [{ name: "Old", count: 1 }], completedMeals: [] };
    const p = applyMealLearningEvents(legacy, [{ type: "swap", name: "Old", reason: "no_time" }]);
    // One old unexplained swap plus one with a reason: still under the bar.
    expect(p.swappedMeals[0]).toMatchObject({ count: 2, unexplained: 1, dislikes: 0 });
    expect(swapAvoidNames(p)).toEqual([]);
  });
});

describe("applyMealLearningEvents", () => {
  it("records the reason on the dated swap", () => {
    const p = applyMealLearningEvents(fresh(), [{ type: "swap", name: "Tacos", reason: "no_time" }]);
    expect(p.recentSwaps[0]).toMatchObject({ name: "Tacos", reason: "no_time" });
  });

  it("records the chosen replacement as a selection", () => {
    const p = applyMealLearningEvents(fresh(), [
      { type: "swap", name: "Tacos" },
      { type: "select", name: "Chicken and Rice" },
    ]);
    expect(p.selectedMeals[0]).toMatchObject({ name: "Chicken and Rice", count: 1 });
  });

  it("undo takes back the swap and the selection", () => {
    let p = applyMealLearningEvents(fresh(), [
      { type: "swap", name: "Tacos", reason: "dont_like" },
      { type: "select", name: "Chicken and Rice" },
    ]);
    p = applyMealLearningEvents(p, [
      { type: "unswap", name: "Tacos" },
      { type: "unselect", name: "Chicken and Rice" },
    ]);
    expect(p.swappedMeals).toEqual([]);
    expect(p.selectedMeals).toEqual([]);
    expect(p.recentSwaps).toEqual([]);
    expect(swapAvoidNames(p)).toEqual([]);
  });

  it("undo of one swap leaves earlier swaps of the same dish", () => {
    let p = applyMealLearningEvents(fresh(), [
      { type: "swap", name: "Tacos" },
      { type: "swap", name: "Tacos", reason: "no_time" },
    ]);
    p = applyMealLearningEvents(p, [{ type: "unswap", name: "Tacos" }]);
    expect(p.swappedMeals[0]).toMatchObject({ count: 1, unexplained: 1 });
    expect(p.recentSwaps).toHaveLength(1);
  });

  it("counts completions", () => {
    const p = applyMealLearningEvents(fresh(), [
      { type: "complete", name: "Chicken and Rice" },
      { type: "complete", name: "Chicken and Rice" },
    ]);
    expect(p.completedMeals[0]).toMatchObject({ name: "Chicken and Rice", count: 2 });
  });
});

describe("forgetLearnedPreference", () => {
  const { forgetLearnedPreference } = require("../../../src/utils/meal-learning");

  it("lets a turned-down dish back into plans", () => {
    const p = applyMealLearningEvents(fresh(), [{ type: "swap", name: "Liver", reason: "dont_like" }]);
    const corrected = forgetLearnedPreference(p, "avoided", "liver");
    expect(swapAvoidNames(corrected)).toEqual([]);
    // What happened is still on record for the behaviour summary.
    expect(corrected.recentSwaps).toHaveLength(1);
  });

  it("drops the evidence for an enjoyed dish the user doesn't care for", () => {
    const p = applyMealLearningEvents(fresh(), [
      { type: "complete", name: "Oatmeal" },
      { type: "complete", name: "Oatmeal" },
      { type: "select", name: "Oatmeal" },
    ]);
    const corrected = forgetLearnedPreference(p, "enjoyed", "Oatmeal");
    expect(corrected.completedMeals).toEqual([]);
    expect(corrected.selectedMeals).toEqual([]);
  });
});

describe("on a real user document", () => {
  // The cases above use plain arrays. A Mongoose array stores a cast copy of
  // what is pushed, and a first "Don't like it" used to be written to the
  // original — so it never reached the database.
  const mongoose = require("mongoose");
  const { UserSchema } = require("../../../src/user/user.model");
  const UserDoc = mongoose.models.MealLearningSpecUser ?? mongoose.model("MealLearningSpecUser", UserSchema);

  it("keeps a first 'Don't like it' and avoids the dish", () => {
    const user = new UserDoc({ email: "x@test.dev", mealLearningProfile: {} });
    user.mealLearningProfile = applyMealLearningEvents(user.mealLearningProfile, [
      { type: "swap", name: "Chicken and rice", reason: "dont_like" },
    ]);
    const saved = user.toObject().mealLearningProfile;
    expect(saved.swappedMeals[0]).toMatchObject({ name: "Chicken and rice", count: 1, dislikes: 1, unexplained: 0 });
    expect(swapAvoidNames(saved)).toEqual(["Chicken and rice"]);
  });
});
