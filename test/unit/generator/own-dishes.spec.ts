import { applyOwnDishes, chooseTune, OWN_DISH_MAIN_SHARE } from "../../../src/generator/own-dishes";

const dish = (name: string, over: any = {}) => ({
  _id: name,
  name,
  slots: ["lunch", "dinner"],
  usual: {
    ingredients: [
      { name: "pasta", amount: "100 g" },
      { name: "tomato", amount: "150 g" },
    ],
    prepMinutes: 25,
    nutritionPerServing: { calories: 500, protein: 20, carbs: 70, fat: 14 },
  },
  rhythm: { usualPerMonth: 4 },
  ...over,
});

const generated = (name: string, calories: number) => ({
  _id: `gen-${name}`,
  name,
  category: "x",
  calories,
  macros: { protein: 25, carbs: 60, fat: 20 },
  ingredients: [["something", "100 g"]],
  prepTime: 30,
  done: false,
});

/** Mon 21 → Sun 27 Sep 2026. */
const week = () => {
  const p: Record<string, any> = {};
  for (let d = 21; d <= 27; d++) {
    p[`2026-09-${d}`] = {
      meals: {
        breakfast: generated(`B${d}`, 540),
        lunch: generated(`L${d}`, 755),
        dinner: generated(`D${d}`, 647),
        snacks: [generated(`S${d}`, 216)],
      },
    };
  }
  return p;
};

const mains = (wp: Record<string, any>) =>
  Object.keys(wp)
    .sort()
    .flatMap((k) => [wp[k].meals.lunch, wp[k].meals.dinner]);

