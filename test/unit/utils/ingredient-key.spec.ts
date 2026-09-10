import {
  ingredientKey,
  legacyIngredientKey,
  ingredientKeyCandidates,
} from "../../../src/utils/ingredient-key";

/**
 * The shopping list groups every cart row by this key. Two spellings of one
 * product used to produce two keys — "tomato" and "tomatoes" showed up as two
 * lines — and any non-Latin name produced an empty key, which merged a whole
 * Hebrew list into a single row.
 */
describe("ingredientKey", () => {
  it("merges singular and plural spellings of the same product", () => {
    const pairs: [string, string][] = [
      ["tomato", "tomatoes"],
      ["potato", "potatoes"],
      ["egg", "eggs"],
      ["onion", "onions"],
      ["olive", "olives"],
      ["berry", "berries"],
      ["cherry", "cherries"],
      ["cookie", "cookies"],
      ["bay leaf", "bay leaves"],
      ["chicken breast", "chicken breasts"],
      ["sweet potato", "sweet potatoes"],
      ["glass", "glasses"],
      ["cheese", "cheeses"],
    ];
    for (const [singular, plural] of pairs) {
      expect(ingredientKey(plural)).toBe(ingredientKey(singular));
    }
  });

  it("ignores case, punctuation and spacing", () => {
    expect(ingredientKey("Olive Oil")).toBe(ingredientKey("olive-oil"));
    expect(ingredientKey("  Tomatoes, ")).toBe(ingredientKey("tomato"));
  });

  it("keeps words that only look plural", () => {
    for (const word of ["hummus", "couscous", "asparagus", "grass"]) {
      expect(ingredientKey(word)).toBe(word);
    }
  });

  it("keeps different products apart", () => {
    const keys = [
      "tomato",
      "potato",
      "onion",
      "cucumber",
      "olive oil",
      "canola oil",
    ].map(ingredientKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps non-Latin names distinct instead of emptying them", () => {
    const hebrew = ["עגבניה", "מלפפון", "שמן זית"];
    const keys = hebrew.map(ingredientKey);
    expect(keys.every((key) => key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(hebrew.length);
    // The old key kept nothing outside [a-z0-9_], which is the bug.
    expect(hebrew.map(legacyIngredientKey)).toEqual(["", "", "_"]);
  });

  it("survives empty and punctuation-only input", () => {
    expect(ingredientKey("")).toBe("");
    expect(ingredientKey("   ")).toBe("");
    expect(ingredientKey(undefined as unknown as string)).toBe("");
  });
});

describe("ingredientKeyCandidates", () => {
  it("offers the stored legacy key alongside the current one", () => {
    expect(ingredientKeyCandidates("Tomatoes")).toEqual(
      expect.arrayContaining(["tomato", "tomatoes"])
    );
  });

  it("does not repeat itself when both keys agree", () => {
    expect(ingredientKeyCandidates("milk")).toEqual(["milk"]);
  });
});
