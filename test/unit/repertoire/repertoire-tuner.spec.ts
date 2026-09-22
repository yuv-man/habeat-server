import {
  addedDislikes,
  buildTunePrompt,
  energyConsistent,
  goalForPath,
  validateTunes,
} from "../../../src/repertoire/repertoire.tuner";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";

const none = resolveDietaryConstraints({});

/** Bolognese as the user makes it: 700 kcal, 30p / 85c / 26f (≈ 694 from macros). */
const dish = {
  name: "Pasta Bolognese",
  slots: ["dinner" as const],
  usual: {
    ingredients: [
      { name: "spaghetti", amount: "120 g" },
      { name: "beef mince", amount: "100 g" },
      { name: "tomato sauce", amount: "150 g" },
      { name: "olive oil", amount: "2 tbsp" },
    ],
    servings: null,
    prepMinutes: 30,
    nutritionPerServing: { calories: 700, protein: 30, carbs: 85, fat: 26 },
    nutritionConfidence: "logged" as const,
  },
};

const n = (calories: number, protein: number, carbs: number, fat: number) => ({
  calories,
  protein,
  carbs,
  fat,
});

const level1 = {
  level: 1,
  name: "Wholewheat pasta bolognese",
  swapNote: "Your bolognese, with wholewheat pasta and less oil",
  changes: ["wholewheat spaghetti instead of white", "1 tbsp olive oil instead of 2"],
  ingredients: [
    // A real level 1: the pasta itself changes, not just how much of it.
    { name: "wholewheat spaghetti", amount: "120 g" },
    { name: "beef mince", amount: "100 g" },
    { name: "tomato sauce", amount: "150 g" },
    { name: "olive oil", amount: "1 tbsp" },
  ],
  nutritionPerServing: n(560, 28, 64, 21), // 557
};

const level2 = {
  level: 2,
  name: "Bolognese with wholewheat pasta and extra veg",
  swapNote: "The same bolognese, with vegetables through the sauce",
  changes: [
    "wholewheat spaghetti instead of white",
    "1 tbsp olive oil instead of 2",
    "grated courgette folded into the sauce",
  ],
  ingredients: [...level1.ingredients, { name: "courgette", amount: "100 g" }],
  nutritionPerServing: n(580, 30, 68, 21), // 581
};

const level3 = {
  level: 3,
  name: "Lean bolognese with wholewheat pasta",
  swapNote: "Your bolognese made with lean mince",
  changes: [...level2.changes, "lean beef mince (5% fat)"],
  ingredients: level2.ingredients.map((i) =>
    i.name === "beef mince" ? { name: "lean beef mince", amount: "100 g" } : i,
  ),
  nutritionPerServing: n(520, 32, 68, 14), // 526
};

const run = (raw: any, path = "lose-weight", constraints = none, dislikes: string[] = []) =>
  validateTunes(raw, dish, path, constraints, dislikes);

