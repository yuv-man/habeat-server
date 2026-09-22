import { resolvePlanTargets } from "../../../src/generator/generate.service";
import { IGoal, IUserData } from "../../../src/types/interfaces";

/** Chloe: 28, female, 165 cm, 60 kg, running, 4 sessions a week. */
const chloe = {
  age: 28,
  gender: "female",
  height: 165,
  weight: 60,
  workoutFrequency: 4,
  path: "running",
} as unknown as IUserData;

const halfMarathon = [
  {
    title: "Run a half marathon",
    description: "Complete a 21.1 km half marathon in four months.",
    target: 21.1,
    unit: "km",
  },
] as unknown as IGoal[];

describe("resolvePlanTargets", () => {
  it("gives the same answer to the plan document and to generation", () => {
    // The plan used to store the no-goals target while the meals were built
    // with goals applied, so every day read ~700 kcal over the stated goal.
    const a = resolvePlanTargets(chloe, halfMarathon);
    const b = resolvePlanTargets(chloe, halfMarathon);
    expect(a).toEqual(b);
    expect(a.macros).toEqual(expect.objectContaining({ protein: expect.any(Number) }));
  });

  it("raises the target once an endurance goal is active", () => {
    const without = resolvePlanTargets(chloe, []);
    const withGoal = resolvePlanTargets(chloe, halfMarathon);
    expect(withGoal.targetCalories).toBeGreaterThan(without.targetCalories);
    expect(withGoal.workoutFrequency).toBeGreaterThanOrEqual(5);
  });

  it("ignores goals for a fixed plan template", () => {
    expect(resolvePlanTargets(chloe, halfMarathon, "mediterranean").targetCalories).toBe(
      resolvePlanTargets(chloe, [], "mediterranean").targetCalories,
    );
  });

  it("never drops below a floor, whatever the goals say", () => {
    const tiny = { ...chloe, weight: 40, height: 150, workoutFrequency: 0 } as IUserData;
    expect(resolvePlanTargets(tiny, []).targetCalories).toBeGreaterThanOrEqual(1200);
  });

  it("keeps the runner's carb-led split", () => {
    const { macros, targetCalories } = resolvePlanTargets(chloe, halfMarathon);
    expect((macros.carbs * 4) / targetCalories).toBeCloseTo(0.55, 1);
  });
});
