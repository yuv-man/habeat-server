import {
  resolveDietaryConstraints,
  buildDietaryConstraintBlock,
  findMealViolations,
  findPlanViolations,
  DEFAULT_PROTEIN_ROTATION,
} from "../../../src/utils/dietary-constraints";

const meal = (name: string, ingredients: string[] = []) => ({ name, ingredients });

describe("resolveDietaryConstraints", () => {
  it("returns no constraints for an unrestricted user", () => {
    const c = resolveDietaryConstraints({});
    expect(c.hasConstraints).toBe(false);
    expect(c.proteinRotation).toEqual(DEFAULT_PROTEIN_ROTATION);
  });

  it("never suggests an animal protein for a vegan user", () => {
    const c = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });

    expect(c.rules.map((r) => r.id)).toContain("vegan");
    expect(c.proteinRotation.length).toBeGreaterThan(0);
    for (const protein of c.proteinRotation) {
      expect(findMealViolations(meal(protein), c)).toEqual([]);
    }
    expect(c.proteinRotation).not.toContain("Chicken");
    expect(c.proteinRotation).not.toContain("Beef");
    expect(c.proteinRotation).not.toContain("Eggs");
  });

  it("matches restriction values case-insensitively and with variants", () => {
    expect(resolveDietaryConstraints({ dietaryRestrictions: ["Vegan"] }).rules).toHaveLength(1);
    expect(resolveDietaryConstraints({ dietaryRestrictions: ["Plant-Based"] }).rules).toHaveLength(1);
    expect(resolveDietaryConstraints({ dietaryRestrictions: ["Gluten-Free"] }).rules).toHaveLength(1);
  });

  it("intersects protein rotations across combined restrictions", () => {
    const c = resolveDietaryConstraints({
      dietaryRestrictions: ["vegetarian", "dairy-free"],
    });
    for (const protein of c.proteinRotation) {
      expect(findMealViolations(meal(protein), c)).toEqual([]);
    }
    expect(c.proteinRotation).not.toContain("Greek yogurt");
    expect(c.proteinRotation).not.toContain("Cottage cheese");
  });

  it("drops seitan for a gluten-free vegan", () => {
    const c = resolveDietaryConstraints({
      dietaryRestrictions: ["vegan", "gluten free"],
    });
    expect(c.proteinRotation).not.toContain("Seitan");
    expect(c.proteinRotation.length).toBeGreaterThan(0);
  });

  it("enforces allergies as forbidden keywords, matching singular and plural", () => {
    const c = resolveDietaryConstraints({ allergies: ["peanuts"] });
    expect(c.hasConstraints).toBe(true);
    expect(findMealViolations(meal("Peanut noodles"), c)).toContain("peanut");
    expect(findMealViolations(meal("Salad", ["peanuts|20|g|Pantry"]), c)).toContain("peanut");
  });

  it("enforces unrecognised restriction strings verbatim", () => {
    const c = resolveDietaryConstraints({ dietaryRestrictions: ["no cilantro"] });
    expect(c.forbiddenKeywords).toContain("cilantro");
    expect(findMealViolations(meal("Salsa", ["cilantro|10|g|Spices"]), c)).toContain("cilantro");
  });
});

