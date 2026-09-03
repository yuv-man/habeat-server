import {
  buildMenuSkeleton,
  buildWeeklyPlanPrompt,
  planSeed,
  SLOT_CALORIE_SHARE,
  DaySpec,
} from "../../../src/generator/meal-plan-prompt";
import { resolveDietaryConstraints } from "../../../src/utils/dietary-constraints";

const DAYS: DaySpec[] = [
  { dateStr: "2026-08-03", dayName: "monday", hasWorkout: true },
  { dateStr: "2026-08-04", dayName: "tuesday", hasWorkout: false },
  { dateStr: "2026-08-05", dayName: "wednesday", hasWorkout: true },
  { dateStr: "2026-08-06", dayName: "thursday", hasWorkout: false },
  { dateStr: "2026-08-07", dayName: "friday", hasWorkout: true },
  { dateStr: "2026-08-08", dayName: "saturday", hasWorkout: false },
  { dateStr: "2026-08-09", dayName: "sunday", hasWorkout: false },
];

const none = resolveDietaryConstraints({});
const vegan = resolveDietaryConstraints({ dietaryRestrictions: ["Vegan"] });
const glutenFree = resolveDietaryConstraints({ dietaryRestrictions: ["Gluten-free"] });

describe("buildMenuSkeleton", () => {
  it("plans four slots for every day", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed");
    expect(week).toHaveLength(7);
    for (const day of week) {
      expect(day.meals.map((m) => m.slot)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    }
  });

  it("splits the calorie budget across slots", () => {
    const [day] = buildMenuSkeleton(DAYS, none, 2000, "seed");
    expect(day.meals.find((m) => m.slot === "breakfast")!.calories).toBe(2000 * SLOT_CALORIE_SHARE.breakfast);
    const total = day.meals.reduce((s, m) => s + m.calories, 0);
    expect(total).toBe(2000);
  });

  it("is deterministic for a given seed", () => {
    const a = buildMenuSkeleton(DAYS, none, 2000, "user-1:2026-08-03");
    const b = buildMenuSkeleton(DAYS, none, 2000, "user-1:2026-08-03");
    expect(a).toEqual(b);
  });

  it("produces a different rotation the following week", () => {
    // The old generator indexed the rotation by day number alone, so a user got
    // the same assignment every week. This is the regression guard for that.
    const w1 = buildMenuSkeleton(DAYS, none, 2000, planSeed("user-1", "2026-08-03"));
    const w2 = buildMenuSkeleton(DAYS, none, 2000, planSeed("user-1", "2026-08-10"));

    const sig = (week: typeof w1) =>
      week.flatMap((d) => d.meals.map((m) => `${m.archetype}|${m.protein}|${m.flavour}`));

    expect(sig(w1)).not.toEqual(sig(w2));
  });

  it("gives two different users different plans in the same week", () => {
    const a = buildMenuSkeleton(DAYS, none, 2000, planSeed("user-1", "2026-08-03"));
    const b = buildMenuSkeleton(DAYS, none, 2000, planSeed("user-2", "2026-08-03"));
    expect(a).not.toEqual(b);
  });

  it("never repeats an archetype within a slot until the list is exhausted", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const dinners = week.map((d) => d.meals.find((m) => m.slot === "dinner")!.archetype);
    // 10 dinner archetypes, 7 days — every day should be a distinct form.
    expect(new Set(dinners).size).toBe(dinners.length);
  });

  it("keeps breakfast proteins out of the dinner rotation", () => {
    // "Beef and Tomato Scramble" came from reusing one protein list everywhere.
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const breakfastProteins = week.map((d) => d.meals.find((m) => m.slot === "breakfast")!.protein);
    const dinnerOnly = ["Beef", "Ground beef", "Turkey", "Chicken"];
    expect(breakfastProteins.filter((p) => dinnerOnly.includes(p))).toEqual([]);
  });

  it("only seasons lunch and dinner", () => {
    // A flavour brief on every meal pushed the model into stacking each field
    // into the dish name ("Chilli Lime Roasted Peach Oats").
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed");
    for (const day of week) {
      for (const meal of day.meals) {
        if (meal.slot === "lunch" || meal.slot === "dinner") {
          expect(meal.flavour).not.toBe("");
        } else {
          expect(meal.flavour).toBe("");
        }
      }
    }
  });

  it("only assigns plant proteins for a vegan", () => {
    const week = buildMenuSkeleton(DAYS, vegan, 2000, "seed");
    const animal = ["Chicken", "Beef", "Eggs", "Greek yogurt", "Cottage cheese", "Salmon", "Smoked salmon", "Milk", "Cheese"];
    const assigned = week.flatMap((d) => d.meals.map((m) => m.protein));
    expect(assigned.filter((p) => animal.includes(p))).toEqual([]);
  });

  it("never assigns a disliked food as a meal's main protein", () => {
    // Real record: a vegan who dislikes tofu was getting Tofu as their most
    // frequent protein, because the rotation was only filtered against hard
    // restrictions and dislikes were left as a soft hint to the model.
    const week = buildMenuSkeleton(DAYS, vegan, 2000, "seed", ["Tofu", "Onion"]);
    const proteins = week.flatMap((d) => d.meals.map((m) => m.protein.toLowerCase()));
    expect(proteins).not.toContain("tofu");
  });

  it("still produces a plan when dislikes would empty the rotation", () => {
    // Some plan beats no plan; the constraint block still keeps it safe to eat.
    const all = ["Tofu", "Lentils", "Chickpeas", "Black beans", "Tempeh", "Edamame", "Seitan"];
    const week = buildMenuSkeleton(DAYS, vegan, 2000, "seed", all);
    for (const day of week) {
      for (const meal of day.meals) expect(meal.protein).toBeTruthy();
    }
  });

  it("matches dislikes case-insensitively and as substrings", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", ["chicken", "BEEF"]);
    const proteins = week.flatMap((d) => d.meals.map((m) => m.protein.toLowerCase()));
    expect(proteins.filter((p) => p.includes("chicken"))).toEqual([]);
    expect(proteins.filter((p) => p.includes("beef"))).toEqual([]);
  });

  it("drops archetypes the user's restrictions forbid", () => {
    const week = buildMenuSkeleton(DAYS, glutenFree, 2000, "seed");
    const forms = week.flatMap((d) => d.meals.map((m) => m.archetype)).join(" ");
    expect(forms).not.toMatch(/toast|pasta|tortilla|pancakes/i);
  });
});

