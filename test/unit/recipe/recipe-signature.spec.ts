import { recipeSignature } from "../../../src/recipe/recipe-signature";

describe("recipeSignature", () => {
  const schnitzel = {
    name: "Chicken schnitzel",
    ingredients: [["Chicken breast", "150 g"], ["breadcrumbs", "40 g"], ["Egg", "1 large"]],
  };

  it("is the same dish whatever the portion, id or ingredient order", () => {
    const bigger = {
      name: "  chicken  SCHNITZEL ",
      ingredients: [["egg", "2 large"], ["chicken_breast", "300 g", "Proteins"], ["Breadcrumbs", "80 g"]],
    };
    expect(recipeSignature(bigger)).toBe(recipeSignature(schnitzel));
  });

  it("reads the string ingredient format too", () => {
    const piped = { name: "Chicken schnitzel", ingredients: ["chicken_breast|150|g", "breadcrumbs|40|g", "egg|1|piece"] };
    expect(recipeSignature(piped)).toBe(recipeSignature(schnitzel));
  });

  it("tells a different dish, or the same name made differently, apart", () => {
    expect(recipeSignature({ ...schnitzel, name: "Pork schnitzel" })).not.toBe(recipeSignature(schnitzel));
    expect(
      recipeSignature({ ...schnitzel, ingredients: [...schnitzel.ingredients, ["roasted potatoes", "250 g"]] }),
    ).not.toBe(recipeSignature(schnitzel));
  });
});