describe("findMealViolations", () => {
  const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });

  it("catches meat in the meal name", () => {
    expect(findMealViolations(meal("Beef Stir-Fry with Rice"), vegan)).toContain("beef");
  });

  it("catches meat hidden in the ingredient list", () => {
    const violations = findMealViolations(
      meal("Protein Bowl", ["quinoa|100|g|Grains", "chicken_breast|150|g|Proteins"]),
      vegan,
    );
    expect(violations).toContain("chicken");
  });

  it("catches dairy and eggs for a vegan", () => {
    expect(findMealViolations(meal("Scrambled Eggs with Toast"), vegan)).toContain("egg");
    expect(findMealViolations(meal("Mac and Cheese"), vegan)).toContain("cheese");
  });

  it("accepts a compliant vegan meal", () => {
    expect(
      findMealViolations(
        meal("Chickpea Curry with Rice", [
          "chickpeas|150|g|Proteins",
          "rice|100|g|Grains",
          "coconut_milk|100|ml|Pantry",
        ]),
        vegan,
      ),
    ).toEqual([]);
  });

  it("does not false-positive on plant alternatives", () => {
    expect(findMealViolations(meal("Oatmeal with almond milk"), vegan)).toEqual([]);
    expect(findMealViolations(meal("Toast with peanut butter"), vegan)).toEqual([]);
    expect(findMealViolations(meal("Coconut yogurt with berries"), vegan)).toEqual([]);
    expect(findMealViolations(meal("Vegan bacon sandwich"), vegan)).toEqual([]);
  });

  it("does not false-positive on plant-analogue dish names", () => {
    // Real generator output that used to be rejected, sending a compliant plan
    // into the repair loop and burning free-tier quota to regenerate it.
    expect(findMealViolations(meal("Black Pepper Tofu Steaks"), vegan)).toEqual([]);
    expect(findMealViolations(meal(`Tofu "Chicken" Salad Sandwich`), vegan)).toEqual([]);
    expect(findMealViolations(meal("Chickpea 'Tuna' Salad"), vegan)).toEqual([]);
    expect(findMealViolations(meal("Seitan Sausage with Potatoes"), vegan)).toEqual([]);
  });

  it("stays conservative when the plant base is not adjacent to the keyword", () => {
    // "Jackfruit Pulled Pork" is genuinely vegan, but the exemption only fires
    // when the plant word directly qualifies the keyword. Widening it far enough
    // to catch this would also exempt "Tofu and Chicken Stir-fry". A false
    // positive costs one regeneration; a false negative serves a vegan meat —
    // so this deliberately errs towards flagging.
    expect(findMealViolations(meal("Jackfruit Pulled Pork Buns"), vegan)).toContain("pork");
  });

  it("still catches real animal products next to a plant ingredient", () => {
    // The analogue exemption must only apply when the plant word directly
    // qualifies the keyword — not merely because it appears in the same dish.
    expect(findMealViolations(meal("Tofu and Chicken Stir-fry"), vegan)).toContain("chicken");
    expect(findMealViolations(meal("Lentil Soup with Bacon"), vegan)).toContain("bacon");
    expect(
      findMealViolations({ name: "Mushroom Risotto", ingredients: ["beef_broth|200|ml|Pantry"] }, vegan),
    ).toContain("beef");
    expect(
      findMealViolations({ name: "Chickpea Curry", ingredients: ["butter|20|g|Dairy"] }, vegan),
    ).toContain("butter");
  });

  it("catches the library meals that were substituted into a vegan plan", () => {
    // These are real rows from the `meals` collection that were served to a
    // vegan user, because library matching only ever filtered on allergies.
    const served = [
      "Sirloin Steak And Broccoli Scramble Quick To Prepare, Under 15 Minutes",
      "Lemon Herb Roasted Chicken Salad with Quinoa",
      "Baked Chicken Leg With Rosemary Potatoes And Steamed Broccoli",
      "Salmon Puttanesca Pasta Salad",
      "Miso-glazed Noodles With Shrimp And Broccoli",
      "Garlic Herb Broccoli With Sirloin And Sunny Side Up Eggs",
    ];
    for (const name of served) {
      expect(findMealViolations(meal(name), vegan).length).toBeGreaterThan(0);
    }
  });

  it("does not false-positive on eggplant for an egg restriction", () => {
    const eggFree = resolveDietaryConstraints({ dietaryRestrictions: ["egg-free"] });
    expect(findMealViolations(meal("Roasted Eggplant with Tahini"), eggFree)).toEqual([]);
    expect(findMealViolations(meal("Egg Salad"), eggFree)).toContain("egg");
  });

  it("allows fish for a pescatarian but not beef", () => {
    const pesc = resolveDietaryConstraints({ dietaryRestrictions: ["pescatarian"] });
    expect(findMealViolations(meal("Grilled Salmon with Rice"), pesc)).toEqual([]);
    expect(findMealViolations(meal("Beef Tacos"), pesc)).toContain("beef");
  });

  it("blocks pork and alcohol for halal but allows chicken", () => {
    const halal = resolveDietaryConstraints({ dietaryRestrictions: ["halal"] });
    expect(findMealViolations(meal("Grilled Chicken with Rice"), halal)).toEqual([]);
    expect(findMealViolations(meal("Bacon and Eggs"), halal)).toContain("bacon");
  });

  it("returns nothing when the user has no constraints", () => {
    const none = resolveDietaryConstraints({});
    expect(findMealViolations(meal("Beef Stir-Fry"), none)).toEqual([]);
  });
});

describe("findPlanViolations", () => {
  const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["vegan"] });

  const day = (date: string, dinnerName: string) => ({
    date,
    day: "monday",
    meals: {
      breakfast: meal("Oatmeal with banana", ["oats|60|g|Grains"]),
      lunch: meal("Lentil soup", ["lentils|100|g|Proteins"]),
      dinner: meal(dinnerName),
      snacks: [meal("Apple slices")],
    },
  });

  it("reports the offending day, slot and keyword", () => {
    const violations = findPlanViolations(
      [day("2026-07-29", "Chickpea Curry"), day("2026-07-30", "Beef Stir-Fry")],
      vegan,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].date).toBe("2026-07-30");
    expect(violations[0].mealType).toBe("dinner");
    expect(violations[0].matched).toContain("beef");
  });

  it("scans snacks too", () => {
    const d: any = day("2026-07-29", "Chickpea Curry");
    d.meals.snacks = [meal("Beef jerky")];
    expect(findPlanViolations([d], vegan).map((v) => v.mealType)).toEqual(["snack[0]"]);
  });

  it("passes a fully compliant week", () => {
    expect(findPlanViolations([day("2026-07-29", "Tofu Stir-Fry")], vegan)).toEqual([]);
  });
});

describe("buildDietaryConstraintBlock", () => {
  it("is empty for an unrestricted user", () => {
    expect(buildDietaryConstraintBlock(resolveDietaryConstraints({}))).toBe("");
  });

  it("states the rule, the forbidden list and the allowed proteins", () => {
    const block = buildDietaryConstraintBlock(
      resolveDietaryConstraints({ dietaryRestrictions: ["vegan"], allergies: ["peanuts"] }),
    );

    expect(block).toContain("NON-NEGOTIABLE");
    expect(block).toContain("VEGAN");
    expect(block).toContain("ALLERGIES");
    expect(block).toContain("peanuts");
    expect(block).toContain("ONLY use these proteins:");
    expect(block).toContain("Tofu");
  });
});