describe("buildWeeklyPlanPrompt", () => {
  const base = {
    userData: { age: 30, gender: "female", height: 165, weight: 60, path: "maintain" },
    constraints: none,
    targetCalories: 2000,
    macros: { protein: 120, carbs: 220, fat: 67 },
  };

  it("includes every planned meal in the outline", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({ ...base, skeleton });
    for (const day of skeleton) {
      expect(prompt).toContain(day.dateStr);
      for (const meal of day.meals) expect(prompt).toContain(meal.archetype);
    }
  });

  it("keeps flagged non-food terms out of dislikes and preferences", () => {
    // "white socks" survived onboarding because the user chose to keep it after
    // being warned. It must not reach the model as a dietary instruction.
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      userData: {
        ...base.userData,
        dislikes: ["Olives", "white socks"],
        foodPreferences: ["Pizza", "my ex boyfriend"],
        unrecognisedTerms: ["white socks", "my ex boyfriend"],
      },
      skeleton,
    });

    expect(prompt).toContain("Olives");
    expect(prompt).toContain("Pizza");
    expect(prompt).not.toContain("white socks");
    expect(prompt).not.toContain("my ex boyfriend");
  });

  it("matches flagged terms regardless of case or padding", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      userData: {
        ...base.userData,
        dislikes: ["  White Socks  "],
        unrecognisedTerms: ["white socks"],
      },
      skeleton,
    });
    expect(prompt.toLowerCase()).not.toContain("white socks");
  });

  it("leaves dislikes untouched when nothing was flagged", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      userData: { ...base.userData, dislikes: ["Olives", "Mushrooms"] },
      skeleton,
    });
    expect(prompt).toContain("Olives");
    expect(prompt).toContain("Mushrooms");
  });

  it("puts hard dietary constraints ahead of everything else", () => {
    const skeleton = buildMenuSkeleton(DAYS, vegan, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({ ...base, constraints: vegan, skeleton });
    // The constraint block opens the prompt, ahead of the person, the outline
    // and the schema — a restriction must never read as one preference among many.
    expect(prompt.split("\n\n")[0]).toContain("HARD DIETARY CONSTRAINTS");
    expect(prompt.indexOf("HARD DIETARY CONSTRAINTS")).toBeLessThan(prompt.indexOf("MENU OUTLINE"));
  });

  it("never shows a vegan a meat preference", () => {
    // Reported from a real local run: a vegan whose stored preferences still
    // contained "Sirloin Steak" got steak for breakfast, because the prompt
    // described them as enjoying steak in the same breath as forbidding meat.
    const skeleton = buildMenuSkeleton(DAYS, vegan, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      constraints: vegan,
      skeleton,
      userData: { ...base.userData, foodPreferences: ["Italian", "Sirloin Steak"] },
    });

    expect(prompt).not.toMatch(/ENJOYS[^\n]*Sirloin Steak/i);
    expect(prompt).toMatch(/ENJOYS[^\n]*Italian/i);
  });

  it("scopes food preferences away from breakfast", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      skeleton,
      userData: { ...base.userData, foodPreferences: ["Sirloin Steak"] },
    });
    expect(prompt).toMatch(/ENJOYS[^\n]*LUNCH and DINNER only/i);
  });

  it("omits the preferences line when every preference conflicts", () => {
    const skeleton = buildMenuSkeleton(DAYS, vegan, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      constraints: vegan,
      skeleton,
      userData: { ...base.userData, foodPreferences: ["Sirloin Steak", "Bacon"] },
    });
    expect(prompt).not.toContain("ENJOYS");
  });

  it("does not permit a protein it also tells the model to never include", () => {
    // The block said "ONLY use these proteins: Tofu, …" two lines above
    // "NEVER INCLUDE (disliked): Tofu". Contradictions like this are what the
    // model resolves the wrong way.
    const skeleton = buildMenuSkeleton(DAYS, vegan, 2000, "seed", ["Tofu"]);
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      constraints: vegan,
      skeleton,
      userData: { ...base.userData, dislikes: ["Tofu"] },
    });

    const onlyLine = prompt.split("\n").find((l) => l.startsWith("ONLY use these proteins:"))!;
    expect(onlyLine).toBeDefined();
    expect(onlyLine.toLowerCase()).not.toContain("tofu");
    expect(prompt).toMatch(/NEVER INCLUDE \(disliked\): Tofu/);
  });

  it("lists recent meals as an exclusion set", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      skeleton,
      recentMeals: ["Lemon Herb Chicken", "Tofu Scramble"],
    });
    expect(prompt).toContain("do not reuse");
    expect(prompt).toContain("Lemon Herb Chicken");
  });

  it("omits optional sections when nothing is supplied", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({ ...base, skeleton });
    expect(prompt).not.toContain("ALREADY EATEN RECENTLY");
    expect(prompt).not.toContain("STYLE NOTE");
    expect(prompt).not.toContain("CORRECTION REQUIRED");
  });

  it("marks training days so the model can skew protein", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({ ...base, skeleton });
    expect(prompt).toContain("training day");
    expect(prompt).toContain("rest day");
  });
});
