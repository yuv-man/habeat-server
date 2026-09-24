import {
  balancePlanMacros,
  dayMacroError,
  dayMacroTotals,
  nudgeDayMacros,
  planMacroAccuracy,
  slotMacroTargets,
} from "../../../src/generator/macro-targets";

/** Chloe's day: 2,802 kcal, protein 140 g, carbs 385 g, fat 78 g. */
const TARGET = { protein: 140, carbs: 385, fat: 78 };
const ALL = ["breakfast", "lunch", "dinner", "snack"] as const;

const meal = (name: string, protein: number, carbs: number, fat: number) => ({
  name,
  macros: { protein, carbs, fat },
  calories: protein * 4 + carbs * 4 + fat * 9,
  ingredients: [[name.toLowerCase(), "100 g"]],
});

/**
 * The real failure mode: 2,801 kcal — bang on target — but carbs 25% short and
 * fat 50% over. Portion-scaling cannot fix this; only the mix can.
 */
const fattyDay = () => ({
  date: "2026-09-24",
  meals: {
    breakfast: meal("Almond Butter Pancakes", 30, 70, 28),
    lunch: meal("Salmon Flatbread", 45, 95, 38),
    dinner: meal("Artichoke Olive Oil Feast", 50, 85, 40),
    snacks: [meal("Cheese and Olive Plate", 23, 39, 11)],
  },
});

describe("slotMacroTargets", () => {
  it("splits the day's macros across slots, adding up to the day", () => {
    const targets = slotMacroTargets(TARGET, [...ALL]);
    for (const macro of ["protein", "carbs", "fat"] as const) {
      const total = ALL.reduce((s, slot) => s + targets[slot][macro], 0);
      // The old split handed out 175% of the day's carbs.
      expect(Math.abs(total - TARGET[macro])).toBeLessThanOrEqual(2);
    }
  });

  it("gives the biggest meal the biggest share", () => {
    const t = slotMacroTargets(TARGET, [...ALL]);
    expect(t.lunch.carbs).toBeGreaterThan(t.breakfast.carbs);
    expect(t.breakfast.carbs).toBeGreaterThan(t.snack.carbs);
  });

  it("redistributes when a slot is not eaten", () => {
    const t = slotMacroTargets(TARGET, ["lunch", "dinner"]);
    expect(t.lunch.protein + t.dinner.protein).toBeGreaterThanOrEqual(TARGET.protein - 2);
  });
});

describe("dayMacroError", () => {
  it("reports how far each macro is off, with sign", () => {
    const error = dayMacroError(fattyDay(), TARGET);
    expect(error.fat).toBeGreaterThan(0.4); // 50% over
    expect(error.carbs).toBeLessThan(-0.2); // 25% under
  });
});

