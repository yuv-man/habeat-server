import {
  injectLibraryMeals,
  LibraryMeal,
  libraryMealFits,
  libraryMealToRaw,
  outlineForModel,
  pickLibraryMeals,
  slotKey,
} from "../../../src/generator/library-picks";
import { computeMealLabels } from "../../../src/meal/meal-labels";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";
import { PlannedDay } from "../../../src/generator/meal-plan-prompt";

const lib = (id: string, name: string, category: LibraryMeal["category"], calories: number, ingredients: string[][]): LibraryMeal => {
  const macros = { protein: Math.round((calories * 0.3) / 4), carbs: Math.round((calories * 0.4) / 4), fat: Math.round((calories * 0.3) / 9) };
  return {
    _id: id,
    name,
    category,
    calories,
    macros,
    ingredients,
    prepTime: 20,
    labels: computeMealLabels({ name, calories, macros, ingredients, prepTime: 20 }),
  };
};

const day = (date: string, meals: [string, number, string?][]): PlannedDay => ({
  dateStr: date,
  dayName: "x",
  hasWorkout: false,
  meals: meals.map(([slot, calories, protein]) => ({
    slot: slot as any,
    archetype: "bowl",
    protein: protein ?? "chicken",
    flavour: "",
    calories,
  })),
});

const none = resolveDietaryConstraints({});
const library = [
  lib("1", "Chicken rice bowl", "lunch", 800, [["chicken breast", "150 g", "Proteins"], ["rice", "100 g", "Grains"]]),
  lib("2", "Beef chilli", "dinner", 750, [["ground beef", "150 g", "Proteins"], ["kidney beans", "100 g", "Proteins"]]),
  lib("3", "Salmon traybake", "dinner", 700, [["salmon", "150 g", "Proteins"], ["potato", "200 g", "Vegetables"]]),
  lib("4", "Oat porridge", "breakfast", 500, [["oats", "60 g", "Grains"], ["milk", "250 ml", "Dairy"]]),
];
const week = [
  day("2026-09-21", [["breakfast", 500], ["lunch", 800], ["dinner", 740]]),
  day("2026-09-22", [["breakfast", 500], ["lunch", 800], ["dinner", 740]]),
];

describe("libraryMealFits", () => {
  it("refuses what the user's restrictions rule out, whatever else fits", () => {
    const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });
    expect(libraryMealFits(library[0], "lunch", 800, { constraints: vegan })).toBe("breaks a dietary constraint");
    expect(libraryMealFits(library[0], "lunch", 800, { constraints: none })).toBeNull();
  });

  it("refuses dislikes, the wrong slot, and calories too far off", () => {
    expect(libraryMealFits(library[2], "dinner", 700, { constraints: none, dislikes: ["salmon"] })).toBe("contains a dislike");
    expect(libraryMealFits(library[0], "dinner", 800, { constraints: none })).toBe("wrong slot");
    expect(libraryMealFits(library[0], "lunch", 400, { constraints: none })).toBe("calories too far from the slot");
  });

  it("keeps a low-carb path low-carb", () => {
    expect(libraryMealFits(library[0], "lunch", 800, { constraints: none, path: "keto" })).toBe("not low-carb");
  });
});

describe("pickLibraryMeals", () => {
  it("takes only its share of the slots", () => {
    const picks = pickLibraryMeals({ skeleton: week, candidates: library, constraints: none, seed: "s", share: 0.4 });
    expect(picks.size).toBeLessThanOrEqual(Math.floor(6 * 0.4));
    expect(picks.size).toBeGreaterThan(0);
  });

  it("never serves the same library meal twice, or something recently planned", () => {
    const picks = pickLibraryMeals({
      skeleton: week,
      candidates: library,
      constraints: none,
      seed: "s",
      share: 1,
      avoidNames: ["Beef chilli"],
    });
    const names = [...picks.values()].map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Beef chilli");
  });

  it("does not add a library copy of a dish the user cooks themselves", () => {
    const picks = pickLibraryMeals({
      skeleton: week,
      candidates: library,
      constraints: none,
      seed: "s",
      share: 1,
      ownDishes: ["Beef chilli"],
    });
    expect([...picks.values()].map((m) => m.name)).not.toContain("Beef chilli");
  });

  it("leaves a user's own dishes and favourites alone", () => {
    const withFavourite = [day("2026-09-21", [["lunch", 800]])];
    withFavourite[0].meals[0].favourite = "Chicken schnitzel";
    expect(pickLibraryMeals({ skeleton: withFavourite, candidates: library, constraints: none, seed: "s", share: 1 }).size).toBe(0);
  });

  it("picks nothing for a vegan from a meat library, so the model writes those meals", () => {
    const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });
    const picks = pickLibraryMeals({ skeleton: week, candidates: library, constraints: vegan, seed: "s", share: 1 });
    expect(picks.size).toBe(0);
  });
});

describe("outline and injection", () => {
  it("sends the model only what code does not fill", () => {
    const filled = new Set([slotKey("2026-09-21", "breakfast"), slotKey("2026-09-22", "breakfast"), slotKey("2026-09-22", "lunch"), slotKey("2026-09-22", "dinner")]);
    const outline = outlineForModel(week, filled);
    expect(outline).toHaveLength(1);
    expect(outline[0].meals.map((m) => m.slot)).toEqual(["lunch", "dinner"]);
  });

  it("puts library meals into the model's days, in the model's format", () => {
    const days: any[] = [{ date: "2026-09-21", day: "monday", meals: { lunch: { name: "L" } }, workouts: [] }];
    const picks = new Map([
      [slotKey("2026-09-21", "dinner"), library[1]],
      [slotKey("2026-09-22", "breakfast"), library[3]],
    ]);
    injectLibraryMeals(days, picks, new Map([["2026-09-22", "tuesday"]]));

    expect(days.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(days[0].meals.dinner.name).toBe("Beef chilli");
    expect(days[0].meals.lunch.name).toBe("L");
    expect(days[1].meals.breakfast.ingredients[0]).toBe("oats|60|g|Grains");
    expect(libraryMealToRaw(library[3]).fromLibrary).toBe("4");
  });
});
