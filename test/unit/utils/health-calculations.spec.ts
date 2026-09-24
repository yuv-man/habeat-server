import {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  calculateMacros,
} from "../../../src/utils/healthCalculations";
import { activityMultiplierForWorkouts } from "../../../src/enums/enumPaths";

/**
 * `workoutFrequency` is workouts per week (the KYC slider is 0-7), but it used
 * to be fed straight into a table keyed by activity LEVEL (1-5). Two things
 * fell out of that: 6 and 7 workouts a week hit a missing key and produced a
 * NaN calorie target that propagated into the meal-plan prompt, and someone who
 * trains zero times a week was budgeted as moderately active.
 */
describe("activityMultiplierForWorkouts", () => {
  it("covers the whole 0-7 range the KYC slider can produce", () => {
    for (let w = 0; w <= 7; w++) {
      expect(Number.isFinite(activityMultiplierForWorkouts(w))).toBe(true);
    }
  });

  it("treats a user who never trains as sedentary, not moderate", () => {
    expect(activityMultiplierForWorkouts(0)).toBe(1.2);
    expect(activityMultiplierForWorkouts(0)).toBeLessThan(
      activityMultiplierForWorkouts(4)
    );
  });

  it("never decreases as training goes up", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7].map(activityMultiplierForWorkouts);
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it("falls back to lightly active for missing or unusable input", () => {
    expect(activityMultiplierForWorkouts(undefined)).toBe(1.375);
    expect(activityMultiplierForWorkouts(NaN)).toBe(1.375);
    expect(activityMultiplierForWorkouts(null)).toBe(1.375);
  });

  it("clamps out-of-range values instead of returning undefined", () => {
    expect(activityMultiplierForWorkouts(99)).toBe(1.9);
    expect(activityMultiplierForWorkouts(-3)).toBe(1.2);
  });
});

describe("calculateTDEE", () => {
  const bmr = calculateBMR(80, 180, 30, "male");

  it("produces a real number for every workout frequency", () => {
    for (let w = 0; w <= 7; w++) {
      expect(Number.isFinite(calculateTDEE(bmr, w))).toBe(true);
    }
  });

  it("gives a daily trainer more calories than someone who never trains", () => {
    expect(calculateTDEE(bmr, 7)).toBeGreaterThan(calculateTDEE(bmr, 0));
  });
});

describe("calculateTargetCalories", () => {
  it("does not return NaN for an unrecognised path", () => {
    expect(calculateTargetCalories(2500, "no-such-path")).toBe(2500);
  });

  it("applies the deficit and surplus for the known paths", () => {
    expect(calculateTargetCalories(2500, "lose")).toBe(2000);
    expect(calculateTargetCalories(2500, "muscle")).toBe(2800);
  });
});

describe("calculateMacros", () => {
  it("treats the hyphenated path aliases as their canonical diet", () => {
    // PATH_ADJUSTMENTS already accepted these, so "gain-muscle" was getting a
    // muscle-gain calorie surplus with the default healthy macro split.
    expect(calculateMacros(3000, "gain-muscle")).toEqual(
      calculateMacros(3000, "muscle")
    );
    expect(calculateMacros(2000, "lose-weight")).toEqual(
      calculateMacros(2000, "lose")
    );
  });

  it("fuels a runner with carbohydrate, not the default split", () => {
    // A 28-year-old 60 kg runner training ~4x/week: TDEE ≈ 2158.
    const running = calculateMacros(2158, "running");
    expect(running.carbs / 60).toBeGreaterThanOrEqual(4.8);
    expect(running.protein / 60).toBeGreaterThanOrEqual(1.6);
    expect(running.protein / 60).toBeLessThanOrEqual(2.0);
    expect(running.carbs).toBeGreaterThan(calculateMacros(2158, "healthy").carbs);
  });

  it("doses protein against weight at BMI 25, not total weight", () => {
    // 28y, 101 kg, 178 cm, lose-weight, 4x/week: 2,812 kcal gave 246 g
    // protein — 2.4 g per kg of a body that is largely fat.
    const macros = calculateMacros(2812, "lose-weight", { weight: 101, height: 178 });
    expect(macros.protein).toBe(Math.round(2.2 * 25 * 1.78 * 1.78));
    // The calories it frees go to carbs; the day's total is unchanged.
    const kcal = macros.protein * 4 + macros.carbs * 4 + macros.fat * 9;
    expect(Math.abs(kcal - 2812)).toBeLessThanOrEqual(10);
    expect(macros.carbs).toBeGreaterThan(calculateMacros(2812, "lose-weight").carbs);
  });

  it("leaves protein alone when it is already within range", () => {
    expect(calculateMacros(2000, "healthy", { weight: 75, height: 180 })).toEqual(
      calculateMacros(2000, "healthy"),
    );
  });

  it("moves capped protein into fat on keto", () => {
    const keto = calculateMacros(3200, "keto", { weight: 110, height: 175 });
    expect(keto.carbs).toBe(calculateMacros(3200, "keto").carbs);
    expect(keto.fat).toBeGreaterThan(calculateMacros(3200, "keto").fat);
  });

  it("keeps keto carbs minimal", () => {
    const keto = calculateMacros(2000, "keto");
    expect(keto.carbs).toBeLessThan(calculateMacros(2000, "healthy").carbs / 5);
  });
});
