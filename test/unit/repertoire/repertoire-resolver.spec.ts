import { buildResolverPrompt, validateResolved } from "../../../src/repertoire/repertoire.resolver";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";

const none = resolveDietaryConstraints({});
const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });

/** Chicken soup as someone actually makes it: 420 kcal ≈ 4·35 + 4·30 + 9·16. */
const soup = {
  ingredients: [
    { name: "chicken thigh", amount: "120 g" },
    { name: "carrot", amount: "80 g" },
    { name: "celery", amount: "40 g" },
    { name: "noodles", amount: "50 g" },
  ],
  nutritionPerServing: { calories: 404, protein: 35, carbs: 30, fat: 16 },
  prepMinutes: 45,
  slots: ["lunch", "dinner"],
  leftoversFriendly: true,
};

describe("validateResolved", () => {
  it("keeps a sound description of the dish", () => {
    const r = validateResolved(soup, "Chicken soup", none)!;
    expect(r.ingredients).toHaveLength(4);
    expect(r.slots).toEqual(["lunch", "dinner"]);
    expect(r.leftoversFriendly).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("refuses a name too vague to cook", () => {
    expect(validateResolved({ unknown: true }, "food", none)).toBeNull();
  });

  it("refuses nutrition that does not match its own macros", () => {
    const wrong = { ...soup, nutritionPerServing: { calories: 900, protein: 35, carbs: 30, fat: 16 } };
    expect(validateResolved(wrong, "Chicken soup", none)).toBeNull();
  });

  it("refuses a serving outside what a person eats", () => {
    for (const calories of [20, 4000]) {
      const p = Math.round(calories / 8), c = Math.round(calories / 8), f = Math.round(calories / 18);
      expect(validateResolved(
        { ...soup, nutritionPerServing: { calories, protein: p, carbs: c, fat: f } },
        "Chicken soup", none,
      )).toBeNull();
    }
  });

  it("refuses a bare ingredient list", () => {
    expect(validateResolved({ ...soup, ingredients: [{ name: "chicken", amount: "1" }] }, "x", none)).toBeNull();
  });

  it("reports a dish that breaks the user's own restrictions instead of hiding it", () => {
    // It is still their dish; the service stores it paused rather than planning it.
    const r = validateResolved(soup, "Chicken soup", vegan)!;
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it("falls back to sensible slots", () => {
    expect(validateResolved({ ...soup, slots: ["brunch"] }, "x", none)!.slots).toEqual(["lunch", "dinner"]);
    expect(validateResolved({ ...soup, slots: [] }, "x", none, ["breakfast"])!.slots).toEqual(["breakfast"]);
  });

  it("caps an absurd prep time and defaults a missing one", () => {
    expect(validateResolved({ ...soup, prepMinutes: 9999 }, "x", none)!.prepMinutes).toBe(240);
    expect(validateResolved({ ...soup, prepMinutes: null }, "x", none)!.prepMinutes).toBe(20);
  });
});

describe("buildResolverPrompt", () => {
  it("asks for the dish as they make it, with their restrictions binding", () => {
    const p = buildResolverPrompt("Chicken soup", vegan, ["dinner"]);
    expect(p).toContain("DISH: Chicken soup");
    expect(p).toContain("They eat it as: dinner");
    expect(p).toContain("HARD DIETARY CONSTRAINTS");
    expect(p).toContain("Do not rename it");
  });

  it("stays short when there is nothing to constrain", () => {
    expect(buildResolverPrompt("Shakshuka", none)).toBe("DISH: Shakshuka");
  });
});
