import { recentMealsToExclude } from "../../../src/generator/recent-meals";

const plan = {
  "2026-09-14": {
    meals: {
      breakfast: { name: "Shakshuka" },
      lunch: { name: "Chicken Salad" },
      dinner: { name: "Pad Thai" },
      snacks: [{ name: "Apple and Almonds" }],
    },
  },
  "2026-09-15": {
    meals: {
      breakfast: { name: "Overnight Oats" },
      lunch: { name: "Lentil Soup" },
      dinner: { name: "Salmon with Rice" },
      snacks: [],
    },
  },
};

describe("recentMealsToExclude", () => {
  it("excludes every dish when nothing was eaten", () => {
    expect(recentMealsToExclude(plan, [])).toEqual([
      "Shakshuka",
      "Chicken Salad",
      "Pad Thai",
      "Apple and Almonds",
      "Overnight Oats",
      "Lentil Soup",
      "Salmon with Rice",
    ]);
  });

  it("lets dishes the user ate come back next week", () => {
    const progress = [
      {
        meals: {
          breakfast: { name: "Shakshuka", done: true, source: "cooked" },
          // Ticked without being asked where it came from — it was their plan
          // meal, so it counts as eaten at home.
          lunch: { name: "Chicken Salad", done: true },
          dinner: { name: "Pad Thai", done: false },
        },
      },
    ];
    const excluded = recentMealsToExclude(plan, progress);
    expect(excluded).not.toContain("Shakshuka");
    expect(excluded).not.toContain("Chicken Salad");
    expect(excluded).toContain("Pad Thai");
  });

  it("keeps a dish excluded when it was ordered or eaten out", () => {
    const progress = [
      {
        meals: {
          dinner: { name: "Pad Thai", done: true, source: "ordered" },
          snacks: [{ name: "Apple and Almonds", done: true, source: "eaten-out" }],
        },
      },
    ];
    const excluded = recentMealsToExclude(plan, progress);
    expect(excluded).toContain("Pad Thai");
    expect(excluded).toContain("Apple and Almonds");
  });

  it("matches eaten dishes regardless of case and whitespace", () => {
    const progress = [{ meals: { dinner: { name: "  salmon with rice ", done: true } } }];
    expect(recentMealsToExclude(plan, progress)).not.toContain("Salmon with Rice");
  });

  it("handles a missing plan and caps the list", () => {
    expect(recentMealsToExclude(null, [])).toEqual([]);
    expect(recentMealsToExclude(plan, [], 3)).toHaveLength(3);
  });
});