describe("validateTunes", () => {
  it("keeps three well-formed tunes, in order", () => {
    const r = run({ usual: null, tunes: [level3, level1, level2] });
    expect(r.tunes.map((t) => t.level)).toEqual([1, 2, 3]);
    expect(r.dropped).toEqual([]);
  });

  it("drops a tune whose calories do not match its macros", () => {
    const r = run({ tunes: [{ ...level1, nutritionPerServing: n(300, 28, 64, 21) }] });
    expect(r.tunes).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/calories do not match/);
  });

  it("refuses a version that keeps the original name", () => {
    // A real run came back with a leaner shakshuka still called "Shakshuka":
    // on her plan that is the same meal, so the improvement is invisible.
    const sameName = {
      ...level1,
      name: "Pasta Bolognese",
      ingredients: [
        { name: "wholewheat spaghetti", amount: "120 g" },
        { name: "beef mince", amount: "100 g" },
        { name: "tomato sauce", amount: "150 g" },
      ],
    };
    expect(run({ tunes: [sameName] }).dropped[0].reason).toMatch(/keeps the original name/);
  });

  it("refuses a version the user would never notice", () => {
    // Same dish, same ingredients, only the numbers moved: invisible on a plan.
    const quieter = {
      ...level1,
      name: "Pasta Bolognese",
      changes: ["90 g spaghetti instead of 120 g"],
      ingredients: dish.usual.ingredients.map((i) =>
        i.name === "spaghetti" ? { name: "spaghetti", amount: "90 g" } : i,
      ),
    };
    expect(run({ tunes: [quieter] }).dropped[0].reason).toMatch(/keeps the original name/);
  });

  it("refuses a version with no name of its own", () => {
    const { name, ...unnamed } = level1;
    expect(run({ tunes: [unnamed] }).dropped[0].reason).toMatch(/no name/);
  });

  it("refuses a swap that is simply a different food", () => {
    const notTheirDish = {
      ...level1,
      name: "Greek salad",
      ingredients: [
        { name: "cucumber", amount: "100 g" },
        { name: "feta", amount: "50 g" },
        { name: "olives", amount: "30 g" },
      ],
    };
    expect(run({ tunes: [notTheirDish] }).dropped[0].reason).toMatch(/different food/);
  });

  it("keeps a swap that changes the dish but keeps the food", () => {
    // The real case: fried schnitzel becomes baked chicken breast.
    const schnitzel = {
      name: "Chicken schnitzel with salad",
      slots: ["dinner" as const],
      usual: {
        ingredients: [
          { name: "chicken breast", amount: "150 g" },
          { name: "breadcrumbs", amount: "50 g" },
          { name: "sunflower oil", amount: "3 tbsp" },
          { name: "salad", amount: "100 g" },
        ],
        servings: null,
        prepMinutes: 25,
        nutritionPerServing: { calories: 700, protein: 45, carbs: 45, fat: 36 },
        nutritionConfidence: "logged" as const,
      },
    };
    const baked = {
      level: 2,
      name: "Baked chicken breast with the same salad",
      swapNote: "Your schnitzel, baked instead of fried",
      changes: ["chicken baked, not fried", "no frying oil", "light breadcrumb coating"],
      ingredients: [
        { name: "chicken breast", amount: "150 g" },
        { name: "breadcrumbs", amount: "20 g" },
        { name: "olive oil", amount: "1 tsp" },
        { name: "salad", amount: "150 g" },
      ],
      nutritionPerServing: { calories: 480, protein: 50, carbs: 30, fat: 16 }, // 464
    };
    const r = validateTunes({ tunes: [{ ...baked, level: 1 }] }, schnitzel, "healthy", none);
    expect(r.dropped).toEqual([]);
    expect(r.tunes).toHaveLength(1);
    expect(r.tunes[0].name).toBe("Baked chicken breast with the same salad");
    expect(r.tunes[0].swapNote).toMatch(/baked instead of fried/);
  });

  it("drops a tune that changes too much to still be a tune", () => {
    const r = run({
      // Level 1 may list up to 3 differences; a fourth is a new recipe.
      tunes: [{ ...level1, changes: ["a", "b", "c", "d"] }],
    });
    expect(r.dropped[0].reason).toMatch(/new recipe/);
  });

  it("drops a swap that is far more food than their own dish", () => {
    // Leaner in the mix, but half as much again on the plate: not their meal.
    const huge = { ...level1, nutritionPerServing: n(1100, 60, 170, 24) }; // 1136
    expect(run({ tunes: [huge] }, "lose-weight").dropped[0].reason).toMatch(/outside the goal/);
  });

  it("wants a healthier mix, not just a smaller plate", () => {
    // Same balance as her own dish, simply less of it.
    const smaller = {
      ...level1,
      nutritionPerServing: n(560, 24, 68, 21), // 557 — identical shares
    };
    expect(run({ tunes: [smaller] }).dropped[0].reason).toMatch(/balance barely moves/);
  });

  it("refuses more carbs on a keto path", () => {
    const moreCarbs = { ...level1, nutritionPerServing: n(900, 45, 88, 41) }; // 901
    expect(run({ tunes: [moreCarbs] }, "keto").dropped[0].reason).toMatch(/carbs went up/);
  });

  it("drops a tune that breaks a dietary restriction", () => {
    const glutenFree = resolveDietaryConstraints({ dietaryRestrictions: ["vegetarian"] });
    const r = validateTunes({ tunes: [level1] }, { ...dish, name: "Veg Bolognese" }, null, glutenFree);
    expect(r.tunes).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/dietary constraints/);
  });

  it("drops a tune that adds a disliked food", () => {
    const r = run({ tunes: [level1, level2] }, "lose-weight", none, ["courgette"]);
    expect(r.tunes.map((t) => t.level)).toEqual([1]);
    expect(r.dropped[0].reason).toMatch(/disliked courgette/);
  });

  it("will not keep a level 3 with no level 2 beneath it", () => {
    const r = run({ tunes: [level1, level3] });
    expect(r.tunes.map((t) => t.level)).toEqual([1]);
    expect(r.dropped).toEqual([{ level: 3, reason: "lower level missing" }]);
  });

  it("ignores duplicate and invalid levels", () => {
    const r = run({ tunes: [level1, level1, { ...level2, level: 7 }] });
    expect(r.tunes.map((t) => t.level)).toEqual([1]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["duplicate level", "invalid level"]);
  });

  describe("a dish captured from logs, with no recipe", () => {
    const captured = { ...dish, usual: { ...dish.usual, ingredients: [] } };
    const usual = {
      ingredients: dish.usual.ingredients,
      nutritionPerServing: n(690, 29, 85, 26), // 690 — the model's reconstruction
    };

    it("takes the reconstructed recipe, but judges tunes against the logged nutrition", () => {
      const r = validateTunes({ usual, tunes: [level1] }, captured, "lose-weight", none);
      expect(r.usual?.ingredients).toHaveLength(4);
      expect(r.tunes).toHaveLength(1);
    });

    it("keeps nothing when the reconstruction does not add up", () => {
      const bad = { ...usual, nutritionPerServing: n(200, 29, 85, 26) };
      const r = validateTunes({ usual: bad, tunes: [level1] }, captured, "lose-weight", none);
      expect(r.usual).toBeNull();
      expect(r.tunes).toEqual([]);
      expect(r.dropped[0].reason).toBe("no usable baseline");
    });
  });
});

