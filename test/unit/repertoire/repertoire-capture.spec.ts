import {
  dishKey,
  extractLoggedDishes,
  findCandidates,
  observeRhythm,
  ProgressDayLike,
} from "../../../src/repertoire/repertoire.capture";

const meal = (name: string, over: any = {}) => ({
  name,
  done: true,
  calories: 500,
  macros: { protein: 30, carbs: 50, fat: 15 },
  prepTime: 20,
  ...over,
});

const day = (dateKey: string, meals: ProgressDayLike["meals"]): ProgressDayLike => ({
  dateKey,
  meals,
});

const candidatesFrom = (days: ProgressDayLike[], known: string[] = []) =>
  findCandidates(extractLoggedDishes(days), new Set(known));

describe("dishKey", () => {
  it("folds case, punctuation, spacing and plurals", () => {
    expect(dishKey("Chicken  Soup!")).toBe(dishKey("chicken soups"));
  });

  it("keeps non-Latin names", () => {
    expect(dishKey("שקשוקה")).not.toBe("");
  });
});

describe("extractLoggedDishes", () => {
  it("only reads meals that were actually eaten", () => {
    const logs = extractLoggedDishes([
      day("2026-09-01", {
        breakfast: meal("Oats", { done: false }),
        dinner: meal("Pasta"),
        snacks: [meal("Apple"), null],
      }),
    ]);
    expect(logs.map((l) => [l.name, l.slot])).toEqual([
      ["Pasta", "dinner"],
      ["Apple", "snack"],
    ]);
  });
});

describe("findCandidates", () => {
  it("proposes a dish cooked at home twice", () => {
    const [c, ...rest] = candidatesFrom([
      day("2026-09-01", { dinner: meal("Shakshuka", { source: "cooked" }) }),
      day("2026-09-08", { breakfast: meal("shakshuka", { source: "cooked", calories: 400 }) }),
    ]);

    expect(rest).toEqual([]);
    expect(c.kind).toBe("confirmed");
    expect(c.name).toBe("shakshuka"); // most recent spelling
    expect(c.slots.sort()).toEqual(["breakfast", "dinner"]);
    expect(c.cookedCount).toBe(2);
    expect(c.nutritionPerServing).toEqual({ calories: 450, protein: 30, carbs: 50, fat: 15 });
    expect(c.lastLoggedOn).toBe("2026-09-08");
  });

  it("never counts takeaway or eating out", () => {
    const candidates = candidatesFrom([
      day("2026-09-01", { dinner: meal("Pad Thai", { source: "ordered" }) }),
      day("2026-09-03", { dinner: meal("Pad Thai", { source: "eaten-out" }) }),
      day("2026-09-05", { dinner: meal("Pad Thai", { source: "cooked" }) }),
    ]);
    expect(candidates).toEqual([]);
  });

  it("asks rather than assumes when logs never said where the food came from", () => {
    const [c] = candidatesFrom([
      day("2026-09-01", { lunch: meal("Lentil Soup") }),
      day("2026-09-04", { lunch: meal("Lentil Soup", { source: "cooked" }) }),
    ]);
    expect(c.kind).toBe("ask-source");
    expect(c.cookedCount).toBe(1);
    expect(c.unansweredCount).toBe(1);
  });

  it("does not propose a dish seen once", () => {
    expect(
      candidatesFrom([day("2026-09-01", { dinner: meal("Risotto", { source: "cooked" }) })]),
    ).toEqual([]);
  });

  it("never re-proposes a dish already known in any status, declined included", () => {
    const days = [
      day("2026-09-01", { dinner: meal("Risotto", { source: "cooked" }) }),
      day("2026-09-02", { dinner: meal("Risotto", { source: "cooked" }) }),
    ];
    expect(candidatesFrom(days, [dishKey("risotto")])).toEqual([]);
  });

  it("puts confirmed dishes before ones that need a question", () => {
    const candidates = candidatesFrom([
      day("2026-09-01", { lunch: meal("Soup"), dinner: meal("Curry", { source: "cooked" }) }),
      day("2026-09-02", { lunch: meal("Soup"), dinner: meal("Curry", { source: "cooked" }) }),
      day("2026-09-03", { lunch: meal("Soup") }),
    ]);
    expect(candidates.map((c) => c.kind)).toEqual(["confirmed", "ask-source"]);
  });

  it("leaves nutrition unknown rather than guessing when a macro is missing", () => {
    const [c] = candidatesFrom([
      day("2026-09-01", { dinner: meal("Stew", { source: "cooked", macros: null }) }),
      day("2026-09-02", { dinner: meal("Stew", { source: "cooked", macros: null }) }),
    ]);
    expect(c.nutritionPerServing).toBeNull();
  });
});

describe("observeRhythm", () => {
  it("counts home logs per month and ignores takeaway", () => {
    const logs = extractLoggedDishes([
      day("2026-09-01", { dinner: meal("Curry", { source: "cooked" }) }),
      day("2026-09-10", { dinner: meal("Curry") }),
      day("2026-09-12", { dinner: meal("Curry", { source: "ordered" }) }),
    ]);
    const r = observeRhythm(logs, [dishKey("curry"), dishKey("never eaten")], 30);

    expect(r.get(dishKey("curry"))).toEqual({ observedPerMonth: 2, lastCookedOn: "2026-09-10" });
    expect(r.get(dishKey("never eaten"))).toEqual({ observedPerMonth: 0, lastCookedOn: null });
  });
});
