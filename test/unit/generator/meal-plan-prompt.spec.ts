import {
  buildMenuSkeleton,
  buildMenuSkeletonForDays,
  buildWeeklyPlanPrompt,
  FAVOURITE_MAIN_SHARE,
  usablePreferences,
  asFavourites,
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

describe("buildMenuSkeleton — one plan, several requests", () => {
  const seed = planSeed("user-1", "2026-08-08");
  const sat = DAYS[5];
  const sun = DAYS[6];
  const key = (d: any) => d.meals.map((m: any) => `${m.slot}:${m.protein}:${m.archetype}`).join("|");

  it("gives separate requests of the same plan different outlines", () => {
    // Phase 1 (today) and Phase 2 (the rest) are separate requests. Built per
    // request, both started the rotation from scratch and a Saturday sign-up got
    // an identical Saturday and Sunday.
    const [phase1] = buildMenuSkeletonForDays([sat], "2026-08-08", none, 2000, seed);
    const [phase2] = buildMenuSkeletonForDays([sun], "2026-08-08", none, 2000, seed);
    expect(key(phase2)).not.toEqual(key(phase1));
  });

  it("slices exactly what one request for the whole span would build", () => {
    const whole = buildMenuSkeleton([sat, sun], none, 2000, seed);
    const [phase2] = buildMenuSkeletonForDays([sun], "2026-08-08", none, 2000, seed);
    expect(key(phase2)).toEqual(key(whole[1]));
    expect(phase2.hasWorkout).toBe(sun.hasWorkout);
  });

  it("returns only the requested days", () => {
    const out = buildMenuSkeletonForDays([DAYS[2], DAYS[4]], "2026-08-03", none, 2000, seed);
    expect(out.map((d) => d.dateStr)).toEqual(["2026-08-05", "2026-08-07"]);
  });

  it("never serves the same main protein at lunch and dinner on one day", () => {
    for (const s of ["a", "b", "c", "d", "e"]) {
      for (const day of buildMenuSkeleton(DAYS, none, 2000, s)) {
        const lunch = day.meals.find((m) => m.slot === "lunch")!.protein;
        const dinner = day.meals.find((m) => m.slot === "dinner")!.protein;
        expect(dinner).not.toEqual(lunch);
      }
    }
  });
});

describe("favourites in the outline", () => {
  const CHLOE = asFavourites([], ["Pasta", "Salad", "Italian", "Burrata", "Tomato salad", "Artichoke with olive oil"]);
  const mains = (week: any[]) =>
    week.flatMap((d) => d.meals.filter((m: any) => m.slot === "lunch" || m.slot === "dinner"));

  it("gives about 40% of lunches and dinners to the person's favourites", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, undefined, CHLOE);
    const fav = mains(week).filter((m: any) => m.favourite);
    expect(fav.length).toBe(Math.floor(14 * FAVOURITE_MAIN_SHARE)); // 5 of 14
    expect(new Set(fav.map((m: any) => m.favourite)).size).toBe(5); // rotates, no repeats yet
  });

  it("never touches breakfast or snacks", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, undefined, CHLOE);
    const others = week.flatMap((d) => d.meals.filter((m: any) => m.slot === "breakfast" || m.slot === "snack"));
    expect(others.some((m: any) => m.favourite)).toBe(false);
  });

  it("leaves an outline without favourites exactly as it was", () => {
    const a = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const b = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, undefined, []);
    expect(b).toEqual(a);
  });

  it("keeps rotating across separate requests of one plan", () => {
    const seed = planSeed("u", "2026-08-03");
    const whole = buildMenuSkeleton(DAYS, none, 2000, seed, [], undefined, undefined, CHLOE);
    const tail = buildMenuSkeletonForDays(DAYS.slice(4), "2026-08-03", none, 2000, seed, [], undefined, undefined, CHLOE);
    expect(tail).toEqual(whole.slice(4));
  });

  it("tells the model to cook the favourite as it is really made", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, undefined, asFavourites([], ["Burrata"]));
    const prompt = buildWeeklyPlanPrompt({
      userData: { age: 28, gender: "female", height: 165, weight: 60, path: "running", foodPreferences: ["Burrata"] },
      constraints: none,
      targetCalories: 2158,
      macros: { protein: 108, carbs: 297, fat: 60 },
      skeleton,
    });
    expect(prompt).toContain('ONE OF THEIR FAVOURITES — make a proper "Burrata" dish');
    expect(prompt).toContain("Meals marked as favourites in the outline are built on these");
  });

  it("plans a dish the user cooks as their own, ahead of a food they merely like", () => {
    const favourites = asFavourites(["Mum's chicken soup"], ["Pasta"]);
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, undefined, favourites);
    const marked = mains(week).filter((m: any) => m.favourite);

    expect(marked[0]).toMatchObject({ favourite: "Mum's chicken soup", favouriteKind: "own" });
    expect(marked[1]).toMatchObject({ favourite: "Pasta", favouriteKind: "liked" });

    const prompt = buildWeeklyPlanPrompt({
      userData: { age: 28, gender: "female", height: 165, weight: 60, path: "running" },
      constraints: none,
      targetCalories: 2000,
      macros: { protein: 100, carbs: 275, fat: 56 },
      skeleton: week,
    });
    expect(prompt).toContain('A DISH THEY ALREADY COOK — plan "Mum\'s chicken soup" the way they make it');
  });

  it("never plans the same favourite twice before the rest have had a turn", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, undefined, asFavourites(["Soup", "soup "], ["Pasta"]));
    const names = mains(week).filter((m: any) => m.favourite).map((m: any) => m.favourite);
    expect(new Set(names.slice(0, 2)).size).toBe(2); // duplicates folded away
  });

  it("drops preferences the person's diet forbids, and ones flagged as not food", () => {
    const prefs = usablePreferences(
      { foodPreferences: ["Steak", "Pasta", "white socks"], unrecognisedTerms: ["White socks"] },
      vegan,
    );
    expect(prefs.allowed).toEqual(["Pasta"]);
    expect(prefs.removed).toEqual(["Steak"]);
  });
});

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
    expect(prompt).not.toContain("RECENTLY PLANNED AND NOT EATEN");
    expect(prompt).not.toContain("STYLE NOTE");
    expect(prompt).not.toContain("CORRECTION REQUIRED");
    expect(prompt).not.toContain("COACH'S BRIEF ON THIS USER");
  });

  it("carries the behavioural findings above the menu, as requirements", () => {
    // The point of the behaviour pipeline: a plan that ignores a repeatedly
    // skipped breakfast just serves the same breakfast again.
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({
      ...base,
      skeleton,
      behaviourContext:
        "The user follows breakfast (30%) far less often than the rest of the day.",
    });

    expect(prompt).toContain("COACH'S BRIEF ON THIS USER");
    expect(prompt).toContain("breakfast (30%)");
    // Ahead of the outline, so the constraints are read before the cooking.
    expect(prompt.indexOf("COACH'S BRIEF ON THIS USER")).toBeLessThan(
      prompt.indexOf("MENU OUTLINE"),
    );
  });

  it("marks training days so the model can skew protein", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const prompt = buildWeeklyPlanPrompt({ ...base, skeleton });
    expect(prompt).toContain("training day");
    expect(prompt).toContain("rest day");
  });

  describe("cooking level", () => {
    const skeleton = buildMenuSkeleton(DAYS, none, 2000, "seed");

    it("caps prep time and states the technique the user is up for", () => {
      const prompt = buildWeeklyPlanPrompt({
        ...base,
        userData: { ...base.userData, cookingLevel: "beginner" },
        skeleton,
      });

      expect(prompt).toContain("MAX PREP TIME: 20 minutes per meal");
      expect(prompt).toContain("COOKING SKILL: beginner");
      expect(prompt).toContain("one oven tray");
    });

    it("falls back to the default ceiling when the user never said", () => {
      const prompt = buildWeeklyPlanPrompt({ ...base, skeleton });
      expect(prompt).toContain("MAX PREP TIME: 45 minutes per meal");
      expect(prompt).not.toContain("COOKING SKILL");
    });

    it("lets observed behaviour tighten the declared ceiling", () => {
      // Says they love to cook, but abandons anything over 25 minutes.
      const prompt = buildWeeklyPlanPrompt({
        ...base,
        userData: { ...base.userData, cookingLevel: "confident" },
        skeleton,
        maxPrepMinutes: 25,
      });
      expect(prompt).toContain("MAX PREP TIME: 25 minutes per meal");
    });

    it("never lets observed behaviour loosen the declared ceiling", () => {
      // A beginner does not get 60-minute dinners because the behaviour
      // pipeline hasn't watched them abandon one yet.
      const prompt = buildWeeklyPlanPrompt({
        ...base,
        userData: { ...base.userData, cookingLevel: "beginner" },
        skeleton,
        maxPrepMinutes: 60,
      });
      expect(prompt).toContain("MAX PREP TIME: 20 minutes per meal");
    });
  });
});