describe("helpers", () => {
  it("checks energy against macros within tolerance", () => {
    expect(energyConsistent(n(700, 30, 85, 26))).toBe(true);
    expect(energyConsistent(n(400, 30, 85, 26))).toBe(false);
  });

  it("maps diet paths to goals, with a balanced default", () => {
    expect(goalForPath("lose-weight").betterMeans).toBe("less fat");
    expect(goalForPath("gain-muscle").betterMeans).toBe("more protein");
    expect(goalForPath("keto").capCarbs).toBe(true);
    expect(goalForPath("keto").betterMeans).toBe("fewer carbs");
    // Wide enough that a real swap — baked chicken for fried schnitzel — is
    // not refused for being lighter than the dish it replaces.
    expect(goalForPath(undefined).calorieRange[0]).toBeLessThanOrEqual(0.5);
  });

  it("does not count a dislike the user's own recipe already has", () => {
    const ings = [{ name: "onion", amount: "1" }];
    expect(addedDislikes(ings, [{ name: "red onion" }], ["onion"])).toEqual([]);
    expect(addedDislikes(ings, [], ["onion"])).toEqual(["onion"]);
  });
});

describe("buildTunePrompt", () => {
  it("gives the recipe when known, and asks for none back", () => {
    const p = buildTunePrompt(dish, "lose-weight", none);
    expect(p).toContain("HOW THEY MAKE IT NOW");
    expect(p).toContain("spaghetti: 120 g");
    expect(p).toContain('Return "usual" as null');
    expect(p).toContain("weight loss");
  });

  it("asks for a reconstruction matched to the logged serving when the recipe is unknown", () => {
    const p = buildTunePrompt({ ...dish, usual: { ...dish.usual, ingredients: [] } }, null, none);
    expect(p).toContain("reconstruct how this dish is typically made");
    expect(p).toContain("about 700 kcal");
  });

  it("carries hard constraints and dislikes", () => {
    const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });
    const p = buildTunePrompt(dish, null, vegan, ["mushrooms"]);
    expect(p).toContain("HARD DIETARY CONSTRAINTS");
    expect(p).toContain("NEVER ADD (disliked): mushrooms");
  });
});
