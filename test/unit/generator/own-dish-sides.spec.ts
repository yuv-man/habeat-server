import { attachSide, chooseSide, detachSide, sideOptions } from "../../../src/generator/own-dish-sides";

const shishlik = {
  dishName: "Chicken shishlik skewers",
  ingredientNames: ["boneless skinless chicken thighs", "bell pepper", "red onion", "olive oil"],
  dishCalories: 410,
  slotCalories: 841,
};

describe("chooseSide", () => {
  it("fills a light dish up to its slot with a carb and a vegetable", () => {
    const side = chooseSide(shishlik)!;
    expect(side).not.toBeNull();
    expect(side.ingredients).toHaveLength(2);
    // 410 + side lands near the 841 kcal dinner.
    expect(Math.abs(410 + side.calories - 841)).toBeLessThan(60);
    expect(side.calories).toBe(side.macros.protein * 4 + side.macros.carbs * 4 + side.macros.fat * 9);
  });

  it("gives a dish that already has its carb base vegetables only", () => {
    const side = chooseSide({
      dishName: "Beef burger",
      ingredientNames: ["ground beef", "burger bun", "cheddar"],
      dishCalories: 600,
      slotCalories: 841,
    })!;
    expect(side.ingredients).toHaveLength(1);
    expect(side.name).not.toMatch(/rice|potato|quinoa/i);
  });

  it("does not count a schnitzel's breadcrumbs as a carb base", () => {
    const side = chooseSide({
      dishName: "Chicken schnitzel",
      ingredientNames: ["chicken breast", "all-purpose flour", "egg", "breadcrumbs"],
      dishCalories: 574,
      slotCalories: 981,
    })!;
    expect(side.ingredients).toHaveLength(2);
    expect(Math.abs(574 + side.calories - 981)).toBeLessThan(60);
  });

  it("fills a small gap with vegetables rather than a couple of spoonfuls of rice", () => {
    const side = chooseSide({ ...shishlik, dishCalories: 704 })!;
    expect(side.ingredients).toHaveLength(1);
    expect(side.name).not.toMatch(/rice|potato|quinoa/i);
  });

  it("adds nothing when the dish already fills its slot", () => {
    expect(chooseSide({ ...shishlik, dishCalories: 782 })).toBeNull();
    expect(chooseSide({ ...shishlik, dishCalories: 900 })).toBeNull();
  });

  it("stays a side, not a second main", () => {
    const side = chooseSide({ ...shishlik, dishCalories: 150, slotCalories: 1400 })!;
    const carbGrams = Number(side.ingredients[0][1].replace(" g", ""));
    expect(carbGrams).toBeLessThanOrEqual(250);
  });

  it("keeps clear of what the user avoids", () => {
    for (let i = 0; i < 10; i++) {
      const side = chooseSide({ ...shishlik, seed: `s${i}`, avoid: ["rice", "tomatoes", "potato"] })!;
      expect(side.name).not.toMatch(/rice|potato|israeli/i);
    }
  });

  it("is the same side for the same dish, so a regenerated week does not reshuffle", () => {
    expect(chooseSide(shishlik)).toEqual(chooseSide(shishlik));
  });
});

describe("attachSide", () => {
  it("keeps the dish's name and recipe, and counts the side in the meal's totals", () => {
    const meal = {
      name: "Chicken shishlik skewers",
      calories: 410,
      macros: { protein: 41, carbs: 11, fat: 22 },
      ingredients: [["chicken thighs", "200 g"]],
    };
    const side = chooseSide(shishlik)!;
    attachSide(meal, side);

    expect(meal.name).toBe("Chicken shishlik skewers");
    expect(meal.ingredients[0]).toEqual(["chicken thighs", "200 g"]);
    expect(meal.ingredients).toHaveLength(1 + side.ingredients.length);
    expect(meal.calories).toBe(410 + side.calories);
    expect(meal.macros.carbs).toBe(11 + side.macros.carbs);
    expect((meal as any).side).toEqual(side);
  });
});

