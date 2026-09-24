import { computeMealLabels, MEAL_LABELS_VERSION } from "../../../src/meal/meal-labels";

const meal = (name: string, ingredients: string[][], macros = { protein: 40, carbs: 30, fat: 15 }) => ({
  name,
  calories: macros.protein * 4 + macros.carbs * 4 + macros.fat * 9,
  macros,
  ingredients,
  prepTime: 25,
});

describe("computeMealLabels", () => {
  it("names the diets a meal fits, by the same rules plans are checked with", () => {
    const tofu = computeMealLabels(meal("Tofu stir-fry", [["tofu", "150 g"], ["rice", "100 g"], ["broccoli", "100 g"]]));
    expect(tofu.fits).toEqual(expect.arrayContaining(["vegan", "vegetarian", "dairy-free", "gluten-free"]));

    const schnitzel = computeMealLabels(
      meal("Chicken schnitzel", [["chicken breast", "150 g"], ["breadcrumbs", "40 g"], ["egg", "1 large"]]),
    );
    expect(schnitzel.fits).not.toContain("vegetarian");
    expect(schnitzel.fits).not.toContain("gluten-free");
    expect(schnitzel.fits).not.toContain("egg-free");
    expect(schnitzel.fits).toContain("pork-free");
  });

  it("finds the main proteins", () => {
    expect(computeMealLabels(meal("Salmon bowl", [["salmon", "150 g"], ["rice", "80 g"]])).proteins).toEqual(["salmon"]);
    expect(computeMealLabels(meal("Shakshuka", [["eggs", "3"], ["tomato", "200 g"]])).proteins).toEqual(["eggs"]);
  });

  it("describes the macro shape", () => {
    const steak = computeMealLabels(meal("Steak and salad", [["sirloin steak", "200 g"], ["lettuce", "80 g"]], { protein: 50, carbs: 8, fat: 22 }));
    expect(steak.highProtein).toBe(true);
    expect(steak.lowCarb).toBe(true);
    expect(steak.keto).toBe(true);
    expect(steak.version).toBe(MEAL_LABELS_VERSION);
  });
});
