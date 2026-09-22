import {
  DISHES_WITH_IMAGES,
  dishArtFor,
  dishIconFor,
  dishImageFor,
  dishSlug,
} from "../../../src/repertoire/dish-images";

describe("dishSlug", () => {
  it("makes a file name out of a dish name", () => {
    expect(dishSlug("Pasta with tomato sauce")).toBe("pasta-with-tomato-sauce");
    expect(dishSlug("Pizza (homemade)")).toBe("pizza");
    expect(dishSlug("  Grilled   cheese!  ")).toBe("grilled-cheese");
  });
});

describe("dishImageFor", () => {
  it("has a picture for every dish onboarding offers", () => {
    for (const dish of DISHES_WITH_IMAGES) expect(dishImageFor(dish)).toBeDefined();
  });

  it("recognises the user's own wording of a stocked dish", () => {
    // Typed at onboarding as their own version of "Vegetable soup".
    expect(dishImageFor("Vegetable soup with lentils")).toBe("/images/dishes/vegetable-soup.webp");
    expect(dishImageFor("Tuna sandwich on rye")).toBe("/images/dishes/tuna-sandwich.webp");
  });

  it("prefers the most specific picture it has", () => {
    expect(dishImageFor("Lentil soup, mum's recipe")).toBe("/images/dishes/lentil-soup.webp");
  });

  it("has nothing for a dish we do not stock, rather than something wrong", () => {
    expect(dishImageFor("Mum's chicken soup with kneidlach")).toBeUndefined();
    expect(dishImageFor("")).toBeUndefined();
  });
});

describe("dishIconFor", () => {
  it("reads the dish, not just the first food word", () => {
    expect(dishIconFor("Chicken soup")).toBe("🍲"); // soup, not chicken
    expect(dishIconFor("Burrata with tomatoes and olive oil")).toBe("🧀");
    expect(dishIconFor("Shakshuka")).toBe("🍳");
    expect(dishIconFor("Pasta with tomato and basil")).toBe("🍝");
  });

  it("always gives something, however odd the name", () => {
    expect(dishIconFor("asdfgh")).toBe("🍽️");
    expect(dishIconFor("")).toBe("🍽️");
  });
});

describe("dishArtFor", () => {
  it("returns an icon always and a picture when there is one", () => {
    expect(dishArtFor("Shakshuka")).toEqual({
      imageUrl: "/images/dishes/shakshuka.webp",
      icon: "🍳",
    });
    expect(dishArtFor("Mum's chicken soup")).toEqual({ icon: "🍲" });
  });
});
