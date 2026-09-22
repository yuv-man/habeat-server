import { applyFamiliarWeek } from "../../../src/generator/familiar-week";

const meal = (name: string, calories = 500, extra: any = {}) => ({
  _id: name,
  name,
  category: "x",
  calories,
  macros: { protein: 25, carbs: 60, fat: Math.round((calories - 340) / 9) },
  ingredients: [[`${name.toLowerCase()}_base`, "100 g", "Pantry"]],
  done: false,
  ...extra,
});

/** Sat 19 Sep → Sun 27 Sep 2026: a weekend sign-up's first plan. */
const plan = () => {
  const p: Record<string, any> = {};
  for (let d = 19; d <= 27; d++) {
    const k = `2026-09-${d}`;
    p[k] = {
      meals: {
        breakfast: meal(`B${d}`, 540),
        lunch: meal(`L${d}`, 755),
        dinner: meal(`D${d}`, 647),
        snacks: [meal(`S${d}`, 216)],
      },
    };
  }
  return p;
};

describe("applyFamiliarWeek", () => {
  const { weeklyPlan: wp, stats } = applyFamiliarWeek(plan());
  const b = (d: number) => wp[`2026-09-${d}`].meals.breakfast.name;

  it("serves one breakfast on weekdays and one on the weekend, per week", () => {
    expect([21, 22, 23, 24, 25].map(b)).toEqual(Array(5).fill("B21")); // Mon–Fri
    expect([26, 27].map(b)).toEqual(["B26", "B26"]); // next weekend
    expect([19, 20].map(b)).toEqual(["B19", "B19"]); // sign-up weekend
  });

  it("alternates two snacks", () => {
    const snacks = [21, 22, 23, 24, 25, 26, 27].map((d) => wp[`2026-09-${d}`].meals.snacks[0].name);
    expect(snacks).toEqual(["S21", "S22", "S21", "S22", "S21", "S22", "S21"]);
  });

  it("brings Monday's and Wednesday's dinners back as the next day's lunch, lunch-sized", () => {
    const tue = wp["2026-09-22"].meals.lunch;
    expect(tue.name).toBe("D21");
    expect(tue.leftoverOf).toBe("2026-09-21");
    expect(Math.abs(tue.calories - 755)).toBeLessThan(40);
    expect(tue.ingredients[0][1]).not.toBe("100 g"); // portion scaled, not just relabelled
    expect(wp["2026-09-21"].meals.dinner.makesLeftovers).toBe(true);
    expect(wp["2026-09-24"].meals.lunch.name).toBe("D23");
    expect(stats.leftoverLunches).toBe(2);
  });

  it("cuts the number of different dishes to cook", () => {
    const names = new Set<string>();
    for (const day of Object.values(wp)) {
      const m = (day as any).meals;
      [m.breakfast, m.lunch, m.dinner, ...m.snacks].forEach((x: any) => names.add(x.name));
    }
    // 36 meals → 23 dishes: 3 breakfasts (two weekends + weekdays), 4 snacks
    // (two per week), 7 lunches (2 are leftovers), 9 dinners.
    expect(names.size).toBe(23);
  });

  it("is idempotent and keeps what the user already ticked off", () => {
    const again = applyFamiliarWeek(wp);
    expect(again.stats).toEqual({ breakfastRepeats: 0, snackRepeats: 0, leftoverLunches: 0 });

    const p = plan();
    applyFamiliarWeek(p);
    p["2026-09-22"].meals.breakfast.done = true;
    applyFamiliarWeek(p);
    expect(p["2026-09-22"].meals.breakfast.done).toBe(true);
  });

  it("does not copy one slot's fields over another's slot", () => {
    expect(wp["2026-09-22"].meals.lunch.category).toBe("x");
    expect(wp["2026-09-22"].meals.lunch.done).toBe(false);
  });

  it("copes with gaps: a single day, missing meals, no snacks", () => {
    const single = { "2026-09-19": { meals: { breakfast: meal("B"), snacks: [] } } };
    expect(applyFamiliarWeek(single).stats).toEqual({ breakfastRepeats: 0, snackRepeats: 0, leftoverLunches: 0 });
    const p = plan();
    delete p["2026-09-21"].meals.dinner;
    expect(applyFamiliarWeek(p).weeklyPlan["2026-09-22"].meals.lunch.name).toBe("L22");
  });
});
