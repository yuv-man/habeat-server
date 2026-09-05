import { buildBehaviorSummary, SummaryInput } from "../../../src/behavior/behavior-summary";

/** Fixed dates so weekday/weekend maths is deterministic.
 *  2026-09-07 is a Monday, so 2026-09-12/13 are Sat/Sun. */
const MONDAY = "2026-09-07";
const TODAY = "2026-09-14"; // the Monday after

const at = (dateKey: string, hour: number, minute = 0) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
};

const day = (dateKey: string, over: any = {}) => ({
  dateKey,
  caloriesConsumed: 1800,
  caloriesGoal: 2000,
  protein: { consumed: 90, goal: 150 },
  carbs: { consumed: 200, goal: 220 },
  fat: { consumed: 60, goal: 65 },
  water: { consumed: 8, goal: 8 },
  workouts: [],
  meals: {},
  ...over,
});

const meal = (name: string, done: boolean, prepTime = 20, completedAt?: Date) => ({
  _id: `${name}-${Math.random()}`,
  name,
  prepTime,
  done,
  ...(completedAt ? { completedAt } : {}),
});

const base = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  periodDays: 7,
  todayKey: TODAY,
  startKey: MONDAY,
  progressDocs: [],
  moods: [],
  user: null,
  goals: [],
  ...over,
});

describe("buildBehaviorSummary — adherence", () => {
  it("counts a planned-but-untouched meal as skipped and a ticked one as completed", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [
          day(MONDAY, {
            meals: {
              breakfast: meal("Oats", false, 25),
              lunch: meal("Salad", true, 10, at(MONDAY, 13)),
              dinner: meal("Pasta", true, 30, at(MONDAY, 19)),
              snacks: [],
            },
          }),
        ],
      })
    );

    expect(s.adherence.plannedMeals).toBe(3);
    expect(s.adherence.completed).toBe(2);
    expect(s.adherence.skipped).toBe(1);
    expect(s.adherence.completionRate.value).toBeCloseTo(0.67, 2);
    expect(s.adherence.bySlot.breakfast.value).toBe(0);
    expect(s.adherence.bySlot.dinner.value).toBe(1);
  });

  it("leaves today out of adherence — the day is not over", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [
          day(TODAY, {
            meals: { breakfast: meal("Oats", false), lunch: meal("Salad", false), snacks: [] },
          }),
        ],
      })
    );

    expect(s.adherence.plannedMeals).toBe(0);
    expect(s.adherence.completionRate.value).toBeNull();
  });

  it("reports a rate as null rather than 0 when nothing was ever planned", () => {
    const s = buildBehaviorSummary(base());

    // The distinction the whole summary rests on: unknown is not zero.
    expect(s.adherence.completionRate.value).toBeNull();
    expect(s.water.consistency.value).toBeNull();
    expect(s.nutrition.calorieAccuracy).toBeNull();
    expect(s.variety.repeatRate).toBeNull();
  });

  it("separates weekdays from weekends", () => {
    const s = buildBehaviorSummary(
      base({
        periodDays: 14,
        progressDocs: [
          // Weekdays: everything eaten
          day("2026-09-08", { meals: { breakfast: meal("A", true), lunch: meal("B", true), snacks: [] } }),
          day("2026-09-09", { meals: { breakfast: meal("C", true), lunch: meal("D", true), snacks: [] } }),
          // Weekend: nothing eaten
          day("2026-09-12", { meals: { breakfast: meal("E", false), lunch: meal("F", false), snacks: [] } }),
          day("2026-09-13", { meals: { breakfast: meal("G", false), lunch: meal("H", false), snacks: [] } }),
        ],
      })
    );

    expect(s.adherence.weekday.value).toBe(1);
    expect(s.adherence.weekend.value).toBe(0);
    expect(s.adherence.weekendDelta).toBe(-1);
  });

  it("counts swaps that happened inside the window, not the lifetime total", () => {
    const s = buildBehaviorSummary(
      base({
        user: {
          mealLearningProfile: {
            swappedMeals: [{ name: "Tofu Curry", count: 9 }],
            recentSwaps: [
              { name: "Tofu Curry", at: at("2026-09-08", 12) },
              { name: "Tofu Curry", at: at("2026-09-10", 12) },
              { name: "Tofu Curry", at: new Date(2025, 0, 1) },
            ],
          },
        },
      })
    );

    expect(s.adherence.replaced).toBe(2);
    expect(s.adherence.replacedTotal).toBe(9);
  });
});

