import {
  applyOwnDishes,
  balanceAroundOwnDishes,
  changeSide,
  chooseTune,
  SideChoiceError,
  sideChoicesFor,
  OWN_DISH_MAIN_SHARE,
} from "../../../src/generator/own-dishes";

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
  // Calories are the energy in the macros, as on a real plan.
  macros: { protein: 25, carbs: 60, fat: Math.round((calories - 340) / 9) },
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

  it("plans the dish as the user makes it, at their own portion", () => {
    // A smaller schnitzel is not their schnitzel, and nobody re-reads the
    // recipe to notice. The day makes room for it instead.
    const { weeklyPlan } = applyOwnDishes(week(), [dish("Pasta with tomato and basil")], 2158);
    const placed = mains(weeklyPlan).find((m) => m.fromRepertoire)!;

    expect(placed.name).toBe("Pasta with tomato and basil");
    expect(placed.ingredients.slice(0, 2)).toEqual([
      ["pasta", "100 g"],
      ["tomato", "150 g"],
    ]);
    expect(placed.prepTime).toBe(25);
    // Their 500 kcal, plus whatever side fills the slot.
    expect(placed.calories - (placed.side?.calories ?? 0)).toBe(500);
    expect(placed.tuneLevel).toBeUndefined();
  });

  it("gives their dish an id of its own, so its recipe is not the replaced meal's", () => {
    // The recipe is looked up by id: keeping the replaced meal's id opened
    // "Pan Seared Ribeye" for a schnitzel.
    const before = week();
    const replacedIds = new Set(mains(before).map((m) => String(m._id)));
    const { weeklyPlan } = applyOwnDishes(before, [dish("Chicken schnitzel")], 2158);
    for (const placed of mains(weeklyPlan).filter((m) => m.fromRepertoire)) {
      expect(placed._id).toBeDefined();
      expect(replacedIds.has(String(placed._id))).toBe(false);
    }
  });

  it("fills the meal with a side next to a light dish, rather than resizing it", () => {
    const skewers = dish("Chicken shishlik skewers", {
      usual: {
        ingredients: [{ name: "chicken thighs", amount: "200 g" }],
        prepMinutes: 15,
        nutritionPerServing: { calories: 410, protein: 41, carbs: 11, fat: 22 },
      },
    });
    const { weeklyPlan } = applyOwnDishes(week(), [skewers], 2800);
    const placed = mains(weeklyPlan).find((m) => m.fromRepertoire)!;

    expect(placed.name).toBe("Chicken shishlik skewers");
    expect(placed.ingredients[0]).toEqual(["chicken thighs", "200 g"]);
    expect(placed.side).toBeDefined();
    // The meal now fills its slot (lunch 980 or dinner 840 of 2,800).
    expect(placed.calories).toBeGreaterThan(750);
  });

  it("serves a healthier swap at its own portion too, with a side to fill the meal", () => {
    const tuned = dish("Chicken schnitzel", {
      usual: {
        ingredients: [{ name: "chicken breast", amount: "150 g" }],
        prepMinutes: 20,
        nutritionPerServing: { calories: 574, protein: 44, carbs: 41, fat: 26 },
      },
      tunes: [
        {
          level: 1,
          name: "Oven-baked chicken schnitzel",
          changes: ["baked"],
          nutritionPerServing: { calories: 456, protein: 44, carbs: 35, fat: 15 },
        },
      ],
    });
    const { weeklyPlan } = applyOwnDishes(week(), [tuned], 2800, undefined, 1);
    const swap = mains(weeklyPlan).find((m) => m.tuneLevel)!;
    // A doubled chicken breast is not a lighter take on their schnitzel.
    expect(swap.calories - (swap.side?.calories ?? 0)).toBe(456);
    expect(swap.side).toBeDefined();
  });

  it("makes room in the rest of the day for their dish, rather than resizing it", () => {
    const { weeklyPlan } = applyOwnDishes(week(), [dish("Pasta with tomato and basil")], 2158);
    const key = Object.keys(weeklyPlan).find((k) =>
      [weeklyPlan[k].meals.lunch, weeklyPlan[k].meals.dinner].some((m: any) => m.fromRepertoire),
    )!;
    const day = weeklyPlan[key];
    const total = (d: any) =>
      [d.meals.breakfast, d.meals.lunch, d.meals.dinner, ...d.meals.snacks].reduce(
        (s: number, m: any) => s + m.calories,
        0,
      );

    const { days } = balanceAroundOwnDishes(weeklyPlan, 2158);

    expect(days).toBeGreaterThan(0);
    expect(Math.abs(total(day) - 2158) / 2158).toBeLessThan(0.03);
    const own = [day.meals.lunch, day.meals.dinner].find((m: any) => m.fromRepertoire);
    expect(own.calories - (own.side?.calories ?? 0)).toBe(500);
  });

  it("leaves a day with none of their dishes, and a meal already eaten, alone", () => {
    const p = week();
    const key = "2026-09-21";
    p[key].meals.lunch = { ...p[key].meals.lunch, fromRepertoire: "d1", calories: 400 };
    p[key].meals.breakfast.done = true;
    const breakfast = p[key].meals.breakfast.calories;
    const untouched = JSON.stringify(p["2026-09-22"]);

    balanceAroundOwnDishes(p, 2158);

    expect(p[key].meals.breakfast.calories).toBe(breakfast);
    expect(JSON.stringify(p["2026-09-22"])).toBe(untouched);
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
      const placed = mains(weeklyPlan).find((m: any) => m.tuneLevel)!;

      expect(placed.name).toBe("Baked chicken schnitzel with salad");
      expect(placed.insteadOf).toBe("Chicken schnitzel with salad");
      expect(placed.swapNote).toBe("Your schnitzel, oven-baked instead of fried");
      // The swap's recipe, not hers: no frying oil, far less breadcrumb.
      expect(placed.ingredients.slice(0, 2)).toEqual([
        ["chicken breast", "150 g"],
        ["breadcrumbs", "25 g"],
      ]);
      expect(placed.macros.fat).toBeLessThan(placed.macros.protein);
    });

    it("keeps the dish and lists what changed, rather than serving something else", () => {
      const { weeklyPlan, stats } = applyOwnDishes(week(), [pasta], 2158, undefined, 2, {
        calories: 2158,
        protein: 140,
        carbs: 385,
        fat: 78,
      });
      const placed = mains(weeklyPlan).find((m: any) => m.tuneLevel)!;

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

    it("serves most of their dishes as they make them — swaps are at most half", () => {
      const { weeklyPlan, stats } = applyOwnDishes(week(), [pasta, dish("Chicken schnitzel")], 2158, undefined, 3);
      const placed = mains(weeklyPlan).filter((m: any) => m.fromRepertoire);
      const swapped = placed.filter((m: any) => m.tuneLevel);

      expect(placed.length).toBeGreaterThan(1);
      expect(swapped.length).toBeLessThanOrEqual(Math.floor(placed.length / 2));
      expect(stats.tuned.length).toBe(swapped.length);
      // The first time a dish of theirs shows up, it is theirs.
      expect(placed[0].tuneLevel).toBeUndefined();
    });

    it("keeps the swap share across generation phases", () => {
      const first = applyOwnDishes(week(), [pasta], 2158, undefined, 3).weeklyPlan;
      const again = applyOwnDishes(first, [pasta], 2158, undefined, 3).weeklyPlan;
      const placed = mains(again).filter((m: any) => m.fromRepertoire);
      expect(placed.filter((m: any) => m.tuneLevel).length).toBeLessThanOrEqual(Math.floor(placed.length / 2));
    });

    it("has nothing to serve differently when a dish was never tuned", () => {
      const { weeklyPlan, stats } = applyOwnDishes(week(), [dish("Plain")], 2158, undefined, 3);
      expect(stats.tuned).toEqual([]);
      expect(mains(weeklyPlan).find((m: any) => m.fromRepertoire)!.tuneLevel).toBeUndefined();
    });
  });
});

