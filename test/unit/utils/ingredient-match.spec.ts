import {
  findDislikesInText,
  findMealDislikes,
  findPlanDislikes,
  normalizeIngredientText,
} from "../../../src/utils/ingredient-match";

/** Every dislike chip offered at onboarding (Registration, step 6). */
const ONBOARDING_DISLIKES = [
  "Olives", "Mushrooms", "Broccoli", "Cilantro", "Bell Peppers", "Onions",
  "Tomatoes", "Spicy Food", "Tofu", "Eggplant", "Spinach", "Avocado", "Artichoke",
];

describe("normalizeIngredientText", () => {
  it("lower-cases, singularises and drops underscores", () => {
    expect(normalizeIngredientText("Bell_Peppers")).toBe("bell pepper");
    expect(normalizeIngredientText("Tomatoes, sun-dried")).toBe("tomato sun dried");
    expect(normalizeIngredientText("Jalapeño")).toBe("jalapeno");
  });

  it("leaves words that only look plural alone", () => {
    expect(normalizeIngredientText("hummus")).toBe("hummus");
    expect(normalizeIngredientText("couscous")).toBe("couscous");
  });
});

describe("findMealDislikes", () => {
  it("matches a plural dislike against a singular ingredient", () => {
    // The bug: "Mushrooms" never matched the ingredient "mushroom", so a
    // Veggie Omelette with mushrooms reached a user who had said no.
    const omelette = {
      name: "Veggie Omelette with Whole Wheat Toast",
      ingredients: [["egg", "3.5 unit"], ["mushroom", "55 g"], ["bell_pepper_green", "55 g"]],
    };
    expect(findMealDislikes(omelette, ["Mushrooms"])).toEqual(["Mushrooms"]);
    expect(findMealDislikes(omelette, ["Bell Peppers"])).toEqual(["Bell Peppers"]);
  });

  it("finds every onboarding chip in a meal that contains it", () => {
    const samples: Record<string, string> = {
      Olives: "kalamata olives",
      Mushrooms: "cremini mushroom",
      Broccoli: "broccoli florets",
      Cilantro: "fresh coriander",
      "Bell Peppers": "red bell pepper",
      Onions: "red onion",
      Tomatoes: "cherry tomatoes",
      "Spicy Food": "chili flakes",
      Tofu: "firm tofu",
      Eggplant: "aubergine",
      Spinach: "baby spinach",
      Avocado: "avocado",
      Artichoke: "artichoke hearts",
    };
    for (const chip of ONBOARDING_DISLIKES) {
      const meal = { name: "Test bowl", ingredients: [[samples[chip], "50 g"]] };
      expect(findMealDislikes(meal, [chip])).toEqual([chip]);
    }
  });

  it("does not over-match oils and unrelated words", () => {
    const salad = {
      name: "Greek Salad",
      ingredients: [["olive oil", "1 tbsp"], ["avocado oil", "1 tsp"], ["black pepper", "1 g"]],
    };
    expect(findMealDislikes(salad, ["Olives", "Avocado", "Bell Peppers"])).toEqual([]);
  });

  it("only matches whole words", () => {
    // "pea" is not in "peanut", "egg" is not in "eggplant".
    expect(findDislikesInText("peanut butter toast", ["Peas"])).toEqual([]);
    expect(findDislikesInText("roasted eggplant", ["Eggs"])).toEqual([]);
  });

  it("does not join words across separate ingredients", () => {
    expect(findDislikesInText("bell | pepper", ["Bell Peppers"])).toEqual([]);
  });

  it("checks the dish name and library labels too", () => {
    expect(findMealDislikes({ name: "Mushroom Risotto", ingredients: [] }, ["Mushrooms"])).toEqual(["Mushrooms"]);
    expect(
      findMealDislikes({ name: "Stir fry", ingredients: [], labels: { ingredientNames: ["tofu"] } }, ["Tofu"]),
    ).toEqual(["Tofu"]);
  });

  it("ignores blank dislikes", () => {
    expect(findDislikesInText("anything", ["", "  "])).toEqual([]);
  });
});

describe("findPlanDislikes", () => {
  const day = (meals: any) => ({ date: "2026-10-17", meals });

  it("reports meals that contain a dislike", () => {
    const violations = findPlanDislikes(
      [day({ breakfast: { name: "Veggie Omelette", ingredients: [["mushroom", "55 g"]] }, snacks: [] })],
      ["Mushrooms"],
    );
    expect(violations).toEqual([
      { date: "2026-10-17", mealType: "breakfast", mealName: "Veggie Omelette", matched: ["Mushrooms"] },
    ]);
  });

  it("exempts the user's own dishes", () => {
    const violations = findPlanDislikes(
      [
        day({
          lunch: { name: "Mum's onion soup", ingredients: [["onion", "200 g"]], fromRepertoire: "dish1" },
          snacks: [{ name: "Salsa", ingredients: [["onion", "10 g"]] }],
        }),
      ],
      ["Onions"],
    );
    expect(violations.map((v) => v.mealType)).toEqual(["snack[0]"]);
  });
});
