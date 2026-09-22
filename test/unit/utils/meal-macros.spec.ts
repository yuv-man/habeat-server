import { validateAndCorrectMealMacros } from "../../../src/utils/helpers";

describe("validateAndCorrectMealMacros", () => {
  it("makes calories the energy in the macros, and keeps the macros", () => {
    const meal = validateAndCorrectMealMacros({
      name: "Blueberry Almond Chia Pot",
      calories: 722,
      macros: { protein: 20, carbs: 70, fat: 15 },
    } as any);
    expect(meal.macros).toEqual({ protein: 20, carbs: 70, fat: 15 });
    expect(meal.calories).toBe(20 * 4 + 70 * 4 + 15 * 9);
  });

  it("no longer drags a meal toward per-slot targets", () => {
    // It used to take arguments for targets whose carb shares summed to 175%
    // of the day — every plan came out ~30% over. A right-sized breakfast must
    // come out right-sized.
    const breakfast = { name: "Oats", calories: 540, macros: { protein: 25, carbs: 75, fat: 15 } };
    const out = validateAndCorrectMealMacros(breakfast as any);
    expect(out.calories).toBe(535);
  });

  it("keeps a calorie figure when there are no macros to derive one from", () => {
    const out = validateAndCorrectMealMacros({
      name: "x",
      calories: 300,
      macros: { protein: 0, carbs: 0, fat: 0 },
    } as any);
    expect(out.calories).toBe(300);
  });
});