describe("sideOptions", () => {
  it("offers the plates that suit the dish, each filling the meal", () => {
    const options = sideOptions(shishlik);
    expect(options.map((o) => o.id)).toEqual([
      "rice+israeli-salad",
      "potatoes+roasted-veg",
      "quinoa+green-salad",
      "bulgur+tahini-salad",
      "sweet-potato+green-beans",
      "couscous+roasted-veg",
      "pita+hummus",
      "israeli-salad",
      "roasted-veg",
      "green-salad",
      "green-beans",
      "tahini-salad",
    ]);
    for (const o of options.filter((x) => x.ingredients.length === 2)) {
      expect(Math.abs(410 + o.calories - 841)).toBeLessThan(80);
    }
  });

  it("offers only vegetables next to a dish with its own carb base", () => {
    const ids = sideOptions({
      dishName: "Beef burger",
      ingredientNames: ["ground beef", "burger bun"],
      dishCalories: 600,
      slotCalories: 841,
    }).map((o) => o.id);
    expect(ids).toEqual(["israeli-salad", "roasted-veg", "green-salad", "green-beans", "tahini-salad"]);
  });

  it("keeps wheat off the plate for someone avoiding gluten", () => {
    const ids = sideOptions({ ...shishlik, avoid: ["gluten-free"] }).map((o) => o.id);
    expect(ids).not.toContain("bulgur+tahini-salad");
    expect(ids).not.toContain("couscous+roasted-veg");
    expect(ids).not.toContain("pita+hummus");
    expect(ids).toContain("rice+israeli-salad");
  });

  it("keeps sesame off the plate for someone allergic to it", () => {
    const ids = sideOptions({ ...shishlik, avoid: ["sesame"] }).map((o) => o.id);
    expect(ids).not.toContain("tahini-salad");
    expect(ids).not.toContain("bulgur+tahini-salad");
    expect(ids).not.toContain("pita+hummus");
  });

  it("serves one pita and a few spoonfuls of hummus, not a sandwich and a bowl", () => {
    const plate = sideOptions({ ...shishlik, dishCalories: 150, slotCalories: 1400 }).find(
      (o) => o.id === "pita+hummus",
    )!;
    expect(plate.ingredients).toEqual([
      ["wholewheat pita", "100 g", "Bakery"],
      ["hummus", "80 g", "Pantry"],
    ]);
  });

  it("puts only everyday sides on the plate by itself — the rest are the user's to choose", () => {
    for (let i = 0; i < 20; i++) {
      const chosen = chooseSide({ ...shishlik, seed: `dish-${i}` })!;
      expect(["rice+israeli-salad", "potatoes+roasted-veg", "quinoa+green-salad"]).toContain(chosen.id);
    }
  });

  it("still offers a real plate when the dish nearly fills its slot", () => {
    const rice = sideOptions({ ...shishlik, dishCalories: 800 }).find((o) => o.id === "rice+israeli-salad")!;
    expect(rice.ingredients[0]).toEqual(["rice", "80 g", "Grains"]);
  });

  it("is what the planner chooses from, so the picker can mark the current side", () => {
    const chosen = chooseSide(shishlik)!;
    expect(sideOptions(shishlik).map((o) => o.id)).toContain(chosen.id);
  });
});

describe("detachSide", () => {
  it("takes the side back off, leaving the dish as it was", () => {
    const meal: any = {
      name: "Chicken shishlik skewers",
      calories: 410,
      macros: { protein: 41, carbs: 11, fat: 22 },
      ingredients: [["chicken thighs", "200 g"]],
    };
    const original = JSON.parse(JSON.stringify(meal));
    attachSide(meal, chooseSide(shishlik)!);
    detachSide(meal);
    expect(meal).toEqual(original);
  });
});
