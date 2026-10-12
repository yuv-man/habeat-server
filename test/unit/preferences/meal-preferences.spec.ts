import {
  learnedPreferencesSection,
  resolveMealPreferences,
} from "../../../src/preferences/meal-preferences";
import { buildMenuSkeleton, buildWeeklyPlanPrompt, DaySpec } from "../../../src/generator/meal-plan-prompt";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";
import { screenProposedAction } from "../../../src/chat/action-screen";
import { findPlanDislikes } from "../../../src/utils/ingredient-match";
import { libraryMealFits } from "../../../src/generator/library-picks";

const profile = (p: any) => ({ mealLearningProfile: p });

describe("resolveMealPreferences", () => {
  it("counts a dish eaten twice as enjoyed, not one eaten once", () => {
    const prefs = resolveMealPreferences(
      profile({ completedMeals: [{ name: "Chicken and Rice", count: 2 }, { name: "Plan Salad", count: 1 }] }),
    );
    expect(prefs.enjoyed).toEqual([{ name: "Chicken and Rice", evidence: "eaten 2×" }]);
  });

  it("counts a dish chosen as a replacement and then eaten", () => {
    const prefs = resolveMealPreferences(
      profile({
        completedMeals: [{ name: "Egg Toast", count: 1 }],
        selectedMeals: [{ name: "Egg Toast", count: 1 }],
      }),
    );
    expect(prefs.enjoyed).toEqual([{ name: "Egg Toast", evidence: "chosen 1×, eaten 1×" }]);
  });

  it("does not count a choice that was never eaten", () => {
    const prefs = resolveMealPreferences(profile({ selectedMeals: [{ name: "Egg Toast", count: 3 }] }));
    expect(prefs.enjoyed).toEqual([]);
  });

  it("lets explicit preferences overrule what was learned", () => {
    const prefs = resolveMealPreferences({
      dislikes: ["Mushrooms"],
      allergies: ["Peanuts"],
      mealLearningProfile: {
        completedMeals: [
          { name: "Mushroom Risotto", count: 4 },
          { name: "Peanut Noodles", count: 4 },
          { name: "Tacos", count: 3 },
          { name: "Chicken and Rice", count: 2 },
        ],
        swappedMeals: [{ name: "Tacos", count: 1, dislikes: 1, unexplained: 0 }],
      },
    });
    expect(prefs.enjoyed.map((e) => e.name)).toEqual(["Chicken and Rice"]);
    expect(prefs.avoidNames).toEqual(["Tacos"]);
  });

  it("orders enjoyed dishes by evidence and keeps the list short", () => {
    const completedMeals = Array.from({ length: 10 }, (_, i) => ({ name: `Dish ${i}`, count: 2 + i }));
    const prefs = resolveMealPreferences(profile({ completedMeals }));
    expect(prefs.enjoyed).toHaveLength(6);
    expect(prefs.enjoyed[0].name).toBe("Dish 9");
  });
});

describe("learnedPreferencesSection", () => {
  it("is empty for a new user, so their prompt doesn't change", () => {
    expect(learnedPreferencesSection(resolveMealPreferences({}))).toBe("");
  });

  it("names enjoyed and turned-down dishes, and asks for variety", () => {
    const text = learnedPreferencesSection(
      resolveMealPreferences(
        profile({
          completedMeals: [{ name: "Chicken and Rice", count: 3 }],
          swappedMeals: [{ name: "Liver", count: 1, dislikes: 1, unexplained: 0 }],
        }),
      ),
    );
    expect(text).toContain("Chicken and Rice — eaten 3×");
    expect(text).toContain("keep variety");
    expect(text).toContain("do not serve these: Liver");
  });
});

describe("the weekly planner uses what was learned", () => {
  // Completed meals used to be recorded and never sent to the generator.
  const days: DaySpec[] = [{ dateStr: "2026-10-12", dayName: "monday", hasWorkout: false }];
  const none = resolveDietaryConstraints({});

  it("puts positive signals in the generation prompt", () => {
    const prompt = buildWeeklyPlanPrompt({
      userData: {
        age: 34,
        path: "healthy",
        mealLearningProfile: { completedMeals: [{ name: "Chicken and Rice", count: 3 }] },
      },
      constraints: none,
      targetCalories: 2000,
      macros: { protein: 120, carbs: 230, fat: 70 },
      skeleton: buildMenuSkeleton(days, none, 2000, "seed"),
    });
    expect(prompt).toContain("LEARNED FROM THIS USER'S OWN CHOICES");
    expect(prompt).toContain("Chicken and Rice");
  });
});

describe("planner and assistant agree on explicit preferences", () => {
  const user = { dislikes: ["Bell Peppers"], allergies: ["Shellfish"] };
  const prefs = resolveMealPreferences(user);
  const meals = [
    { name: "Stuffed Peppers", ingredients: [["bell pepper", "200 g"]] },
    { name: "Shrimp Tacos", ingredients: [["shrimp", "150 g"]] },
    { name: "Chicken Rice Bowl", ingredients: [["chicken", "150 g"], ["rice", "100 g"]] },
  ];

  it("flags the same meals in a plan, the library and a chat proposal", () => {
    for (const meal of meals) {
      const inPlan =
        findPlanDislikes([{ date: "d", meals: { dinner: meal } }], prefs.dislikes).length > 0 ||
        require("../../../src/utils/dietary-constraints").findMealViolations(meal, prefs.constraints).length > 0;
      const inLibrary =
        libraryMealFits(
          { _id: "x", name: meal.name, category: "dinner", calories: 600, macros: { protein: 30, carbs: 50, fat: 20 }, ingredients: meal.ingredients, labels: { ingredientNames: meal.ingredients.map((i) => i[0]) } } as any,
          "dinner",
          600,
          { constraints: prefs.constraints, dislikes: prefs.dislikes },
        ) !== null;
      // Chat removes an allergen and flags a dislike; either way it noticed.
      const screened = screenProposedAction(
        "Try it",
        { type: "meal_swap", status: "pending", payload: { proposedMeal: meal } } as any,
        user,
      );
      const inChat = screened.action === undefined || !!screened.disliked?.length;
      expect({ meal: meal.name, inPlan, inLibrary, inChat }).toEqual({
        meal: meal.name,
        inPlan: meal.name !== "Chicken Rice Bowl",
        inLibrary: meal.name !== "Chicken Rice Bowl",
        inChat: meal.name !== "Chicken Rice Bowl",
      });
    }
  });
});
