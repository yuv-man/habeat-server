import { preferWithoutDislikes, replaceDislikedMeals } from "../../../src/generator/dislike-enforcement";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";

const none = resolveDietaryConstraints({});

const libraryMeal = (name: string, category: string, calories: number, ingredients: string[]) =>
  ({
    _id: `lib-${name}`,
    name,
    category,
    calories,
    macros: { protein: 20, carbs: 40, fat: 15 },
    ingredients: ingredients.map((i) => [i, "100 g", "Other"]),
    prepTime: 10,
    labels: { ingredientNames: ingredients, prepMinutes: 10 },
  }) as any;

const omelette = { name: "Veggie Omelette", calories: 600, ingredients: ["egg|3|unit|Proteins", "mushroom|55|g|Vegetables"] };
const day = (date: string, breakfast: any) => ({ date, meals: { breakfast, snacks: [] } });

describe("replaceDislikedMeals", () => {
  it("swaps an offending meal for a library meal that fits", () => {
    const days = [day("2026-10-17", omelette)];
    const unresolved = replaceDislikedMeals(
      days,
      ["Mushrooms"],
      [
        libraryMeal("Mushroom Toast", "breakfast", 600, ["mushroom", "bread"]),
        libraryMeal("Greek Yogurt Bowl", "breakfast", 580, ["greek yogurt", "granola"]),
      ],
      { constraints: none },
    );
    expect(unresolved).toEqual([]);
    expect(days[0].meals.breakfast.name).toBe("Greek Yogurt Bowl");
  });

  it("keeps the user's own dish even when it contains a dislike", () => {
    const own = { ...omelette, fromRepertoire: "dish1" };
    const days = [day("2026-10-17", own)];
    replaceDislikedMeals(days, ["Mushrooms"], [libraryMeal("Greek Yogurt Bowl", "breakfast", 580, ["yogurt"])], {
      constraints: none,
    });
    expect(days[0].meals.breakfast).toBe(own);
  });

  it("reports what it could not replace and leaves the meal in place", () => {
    const days = [day("2026-10-17", omelette)];
    const unresolved = replaceDislikedMeals(days, ["Mushrooms"], [], { constraints: none });
    expect(unresolved).toHaveLength(1);
    expect(days[0].meals.breakfast).toBe(omelette);
  });
});

describe("preferWithoutDislikes", () => {
  it("does nothing when there is nothing to fix", () => {
    const days = [day("2026-10-17", { name: "Toast", calories: 300, ingredients: ["bread|2|slice|Grains"] })];
    expect(preferWithoutDislikes({ days, dislikes: ["Mushrooms"], constraints: none, context: "t" })).toBe(days);
  });

  it("swaps a disliked meal for a library meal that fits", () => {
    const result = preferWithoutDislikes({
      days: [day("2026-10-17", omelette)],
      dislikes: ["Mushrooms"],
      constraints: none,
      context: "t",
      candidates: [libraryMeal("Greek Yogurt Bowl", "breakfast", 580, ["greek yogurt"])],
    });
    expect(result[0].meals.breakfast.name).toBe("Greek Yogurt Bowl");
  });

  it("keeps the meal when nothing fits — a dislike is a preference", () => {
    const result = preferWithoutDislikes({
      days: [day("2026-10-17", omelette)],
      dislikes: ["Mushrooms"],
      constraints: none,
      context: "t",
      candidates: [],
    });
    expect(result[0].meals.breakfast).toBe(omelette);
  });
});