describe("buildBehaviorSummary — timing and prep time", () => {
  it("averages meal times only over meals that carry a real timestamp", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [
          day(MONDAY, {
            meals: {
              dinner: meal("Pasta", true, 30, at(MONDAY, 20, 0)),
              snacks: [],
            },
          }),
          day("2026-09-08", {
            meals: {
              // No completedAt — falls back to the slot hour, so it must not
              // pollute the timing average.
              dinner: meal("Rice", true, 30),
              snacks: [],
            },
          }),
        ],
      })
    );

    expect(s.timing.average.dinner).toBe("20:00");
    expect(s.timing.basis.dinner).toBe(1);
  });

  it("surfaces the gap between what got skipped and what got made", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [
          day(MONDAY, {
            meals: {
              breakfast: meal("Elaborate Shakshuka", false, 40),
              lunch: meal("Sandwich", true, 10, at(MONDAY, 13)),
              snacks: [],
            },
          }),
          day("2026-09-08", {
            meals: {
              breakfast: meal("Elaborate Shakshuka", false, 40),
              lunch: meal("Wrap", true, 10, at("2026-09-08", 13)),
              snacks: [],
            },
          }),
        ],
      })
    );

    expect(s.prepTime.avgCompleted).toBe(10);
    expect(s.prepTime.avgSkipped).toBe(40);
    expect(s.prepTime.skippedMinusCompleted).toBe(30);
    expect(s.prepTime.bySlot.breakfast.avgSkipped).toBe(40);
  });

  it("counts late eating by day, from real timestamps only", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [
          day(MONDAY, {
            meals: {
              dinner: meal("Late Pasta", true, 20, at(MONDAY, 22, 30)),
              snacks: [meal("Crisps", true, 1, at(MONDAY, 23, 0))],
            },
          }),
          day("2026-09-08", {
            meals: { dinner: meal("Early Rice", true, 20, at("2026-09-08", 18)), snacks: [] },
          }),
        ],
      })
    );

    expect(s.timing.lateEatingDays).toBe(1);
    expect(s.timing.lateEatingRate).toEqual({ value: 0.5, hits: 1, of: 2 });
    expect(s.timing.latestMealHour).toBe(23);
  });
});

describe("buildBehaviorSummary — food and feeling", () => {
  it("compares adherence on low-mood days against the user's other days", () => {
    const s = buildBehaviorSummary(
      base({
        periodDays: 14,
        progressDocs: [
          day("2026-09-08", {
            meals: { breakfast: meal("A", false), lunch: meal("B", false), snacks: [] },
          }),
          day("2026-09-09", {
            meals: { breakfast: meal("C", true), lunch: meal("D", true), snacks: [] },
          }),
        ],
        moods: [
          { date: "2026-09-08", time: "09:00", moodLevel: 1, moodCategory: "sad" },
          { date: "2026-09-09", time: "09:00", moodLevel: 5, moodCategory: "happy" },
        ],
      })
    );

    expect(s.foodAndFeeling.adherenceOnLowMoodDays.value).toBe(0);
    expect(s.foodAndFeeling.adherenceOnOtherDays.value).toBe(1);
    expect(s.wellness.lowMoodDays).toBe(1);
  });

  it("compares snacking on hard days against ordinary days", () => {
    const s = buildBehaviorSummary(
      base({
        periodDays: 14,
        progressDocs: [
          day("2026-09-08", {
            meals: {
              lunch: meal("Salad", true, 10, at("2026-09-08", 13)),
              snacks: [meal("Crisps", true, 1, at("2026-09-08", 16)), meal("Bar", true, 1, at("2026-09-08", 17))],
            },
          }),
          day("2026-09-09", {
            meals: { lunch: meal("Soup", true, 10, at("2026-09-09", 13)), snacks: [] },
          }),
        ],
        moods: [
          { date: "2026-09-08", time: "09:00", moodLevel: 3, moodCategory: "stressed" },
          { date: "2026-09-09", time: "09:00", moodLevel: 4, moodCategory: "calm" },
        ],
      })
    );

    expect(s.foodAndFeeling.snacksPerHardDay).toBe(2);
    expect(s.foodAndFeeling.snacksPerOtherDay).toBe(0);
    expect(s.wellness.stressedDays).toBe(1);
  });
});

describe("buildBehaviorSummary — nutrition, variety and exercise", () => {
  it("names the macro furthest below its own goal", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [day(MONDAY), day("2026-09-08")],
      })
    );

    // Protein 90/150 = 0.6; carbs and fat are both near target.
    expect(s.nutrition.macroWeakness).toBe("protein");
    expect(s.nutrition.calorieAccuracy).toBe("on-target");
  });

  it("measures repetition across logged dish names", () => {
    const s = buildBehaviorSummary(
      base({
        progressDocs: [
          day(MONDAY, { meals: { lunch: meal("Chicken Bowl", true), snacks: [] } }),
          day("2026-09-08", { meals: { lunch: meal("Chicken Bowl", true), snacks: [] } }),
          day("2026-09-09", { meals: { lunch: meal("Chicken Bowl", true), snacks: [] } }),
          day("2026-09-10", { meals: { lunch: meal("Soup", true), snacks: [] } }),
        ],
      })
    );

    expect(s.variety.distinctMeals).toBe(2);
    expect(s.variety.totalMeals).toBe(4);
    expect(s.variety.repeatRate).toBe(0.5);
    expect(s.variety.mostRepeated[0]).toEqual({ name: "chicken bowl", count: 3 });
  });

  it("splits meal adherence by whether a workout happened that day", () => {
    const s = buildBehaviorSummary(
      base({
        periodDays: 14,
        progressDocs: [
          day("2026-09-08", {
            workouts: [{ name: "Run", done: true }],
            meals: { breakfast: meal("A", true), lunch: meal("B", true), snacks: [] },
          }),
          day("2026-09-09", {
            workouts: [{ name: "Run", done: false }],
            meals: { breakfast: meal("C", false), lunch: meal("D", true), snacks: [] },
          }),
        ],
      })
    );

    expect(s.exercise.sessionsPlanned).toBe(2);
    expect(s.exercise.sessionsCompleted).toBe(1);
    expect(s.exercise.mealAdherenceOnWorkoutDays.value).toBe(1);
    expect(s.exercise.mealAdherenceOnRestDays.value).toBe(0.5);
  });
});