describe("applyOwnDishes", () => {
  const dishes = [dish("Shakshuka", { slots: ["breakfast", "lunch"] }), dish("Pasta with tomato and basil"), dish("Chicken schnitzel")];

  it("gives about 40% of the week's mains to dishes the user cooks", () => {
    const { weeklyPlan, stats } = applyOwnDishes(week(), dishes, 2158);
    const placed = mains(weeklyPlan).filter((m) => m.fromRepertoire);
    expect(placed.length).toBe(Math.floor(14 * OWN_DISH_MAIN_SHARE));
    expect(stats.placed).toBe(placed.length);
  });

  it("plans the dish as the user makes it, portioned to the slot", () => {
    const { weeklyPlan } = applyOwnDishes(week(), [dish("Pasta with tomato and basil")], 2158);
    const placed = mains(weeklyPlan).find((m) => m.fromRepertoire)!;

    expect(placed.name).toBe("Pasta with tomato and basil");
    expect(placed.ingredients[0]).toEqual(["pasta", expect.any(String)]);
    expect(placed.prepTime).toBe(25);
    // 500 kcal dish into a 755 kcal lunch or 647 kcal dinner: scaled, capped at 1.5x.
    expect(placed.calories).toBeGreaterThan(600);
    expect(placed.calories).toBe(
      placed.macros.protein * 4 + placed.macros.carbs * 4 + placed.macros.fat * 9,
    );
  });

  it("serves a light dish as a bigger bowl rather than leaving the day short", () => {
    const soup = dish("Vegetable soup with lentils", {
      usual: {
        ingredients: [{ name: "lentils", amount: "60 g" }, { name: "carrot", amount: "80 g" }],
        prepMinutes: 35,
        nutritionPerServing: { calories: 284, protein: 14, carbs: 40, fat: 7 },
      },
    });
    const { weeklyPlan } = applyOwnDishes(week(), [soup], 2158);
    const placed = mains(weeklyPlan).find((m) => m.fromRepertoire)!;
    expect(placed.calories).toBeGreaterThan(500); // 284 × 2, not × 1.5
    expect(placed.ingredients[0][1]).not.toBe("60 g");
  });

  it("respects the slots a dish is actually eaten at", () => {
    const breakfastOnly = dish("Greek yogurt", { slots: ["breakfast"] });
    const { stats } = applyOwnDishes(week(), [breakfastOnly], 2158);
    expect(stats.placed).toBe(0);
  });

  it("never serves one dish more often than the user eats it", () => {
    const rare = dish("Sunday roast", { rhythm: { usualPerMonth: 1 } });
    const { weeklyPlan } = applyOwnDishes(week(), [rare], 2158);
    const count = mains(weeklyPlan).filter((m) => m.name === "Sunday roast").length;
    expect(count).toBeLessThanOrEqual(2); // ceil(1/4) + 1
  });

  it("does not put the same dish on consecutive days", () => {
    const { weeklyPlan } = applyOwnDishes(week(), [dish("Only dish")], 2158);
    const days = Object.keys(weeklyPlan).sort().filter((k) =>
      [weeklyPlan[k].meals.lunch, weeklyPlan[k].meals.dinner].some((m: any) => m.fromRepertoire),
    );
    for (let i = 1; i < days.length; i++) {
      expect(new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()).toBeGreaterThan(86400000);
    }
  });

  it("skips a dish with no nutrition behind it", () => {
    const unresolved = dish("grandma's stew", { usual: { ingredients: [], nutritionPerServing: null } });
    expect(applyOwnDishes(week(), [unresolved], 2158).stats.placed).toBe(0);
  });

  it("is idempotent — a second phase does not re-place what is already theirs", () => {
    const { weeklyPlan } = applyOwnDishes(week(), dishes, 2158);
    const before = mains(weeklyPlan).map((m) => m.name);
    const again = applyOwnDishes(weeklyPlan, dishes, 2158);
    expect(mains(again.weeklyPlan).map((m) => m.name)).toEqual(before);
  });

  it("leaves breakfasts and snacks to the generator", () => {
    const { weeklyPlan } = applyOwnDishes(week(), dishes, 2158);
    for (const day of Object.values(weeklyPlan)) {
      expect((day as any).meals.breakfast.fromRepertoire).toBeUndefined();
      expect((day as any).meals.snacks[0].fromRepertoire).toBeUndefined();
    }
  });

  it("does nothing without dishes, and copes with a malformed plan", () => {
    expect(applyOwnDishes(week(), [], 2158).stats.placed).toBe(0);
    expect(() => applyOwnDishes({ "2026-09-21": {} }, dishes, 2158)).not.toThrow();
  });

  describe("serving a better version of the same dish", () => {
    /** Her pasta: as she makes it, then lighter, then lighter still. */
    const pasta = {
      ...dish("Pasta with tomato and basil"),
      usual: {
        ingredients: [{ name: "pasta", amount: "120 g" }, { name: "olive oil", amount: "2 tbsp" }],
        prepMinutes: 25,
        nutritionPerServing: { calories: 700, protein: 18, carbs: 90, fat: 28 },
      },
      tunes: [
        {
          level: 1 as const,
          name: "Wholewheat pasta with tomato and basil",
          swapNote: "Your pasta, wholewheat and with less oil",
          changes: ["wholewheat pasta", "1 tbsp olive oil instead of 2"],
          ingredients: [{ name: "pasta", amount: "90 g" }, { name: "olive oil", amount: "1 tbsp" }],
          nutritionPerServing: { calories: 560, protein: 15, carbs: 72, fat: 20 },
        },
        {
          level: 2 as const,
          name: "Wholewheat pasta with tomato, basil and courgette",
          swapNote: "The same pasta, with vegetables through the sauce",
          changes: ["wholewheat pasta", "1 tbsp oil", "grated courgette in the sauce"],
          ingredients: [{ name: "pasta", amount: "90 g" }, { name: "courgette", amount: "100 g" }],
          nutritionPerServing: { calories: 540, protein: 20, carbs: 76, fat: 14 },
        },
      ],
    };

    const dinnerTarget = { calories: 647, macros: { calories: 647, protein: 32, carbs: 89, fat: 18 } };

    it("serves the swap under its own name, saying which of her dishes it replaces", () => {
      // The whole point: she sees "Baked chicken breast", not "Chicken
      // schnitzel" with quietly different numbers she would never read.
      const schnitzel = {
        ...dish("Chicken schnitzel with salad"),
        usual: {
          ingredients: [{ name: "chicken breast", amount: "150 g" }, { name: "breadcrumbs", amount: "50 g" }],
          prepMinutes: 25,
          nutritionPerServing: { calories: 700, protein: 45, carbs: 45, fat: 36 },
        },
        tunes: [
          {
            level: 1 as const,
            name: "Baked chicken schnitzel with salad",
            swapNote: "Your schnitzel, oven-baked instead of fried",
            changes: ["baked, not fried", "no frying oil"],
            ingredients: [{ name: "chicken breast", amount: "150 g" }, { name: "breadcrumbs", amount: "25 g" }],
            nutritionPerServing: { calories: 480, protein: 50, carbs: 30, fat: 16 },
          },
        ],
      };
      const { weeklyPlan } = applyOwnDishes(week(), [schnitzel], 2158, undefined, 1, {
        calories: 2158,
        protein: 140,
        carbs: 385,
        fat: 78,
      });
      const placed = mains(weeklyPlan).find((m: any) => m.fromRepertoire)!;

      expect(placed.name).toBe("Baked chicken schnitzel with salad");
      expect(placed.insteadOf).toBe("Chicken schnitzel with salad");
      expect(placed.swapNote).toBe("Your schnitzel, oven-baked instead of fried");
      // Portioned to the slot, so the amounts move — but it is the swap's
      // recipe, not hers: no frying oil, far less breadcrumb.
      expect(placed.ingredients.map((i: string[]) => i[0])).toEqual(["chicken breast", "breadcrumbs"]);
      expect(placed.macros.fat).toBeLessThan(placed.macros.protein);
    });

    it("keeps the dish and lists what changed, rather than serving something else", () => {
      const { weeklyPlan, stats } = applyOwnDishes(week(), [pasta], 2158, undefined, 2, {
        calories: 2158,
        protein: 140,
        carbs: 385,
        fat: 78,
      });
      const placed = mains(weeklyPlan).find((m: any) => m.fromRepertoire)!;

      // Level 2 allowed here, so that is the version served — under its own
      // name, with her dish named as the one it replaces.
      expect(placed.name).toBe("Wholewheat pasta with tomato, basil and courgette");
      expect(placed.insteadOf).toBe("Pasta with tomato and basil");
      expect(placed.tuneLevel).toBeGreaterThanOrEqual(1);
      expect(placed.tuneChanges.join(" ")).toMatch(/wholewheat/);
      expect(stats.tuned[0]).toMatchObject({ dish: "Pasta with tomato and basil" });
    });

    it("will not change her food further than the stage allows", () => {
      // Awareness: portion only, whatever the numbers would prefer.
      expect(chooseTune(pasta, dinnerTarget, 1)!.level).toBe(1);
      expect(chooseTune(pasta, dinnerTarget, 2)!.level).toBe(2);
      // Nothing at all at level 0: the plate she knows.
      expect(chooseTune(pasta, dinnerTarget, 0)).toBeNull();
    });

    it("respects a level the user themselves rejected", () => {
      expect(chooseTune({ ...pasta, tuneCeiling: 1 }, dinnerTarget, 3)!.level).toBe(1);
    });

    it("uses the better version when it shifts the mix the right way", () => {
      // Her pasta is 36% fat; the level-1 tune (less oil, more tomato) is 32%,
      // against a target nearer 25%. Portion scaling cannot do that.
      const chosen = chooseTune(pasta, dinnerTarget, 1);
      expect(chosen).not.toBeNull();
      expect(chosen!.level).toBe(1);
      expect(chosen!.name).toMatch(/Wholewheat/);
    });

    it("serves the healthier version even when the day's numbers do not favour it", () => {
      // Whether to improve the dish is the stage's decision, not arithmetic:
      // every stored version has already been checked as a healthier swap of
      // the same food, so a carb-led target must not veto baked chicken.
      const schnitzel = {
        ...dish("Chicken schnitzel"),
        usual: {
          ingredients: [{ name: "chicken breast", amount: "150 g" }],
          prepMinutes: 25,
          nutritionPerServing: { calories: 700, protein: 45, carbs: 45, fat: 36 },
        },
        tunes: [
          {
            level: 1 as const,
            name: "Baked chicken schnitzel",
            swapNote: "Oven-baked instead of fried",
            changes: ["baked, not fried"],
            nutritionPerServing: { calories: 480, protein: 50, carbs: 30, fat: 16 },
          },
        ],
      };
      expect(chooseTune(schnitzel, dinnerTarget, 1)!.name).toBe("Baked chicken schnitzel");
    });

    it("ignores a version with no name — the user would never see the change", () => {
      const unnamed = {
        ...pasta,
        tunes: [{ ...pasta.tunes[0], name: undefined as unknown as string }],
      };
      expect(chooseTune(unnamed, dinnerTarget, 3)).toBeNull();
    });

    it("has nothing to serve differently when a dish was never tuned", () => {
      const { weeklyPlan, stats } = applyOwnDishes(week(), [dish("Plain")], 2158, undefined, 3);
      expect(stats.tuned).toEqual([]);
      expect(mains(weeklyPlan).find((m: any) => m.fromRepertoire)!.tuneLevel).toBeUndefined();
    });
  });
});
