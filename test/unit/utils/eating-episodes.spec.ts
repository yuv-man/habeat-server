import {
  extractLoggedMeals,
  extractSkippedMeals,
  nearestMood,
  timestampMoods,
  dateKeyAtHour,
  SLOT_DEFAULT_HOUR,
} from "../../../src/utils/eating-episodes";

const progressDoc = (dateKey: string, meals: any) => ({ dateKey, meals });

describe("extractLoggedMeals", () => {
  it("returns only meals actually ticked off", () => {
    const meals = extractLoggedMeals([
      progressDoc("2026-09-01", {
        breakfast: { _id: "b1", name: "Oats", done: true },
        lunch: { _id: "l1", name: "Salad", done: false },
        dinner: null,
        snacks: [{ _id: "s1", name: "Nuts", done: true }],
      }),
    ]);

    expect(meals.map((m) => m.mealName).sort()).toEqual(["Nuts", "Oats"]);
  });

  it("uses the recorded completion time when there is one", () => {
    const at = new Date(2026, 8, 1, 20, 45);
    const [meal] = extractLoggedMeals([
      progressDoc("2026-09-01", {
        dinner: { _id: "d1", name: "Pasta", done: true, completedAt: at },
      }),
    ]);

    expect(meal.at.getTime()).toBe(at.getTime());
    expect(meal.atIsExact).toBe(true);
  });

  it("falls back to the slot's typical hour for meals logged before completedAt existed", () => {
    const [meal] = extractLoggedMeals([
      progressDoc("2026-09-01", {
        dinner: { _id: "d1", name: "Pasta", done: true },
      }),
    ]);

    expect(meal.at.getHours()).toBe(SLOT_DEFAULT_HOUR.dinner);
    // The claim "you ate late" must never rest on a guessed hour.
    expect(meal.atIsExact).toBe(false);
  });

  it("reads the date key as a local day, not a UTC instant", () => {
    const at = dateKeyAtHour("2026-09-01", 8)!;
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(8);
    expect(at.getDate()).toBe(1);
    expect(at.getHours()).toBe(8);
  });
});

describe("extractSkippedMeals", () => {
  const docs = [
    progressDoc("2026-09-01", {
      breakfast: { _id: "b1", name: "Oats", done: false },
      lunch: { _id: "l1", name: "Salad", done: true },
      dinner: { name: undefined, done: false },
    }),
    progressDoc("2026-09-02", {
      breakfast: { _id: "b2", name: "Oats", done: false },
    }),
  ];

  it("counts planned meals that were never logged", () => {
    const skipped = extractSkippedMeals(docs, "2026-09-03");
    expect(skipped).toEqual([
      { date: "2026-09-01", mealType: "breakfast" },
      { date: "2026-09-02", mealType: "breakfast" },
    ]);
  });

  it("does not call today's untouched meals skipped — the day isn't over", () => {
    const skipped = extractSkippedMeals(docs, "2026-09-02");
    expect(skipped).toEqual([{ date: "2026-09-01", mealType: "breakfast" }]);
  });
});

describe("nearestMood", () => {
  const meal = {
    mealId: "m1",
    mealName: "Pasta",
    mealType: "dinner" as const,
    date: "2026-09-01",
    at: new Date(2026, 8, 1, 19, 0),
    atIsExact: true,
  };

  it("picks the closest check-in inside the window", () => {
    const moods = timestampMoods([
      { date: "2026-09-01", time: "17:30", tag: "early" },
      { date: "2026-09-01", time: "19:40", tag: "close" },
    ] as any);

    expect(nearestMood(meal, moods)!.entry).toMatchObject({ tag: "close" });
  });

  it("returns null when nothing was logged near the meal", () => {
    const moods = timestampMoods([
      { date: "2026-09-01", time: "08:00", tag: "morning" },
    ] as any);

    expect(nearestMood(meal, moods)).toBeNull();
  });

  it("ignores moods on other days even at the same clock time", () => {
    const moods = timestampMoods([
      { date: "2026-09-02", time: "19:10", tag: "tomorrow" },
    ] as any);

    expect(nearestMood(meal, moods)).toBeNull();
  });

  it("drops entries whose date or time can't be read", () => {
    expect(
      timestampMoods([
        { date: "2026-09-01" },
        { time: "19:00" },
        { date: "nope", time: "19:00" },
      ] as any)
    ).toHaveLength(0);
  });
});