describe("nudgeDayMacros", () => {
  it("moves a fat-heavy, carb-light day toward its targets", () => {
    const day = fattyDay();
    const before = dayMacroError(day, TARGET);
    const nudges = nudgeDayMacros(day, TARGET);
    const after = dayMacroError(day, TARGET);

    expect(nudges.length).toBeGreaterThan(0);
    expect(Math.abs(after.carbs)).toBeLessThan(Math.abs(before.carbs));
    expect(Math.abs(after.fat)).toBeLessThan(Math.abs(before.fat));
  });

  it("keeps the day's calories where they were", () => {
    const day = fattyDay();
    const calories = (d: any) =>
      [d.meals.breakfast, d.meals.lunch, d.meals.dinner, ...d.meals.snacks].reduce(
        (s: number, m: any) => s + m.calories,
        0,
      );
    const before = calories(day);
    nudgeDayMacros(day, TARGET);
    expect(Math.abs(calories(day) - before) / before).toBeLessThan(0.08);
  });

  it("changes portions, never the dishes", () => {
    const day = fattyDay();
    nudgeDayMacros(day, TARGET);
    expect(day.meals.breakfast.name).toBe("Almond Butter Pancakes");
    expect(day.meals.dinner.name).toBe("Artichoke Olive Oil Feast");
    expect(day.meals.lunch.ingredients[0][0]).toBe("salmon flatbread");
  });

  it("leaves a day that is already balanced alone", () => {
    const balanced = {
      meals: {
        breakfast: meal("A", 35, 96, 20),
        lunch: meal("B", 49, 135, 27),
        dinner: meal("C", 42, 115, 23),
        snacks: [meal("D", 14, 39, 8)],
      },
    };
    expect(nudgeDayMacros(balanced, TARGET)).toEqual([]);
  });

  it("keeps calories and macros consistent after a trade", () => {
    const day = fattyDay();
    nudgeDayMacros(day, TARGET);
    for (const m of [day.meals.breakfast, day.meals.lunch, day.meals.dinner, ...day.meals.snacks]) {
      expect(m.calories).toBe(m.macros.protein * 4 + m.macros.carbs * 4 + m.macros.fat * 9);
    }
  });

  it("does nothing when there is nothing to trade with", () => {
    expect(nudgeDayMacros({ meals: { lunch: meal("only", 40, 50, 30) } }, TARGET)).toEqual([]);
    expect(nudgeDayMacros({}, TARGET)).toEqual([]);
  });

  /**
   * Tamir's Sunday: 2,803 kcal target, protein 174 g. His own shishlik was cut
   * 30% for its fat and a grain bowl grew to 1,170 kcal to make up the day.
   */
  const ownDishDay = () => ({
    date: "2026-09-27",
    meals: {
      breakfast: meal("Eggs and Toast", 40, 60, 30),
      lunch: meal("Turkey Grain Bowl", 60, 110, 18),
      dinner: { ...meal("Chicken shishlik skewers", 80, 20, 45), fromRepertoire: "dish-1" },
      snacks: [meal("Greek Yogurt Bowl", 20, 30, 8)],
    },
  });
  const OWN_TARGET = { protein: 174, carbs: 281, fat: 109 };
  const dayCalories = (d: any) =>
    [d.meals.breakfast, d.meals.lunch, d.meals.dinner, ...d.meals.snacks].reduce(
      (s: number, m: any) => s + m.calories,
      0,
    );

  it("never resizes a dish the user cooks, served as they make it", () => {
    const day = ownDishDay();
    const before = day.meals.dinner.calories;
    nudgeDayMacros(day, OWN_TARGET);
    expect(day.meals.dinner.calories).toBe(before);
  });

  it("keeps a healthier swap within 10% of its size", () => {
    const day = ownDishDay();
    (day.meals.dinner as any).tuneLevel = 1;
    const before = day.meals.dinner.calories;
    nudgeDayMacros(day, OWN_TARGET);
    const ratio = day.meals.dinner.calories / before;
    // Rounding in scaleMeal can land a hair outside the factor.
    expect(ratio).toBeGreaterThanOrEqual(0.88);
    expect(ratio).toBeLessThanOrEqual(1.12);
  });

  it("never grows a meal more than 20% past its slot's share of the day", () => {
    const day = ownDishDay();
    const total = dayCalories(day);
    const shares = { breakfast: 0.25, lunch: 0.35 };
    const before = { breakfast: day.meals.breakfast.calories, lunch: day.meals.lunch.calories };
    nudgeDayMacros(day, OWN_TARGET);
    for (const slot of ["breakfast", "lunch"] as const) {
      const after = day.meals[slot].calories;
      if (after > before[slot]) {
        expect(after).toBeLessThanOrEqual(Math.ceil(total * shares[slot] * 1.2) + 5);
      }
    }
  });

  it("does not grow a meal that is already over its slot", () => {
    const day = fattyDay();
    // The snack is 347 kcal against a 280 kcal slot.
    const snack = day.meals.snacks[0].calories;
    nudgeDayMacros(day, TARGET);
    expect(day.meals.snacks[0].calories).toBeLessThanOrEqual(snack);
  });
});

describe("plan level", () => {
  const plan = () => ({ "2026-09-24": fattyDay(), "2026-09-25": fattyDay() });

  it("improves the whole plan and reports the accuracy", () => {
    const p = plan();
    const before = planMacroAccuracy(p, TARGET, 2802);
    const { weeklyPlan, nudges } = balancePlanMacros(p, TARGET);
    const after = planMacroAccuracy(weeklyPlan, TARGET, 2802);

    expect(nudges.length).toBeGreaterThan(0);
    expect(after.carbs).toBeLessThan(before.carbs);
    expect(after.fat).toBeLessThan(before.fat);
  });

  it("reports zero for an empty plan rather than dividing by nothing", () => {
    expect(planMacroAccuracy({}, TARGET, 2802)).toEqual({ protein: 0, carbs: 0, fat: 0, calories: 0 });
  });

  it("totals a day's macros", () => {
    expect(dayMacroTotals(fattyDay())).toEqual({ protein: 148, carbs: 289, fat: 117 });
  });
});
