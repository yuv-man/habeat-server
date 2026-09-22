import {
  rebalanceDayCalories,
  roundAmount,
  scaleIngredient,
} from "../../../src/generator/calorie-balance";

const ALL = ["breakfast", "lunch", "dinner", "snack"] as const;

/** Chloe's real Saturday: 2,757 kcal against a 2,158 target. */
const chloeSaturday = () => ({
  date: "2026-09-19",
  meals: {
    breakfast: {
      name: "Blueberry Almond Chia Pot",
      calories: 722,
      macros: { protein: 26, carbs: 105, fat: 22 },
      ingredients: ["chia_seeds|45|g|Pantry", "milk|250|ml|Dairy", "honey|1|tbsp|Pantry"],
    },
    lunch: { name: "Turkey Herb Pasta Salad", calories: 750, macros: { protein: 44, carbs: 94, fat: 22 }, ingredients: [] },
    dinner: { name: "Maple Glazed Turkey Cutlet", calories: 705, macros: { protein: 48, carbs: 81, fat: 21 }, ingredients: [] },
    snacks: [
      {
        name: "Hummus Rice Cake Snack",
        calories: 580,
        macros: { protein: 16, carbs: 70, fat: 26 },
        ingredients: ["rice_cakes|3|piece|Grains", "hummus|100|g|Pantry"],
      },
    ],
  },
});

const dayTotal = (day: any) =>
  ["breakfast", "lunch", "dinner"].reduce((s, k) => s + day.meals[k].calories, 0) +
  day.meals.snacks.reduce((s: number, m: any) => s + m.calories, 0);

describe("rebalanceDayCalories", () => {
  it("brings a real +28% day back to within a few percent of target", () => {
    // What remains is the snack: 580 kcal can only come down to 290 before the
    // scale limit, against a 216 target — the dish itself is meal-sized.
    const [day] = rebalanceDayCalories([chloeSaturday()], 2158, [...ALL]).days;
    expect(Math.abs(dayTotal(day) - 2158) / 2158).toBeLessThan(0.07);
  });

  it("scales ingredients and macros together, keeping calories = energy in macros", () => {
    const { days, adjustments } = rebalanceDayCalories([chloeSaturday()], 2158, [...ALL]);
    const b = days[0].meals.breakfast;
    expect(b.calories).toBe(b.macros.protein * 4 + b.macros.carbs * 4 + b.macros.fat * 9);
    expect(b.ingredients[0]).toBe("chia_seeds|34|g|Pantry"); // 45 × 0.748, to the gram under 50 g
    expect(adjustments.find((a) => a.slot === "breakfast")).toMatchObject({ from: 722, target: 540 });
  });

  it("leaves a meal within tolerance exactly as written", () => {
    const [day] = rebalanceDayCalories([chloeSaturday()], 2158, [...ALL]).days;
    expect(day.meals.lunch.calories).toBe(750); // target 755
  });

  it("caps the scale, so a meal-sized 'snack' is reduced but not shrunk to nothing", () => {
    const { adjustments } = rebalanceDayCalories([chloeSaturday()], 2158, [...ALL]);
    const snack = adjustments.find((a) => a.slot === "snack")!;
    expect(snack.to).toBeGreaterThanOrEqual(580 * 0.5 - 5);
    expect(snack.to).toBeLessThan(580);
  });

  it("scales small meals up too", () => {
    const day = chloeSaturday();
    day.meals.dinner = { ...day.meals.dinner, calories: 400, macros: { protein: 30, carbs: 40, fat: 13 } };
    const [out] = rebalanceDayCalories([day], 2158, [...ALL]).days;
    expect(out.meals.dinner.calories).toBeGreaterThan(550);
  });

  it("splits the snack budget across several snacks", () => {
    const day = chloeSaturday();
    day.meals.snacks = [
      { name: "a", calories: 110, macros: { protein: 5, carbs: 15, fat: 3 }, ingredients: [] },
      { name: "b", calories: 110, macros: { protein: 5, carbs: 15, fat: 3 }, ingredients: [] },
    ] as any;
    const { adjustments } = rebalanceDayCalories([day], 2158, [...ALL]);
    expect(adjustments.filter((a) => a.slot === "snack")).toEqual([]); // 108 each is the target
  });

  it("uses the redistributed shares when fewer slots are active", () => {
    const day = chloeSaturday();
    delete (day.meals as any).breakfast;
    (day.meals as any).snacks = [];
    const { days } = rebalanceDayCalories([day], 2000, ["lunch", "dinner"]);
    const total = days[0].meals.lunch.calories + days[0].meals.dinner.calories;
    expect(Math.abs(total - 2000) / 2000).toBeLessThan(0.12);
  });

  it("ignores days and meals it cannot read", () => {
    expect(() => rebalanceDayCalories([null, { meals: { lunch: { name: "x" } } }], 2000, [...ALL])).not.toThrow();
  });
});

describe("amount rounding", () => {
  it("rounds to what a person would measure", () => {
    expect(roundAmount(33.75, "g")).toBe(34);
    expect(roundAmount(187.5, "ml")).toBe(190);
    expect(roundAmount(0.75, "tbsp")).toBe(0.75);
    expect(roundAmount(2.3, "piece")).toBe(2.5);
    expect(roundAmount(0.1, "piece")).toBe(0.5);
  });

  it("scales tuple ingredients and passes unparseable ones through", () => {
    expect(scaleIngredient(["oats", "60 g", "Grains"], 0.5)).toEqual(["oats", "30 g", "Grains"]);
    expect(scaleIngredient("salt|to taste|pinch|Spices", 0.5)).toBe("salt|to taste|pinch|Spices");
    expect(scaleIngredient({ weird: true }, 0.5)).toEqual({ weird: true });
  });
});