describe("changeSide", () => {
  const skewers = () =>
    dish("Chicken shishlik skewers", {
      usual: {
        ingredients: [{ name: "chicken thighs", amount: "200 g" }],
        prepMinutes: 15,
        nutritionPerServing: { calories: 410, protein: 41, carbs: 11, fat: 22 },
      },
    });
  // The fixture week is sized for 2,158 kcal: lunch 755, dinner 647.
  const dayWithSkewers = () => {
    const { weeklyPlan } = applyOwnDishes(week(), [skewers()], 2158);
    const key = Object.keys(weeklyPlan).find((k) => weeklyPlan[k].meals.dinner.fromRepertoire || weeklyPlan[k].meals.lunch.fromRepertoire)!;
    const slot = weeklyPlan[key].meals.dinner.fromRepertoire ? "dinner" : "lunch";
    return { day: weeklyPlan[key], slot: slot as "lunch" | "dinner", slotCalories: slot === "dinner" ? 647 : 755 };
  };
  const total = (d: any) =>
    [d.meals.breakfast, d.meals.lunch, d.meals.dinner, ...d.meals.snacks].reduce((s: number, m: any) => s + m.calories, 0);

  it("lists the sides for their dish and marks the current one", () => {
    const { day, slot, slotCalories } = dayWithSkewers();
    const { current, options } = sideChoicesFor(day.meals[slot], slotCalories);
    expect(current).toBe(day.meals[slot].side.id);
    expect(options.map((o) => o.id)).toContain(current);
  });

  it("swaps the side, keeps their dish, and keeps the day on target", () => {
    const { day, slot, slotCalories } = dayWithSkewers();
    changeSide(day, slot, "quinoa+green-salad", slotCalories, 2158);
    const meal = day.meals[slot];
    expect(meal.name).toBe("Chicken shishlik skewers");
    expect(meal.ingredients[0]).toEqual(["chicken thighs", "200 g"]);
    expect(meal.side.id).toBe("quinoa+green-salad");
    expect(meal.calories - meal.side.calories).toBe(410);
    expect(meal.sideChosen).toBe(true);
    expect(Math.abs(total(day) - 2158) / 2158).toBeLessThan(0.04);
  });

  it("takes the side away and lets the rest of the day make room", () => {
    const { day, slot, slotCalories } = dayWithSkewers();
    changeSide(day, slot, null, slotCalories, 2158);
    expect(day.meals[slot].side).toBeUndefined();
    expect(day.meals[slot].calories).toBe(410);
    expect(Math.abs(total(day) - 2158) / 2158).toBeLessThan(0.04);
  });

  it("refuses a side that does not suit the dish, and a meal already logged", () => {
    const { day, slot, slotCalories } = dayWithSkewers();
    expect(() => changeSide(day, slot, "chips", slotCalories, 2158)).toThrow(SideChoiceError);
    day.meals[slot].done = true;
    expect(() => changeSide(day, slot, null, slotCalories, 2158)).toThrow(SideChoiceError);
  });

  it("adds a side to a planned meal too, and the rest of the day makes room", () => {
    const d = week()["2026-09-21"];
    const lunch = d.meals.lunch.calories;
    changeSide(d, "lunch", "israeli-salad", 755, 2158);

    expect(d.meals.lunch.name).toBe("L21");
    expect(d.meals.lunch.side.id).toBe("israeli-salad");
    // The dish keeps its portion; the side sits on top of it.
    expect(d.meals.lunch.calories - d.meals.lunch.side.calories).toBe(lunch);
    // Breakfast, dinner and snack gave up what the side added.
    expect(Math.abs(total(d) - 2158) / 2158).toBeLessThan(0.04);
    // Side ingredients land on the shopping list under a category.
    expect(d.meals.lunch.ingredients.at(-1)).toEqual(["israeli salad", expect.any(String), "Vegetables"]);
  });

  it("takes a side back off a planned meal", () => {
    const d = week()["2026-09-21"];
    changeSide(d, "lunch", "israeli-salad", 755, 2158);
    changeSide(d, "lunch", null, 755, 2158);

    expect(d.meals.lunch.side).toBeUndefined();
    expect(d.meals.lunch.name).toBe("L21");
    expect(d.meals.lunch.ingredients).toHaveLength(1);
    // Back to an ordinary planned meal: it rebalances with the rest of the day.
    expect(Math.abs(d.meals.lunch.calories - 755) / 755).toBeLessThan(0.1);
    expect(Math.abs(total(d) - 2158) / 2158).toBeLessThan(0.04);
  });
});