describe("diet type shapes the menu", () => {
  const CARB_WORDS = /porridge|grain|oats|pancake|waffle|crepe|toast|flatbread|pasta|noodle|rice|tortilla|potato|bread|cracker|energy bite/i;

  it("keeps starch-led forms out of a keto plan", () => {
    // Keto sets a 5%-carb macro target. Handing the same prompt a "pancakes,
    // waffles, crepes" brief asks for two incompatible things, and the model
    // resolves it by ignoring one of them.
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, "keto");
    const forms = week.flatMap((d) => d.meals.map((m) => m.archetype));
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form).not.toMatch(CARB_WORDS);
    }
  });

  it("still offers starch-led forms on a non-keto plan", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, "healthy");
    const forms = week.flatMap((d) => d.meals.map((m) => m.archetype));
    expect(forms.some((f) => CARB_WORDS.test(f))).toBe(true);
  });

  it("leaves keto with enough shapes to avoid the same meal every day", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed", [], undefined, "keto");
    const breakfasts = new Set(
      week.flatMap((d) => d.meals.filter((m) => m.slot === "breakfast").map((m) => m.archetype)),
    );
    expect(breakfasts.size).toBeGreaterThanOrEqual(3);
  });
});

describe("breakfast reads as breakfast", () => {
  it("never briefs a breakfast as an unqualified protein plate", () => {
    // "protein-forward breakfast plate with a starch and a vegetable" named no
    // morning protein and no morning form, and the model filled the gap with a
    // dinner main — "Garlic Herb Broccoli with Sirloin and Sunny Side Up Eggs".
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const breakfasts = week.flatMap((d) =>
      d.meals.filter((m) => m.slot === "breakfast").map((m) => m.archetype),
    );
    for (const form of breakfasts) {
      if (/protein-forward/.test(form)) {
        expect(form).toMatch(/eggs|cheese/i);
        expect(form).toMatch(/no steak/i);
      }
    }
  });

  it("assigns breakfast a morning protein, never the dinner rotation", () => {
    const week = buildMenuSkeleton(DAYS, none, 2000, "seed");
    const proteins = week.flatMap((d) =>
      d.meals.filter((m) => m.slot === "breakfast").map((m) => m.protein),
    );
    for (const p of proteins) {
      expect(p).not.toMatch(/sirloin|steak|beef|lamb|pork|chicken/i);
    }
  });
});
