import { buildMealOptions, quickPrepLimit } from "../../../src/generator/meal-options";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";

const none = resolveDietaryConstraints({});
const nutrition = { calories: 550, protein: 35, carbs: 50, fat: 18 };

const dish = (name: string, prepMinutes: number, ingredients: string[], slots?: string[]) => ({
  _id: `dish-${name}`,
  name,
  slots,
  usual: {
    prepMinutes,
    nutritionPerServing: nutrition,
    ingredients: ingredients.map((i) => ({ name: i, amount: "100 g" })),
  },
});

const lib = (name: string, prep: number, ingredients: string[], category = "dinner", calories = 600) =>
  ({
    _id: `507f1f77bcf86cd7994390${name.length.toString().padStart(2, "0")}`,
    name,
    category,
    calories,
    macros: { protein: 30, carbs: 50, fat: 20 },
    ingredients: ingredients.map((i) => [i, "100 g", "Other"]),
    prepTime: prep,
    labels: { ingredientNames: ingredients, prepMinutes: prep },
  }) as any;

const base = {
  slot: "dinner" as const,
  current: { name: "Beef Tomato Garlic Tacos", calories: 600, prepTime: 30 },
  constraints: none,
  dislikes: [] as string[],
  avoidNames: [] as string[],
  libraryCandidates: [] as any[],
};

describe("quickPrepLimit", () => {
  it("is about two thirds of the planned time, between 10 and 20 minutes", () => {
    expect(quickPrepLimit(30)).toBe(20);
    expect(quickPrepLimit(15)).toBe(10);
    expect(quickPrepLimit(90)).toBe(20);
    expect(quickPrepLimit(undefined)).toBe(20);
  });
});

describe("buildMealOptions — mine", () => {
  it("offers the user's own dishes that suit the slot, marked as theirs", () => {
    const options = buildMealOptions({
      ...base,
      mode: "mine",
      ownDishes: [
        dish("Chicken and rice", 25, ["chicken", "rice"]),
        dish("Greek yogurt with granola", 2, ["yogurt", "granola"], ["breakfast"]),
      ] as any,
    });
    expect(options.map((o) => o.meal.name)).toEqual(["Chicken and rice"]);
    expect(options[0]).toMatchObject({ source: "own", reason: "Your dish · 25 min" });
    expect(options[0].meal.fromRepertoire).toBe("dish-Chicken and rice");
  });

  it("keeps an own dish that contains a dislike, but not one that breaks an allergy", () => {
    const options = buildMealOptions({
      ...base,
      mode: "mine",
      dislikes: ["Onions"],
      constraints: resolveDietaryConstraints({ allergies: ["Peanuts"] }),
      ownDishes: [dish("Mum's onion soup", 40, ["onion"]), dish("Satay chicken", 20, ["peanut", "chicken"])] as any,
    });
    expect(options.map((o) => o.meal.name)).toEqual(["Mum's onion soup"]);
  });

  it("skips dishes with no nutrition yet and the meal being replaced", () => {
    const options = buildMealOptions({
      ...base,
      mode: "mine",
      current: { name: "Chicken and rice", calories: 600 },
      ownDishes: [dish("Chicken and rice", 25, ["chicken"]), { name: "Brand new dish", usual: {} }] as any,
    });
    expect(options).toEqual([]);
  });
});

describe("buildMealOptions — quicker", () => {
  it("puts the user's quick dishes before library meals, and only quick ones", () => {
    const options = buildMealOptions({
      ...base,
      mode: "quicker",
      ownDishes: [dish("Scrambled eggs on toast", 7, ["egg", "bread"], ["breakfast", "dinner"]), dish("Lasagna", 60, ["pasta"])] as any,
      libraryCandidates: [lib("Speedy Tuna Pasta Toss", 10, ["pasta", "tuna"]), lib("Slow Roast", 90, ["beef"])],
    });
    expect(options.map((o) => [o.meal.name, o.source])).toEqual([
      ["Scrambled eggs on toast", "own"],
      ["Speedy Tuna Pasta Toss", "library"],
    ]);
  });

  it("filters library meals by constraints and dishes the user turned down, and ranks dislikes last", () => {
    const options = buildMealOptions({
      ...base,
      mode: "quicker",
      ownDishes: [],
      dislikes: ["Mushrooms"],
      avoidNames: ["Turned Down Wrap"],
      constraints: resolveDietaryConstraints({ dietaryRestrictions: ["Vegetarian"] }),
      libraryCandidates: [
        lib("Mushroom Toast", 10, ["mushroom", "bread"]),
        lib("Turned Down Wrap", 10, ["tortilla", "beans"]),
        lib("Chicken Wrap", 10, ["chicken", "tortilla"]),
        lib("Bean Quesadilla", 12, ["beans", "tortilla", "cheese"]),
      ],
    });
    expect(options.map((o) => o.meal.name)).toEqual(["Bean Quesadilla", "Mushroom Toast"]);
  });

  it("returns complete meals the swap endpoint can apply as they are", () => {
    const [option] = buildMealOptions({
      ...base,
      mode: "quicker",
      ownDishes: [],
      libraryCandidates: [lib("Speedy Tuna Pasta Toss", 10, ["pasta", "tuna"])],
    });
    expect(option.meal).toMatchObject({
      name: "Speedy Tuna Pasta Toss",
      category: "dinner",
      calories: 600,
      macros: { protein: 30 },
      prepTime: 10,
    });
    expect(Array.isArray(option.meal.ingredients)).toBe(true);
  });

  it("never offers the same dish twice", () => {
    const options = buildMealOptions({
      ...base,
      mode: "quicker",
      ownDishes: [dish("Tuna Pasta", 10, ["pasta", "tuna"])] as any,
      libraryCandidates: [lib("Tuna Pasta", 10, ["pasta", "tuna"])],
    });
    expect(options).toHaveLength(1);
  });
});
