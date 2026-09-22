import {
  deriveProfile,
  deriveConfidence,
  derivePrefersQuickMeals,
  deriveHardDays,
  deriveEffectiveMaxPrep,
} from "../../../src/behavior/behavior-profile.derive";
import { BehaviorSummary } from "../../../src/behavior/behavior-summary.types";

const rate = (value: number | null, hits = 0, of = 0) => ({ value, hits, of });

const summary = (over: any = {}): BehaviorSummary =>
  ({
    period: { days: 30, start: "2026-08-15", end: "2026-09-14", daysWithAnyData: 25 },
    goal: {
      path: "lose", targetWeight: 70, currentWeight: 80, activeGoals: [],
      mealsPerDay: 3, fastingHours: null,
    },
    meals: {
      logged: { breakfast: 20, lunch: 25, dinner: 12, snacks: 8 },
      totalLogged: 65, averagePerDay: 2.6, daysWithAnyMeal: 25, daysWithFullDay: 10,
    },
    timing: {
      average: { breakfast: "09:15", lunch: "14:10", dinner: "21:20" },
      basis: { breakfast: 20, lunch: 25, dinner: 12, snacks: 8 },
      latestMealHour: 23, lateEatingDays: 12, lateEatingRate: rate(0.48, 12, 25),
    },
    adherence: {
      plannedMeals: 84, completed: 58, skipped: 26, replaced: 14, replacedTotal: 30,
      completionRate: rate(0.69, 58, 84),
      bySlot: {
        breakfast: rate(0.87, 20, 23),
        lunch: rate(0.93, 25, 27),
        dinner: rate(0.5, 12, 24),
        snacks: rate(0.8, 8, 10),
      },
      weekday: rate(0.8, 45, 56),
      weekend: rate(0.46, 13, 28),
      weekendDelta: -0.34,
      byDayOfWeek: {
        0: rate(0.4, 4, 10), 1: rate(0.9, 9, 10), 2: rate(0.85, 8, 10),
        3: rate(0.9, 9, 10), 4: rate(0.8, 8, 10), 5: rate(0.75, 8, 10),
        6: rate(0.45, 5, 11),
      },
    },
    nutrition: {
      avgCaloriesConsumed: 1750, avgCalorieGoal: 2000, calorieAccuracy: "under",
      avgProtein: 85, proteinGoal: 150, avgCarbs: 200, avgFat: 60,
      macroWeakness: "protein", daysWithNutritionData: 25,
    },
    water: { avgGlasses: 5.2, goal: 8, daysMetGoal: 7, consistency: rate(0.28, 7, 25) },
    exercise: {
      sessionsPlanned: 12, sessionsCompleted: 7, completionRate: rate(0.58, 7, 12),
      daysWithWorkout: 7, avgPerWeek: 2.1,
      mealAdherenceOnWorkoutDays: rate(0.8, 16, 20),
      mealAdherenceOnRestDays: rate(0.65, 42, 64),
    },
    variety: {
      distinctMeals: 18, totalMeals: 65, repeatRate: 0.72,
      mostRepeated: [{ name: "chicken bowl", count: 9 }],
    },
    prepTime: {
      avgPlanned: 25, avgCompleted: 15, avgSkipped: 38, skippedMinusCompleted: 23,
      bySlot: {
        breakfast: { avgCompleted: 8, avgSkipped: 10 },
        lunch: { avgCompleted: 12, avgSkipped: 14 },
        dinner: { avgCompleted: 22, avgSkipped: 45 },
        snacks: { avgCompleted: 2, avgSkipped: 2 },
      },
    },
    preferences: {
      favoriteMeals: [{ name: "chicken bowl", count: 9 }],
      swappedAwayFrom: [{ name: "tofu curry", count: 4 }],
      favoriteCategories: [{ cuisine: "Mediterranean", score: 0.4 }],
      dislikes: [], restrictions: [],
    },
    wellness: {
      checkIns: 22, daysWithCheckIn: 20, avgMood: 3.2, avgEnergy: 3, avgStress: 3,
      tiredDays: 8, stressedDays: 6, lowMoodDays: 5,
      byDayOfWeek: {
        0: { checkIns: 3, avgMood: 3.5 }, 1: { checkIns: 3, avgMood: 3.4 },
        2: { checkIns: 3, avgMood: 3.3 }, 3: { checkIns: 3, avgMood: 3.4 },
        4: { checkIns: 4, avgMood: 2.1 }, 5: { checkIns: 3, avgMood: 3.3 },
        6: { checkIns: 3, avgMood: 3.4 },
      },
      topTriggers: [], easedBy: [], hinderedBy: [],
    },
    foodAndFeeling: {
      scoredEpisodes: 20, emotionalEpisodes: 7, mindfulEatingScore: 65,
      adherenceOnLowMoodDays: rate(0.4, 6, 15),
      adherenceOnOtherDays: rate(0.75, 52, 69),
      lateEatingOnHardDays: rate(0.6, 6, 10),
      lateEatingOnOtherDays: rate(0.2, 3, 15),
      snacksPerHardDay: 1.8, snacksPerOtherDay: 0.6,
      emotionsAroundMeals: [{ emotion: "stressed", count: 6 }],
    },
    ...over,
  }) as BehaviorSummary;

describe("deriveConfidence", () => {
  it("refuses to claim anything from a handful of days", () => {
    const s = summary({
      period: { days: 30, start: "", end: "", daysWithAnyData: 3 },
      adherence: { ...summary().adherence, plannedMeals: 6 },
    });
    expect(deriveConfidence(s)).toBe("insufficient");
  });

  it("scales up with days logged and meals planned", () => {
    expect(deriveConfidence(summary())).toBe("high");
    expect(
      deriveConfidence(
        summary({
          period: { days: 30, start: "", end: "", daysWithAnyData: 12 },
          adherence: { ...summary().adherence, plannedMeals: 30 },
        })
      )
    ).toBe("medium");
  });
});

describe("derivePrefersQuickMeals", () => {
  it("reads the gap between skipped and completed prep times", () => {
    // Skipped meals took 23 minutes longer — strong quick-meal preference.
    expect(derivePrefersQuickMeals(summary())).toBe(1);
  });

  it("says nothing when there is barely anything skipped to compare", () => {
    const s = summary({ adherence: { ...summary().adherence, skipped: 1 } });
    expect(derivePrefersQuickMeals(s)).toBeNull();
  });

  it("says nothing when prep times are missing", () => {
    const s = summary({
      prepTime: { ...summary().prepTime, avgSkipped: null },
    });
    expect(derivePrefersQuickMeals(s)).toBeNull();
  });
});

describe("deriveHardDays", () => {
  it("names the days the user follows the plan markedly less on", () => {
    // Overall 0.69; Sunday 0.4 and Saturday 0.5 sit more than 0.2 below.
    expect(deriveHardDays(summary())).toEqual([0, 6]);
  });

  it("ignores a bad day that rests on almost no data", () => {
    const s = summary({
      adherence: {
        ...summary().adherence,
        byDayOfWeek: { ...summary().adherence.byDayOfWeek, 0: rate(0, 0, 1) },
      },
    });
    expect(deriveHardDays(s)).not.toContain(0);
  });
});

describe("deriveEffectiveMaxPrep", () => {
  it("anchors on what the user finished, not what they were given", () => {
    // avgCompleted 15 → 25, clamped into the 15–45 band.
    expect(deriveEffectiveMaxPrep(summary())).toBe(25);
  });

  it("stays quiet until enough meals have actually been made", () => {
    const s = summary({ adherence: { ...summary().adherence, completed: 2 } });
    expect(deriveEffectiveMaxPrep(s)).toBeNull();
  });
});

describe("deriveProfile", () => {
  it("produces the living profile from arithmetic alone", () => {
    const p = deriveProfile(summary());

    expect(p.confidence).toBe("high");
    expect(p.behavior.dinnerAdherence).toBe(0.5);
    expect(p.behavior.breakfastAdherence).toBe(0.87);
    expect(p.behavior.weekendAdherence).toBe(0.46);
    expect(p.behavior.varietyTolerance).toBe(0.28);
    expect(p.context.busyDays).toEqual([0, 6]);
    expect(p.context.lowMotivationDays).toEqual([4]);
    expect(p.context.lowMoodAdherenceDrop).toBe(0.35);
    expect(p.preferences.avoidMeals).toEqual(["tofu curry"]);
  });

  it("raises exactly the directives the numbers support", () => {
    const d = deriveProfile(summary()).planningDirectives;

    expect(d.simplifySlots).toEqual(["dinner"]);
    expect(d.weekendNeedsOwnShape).toBe(true);
    expect(d.reduceLateEating).toBe(true);
    // 18 distinct dishes is a normal rotation, however often they repeat.
    expect(d.increaseVariety).toBe(false);
    expect(d.emphasiseMacro).toBe("protein");
    expect(d.maxPrepMinutes).toBe(25);
  });

  it("asks for variety only when the rotation is genuinely narrow", () => {
    const narrow = summary({
      variety: { distinctMeals: 4, totalMeals: 65, repeatRate: 0.94, mostRepeated: [] },
    });
    expect(deriveProfile(narrow).planningDirectives.increaseVariety).toBe(true);
  });

  it("raises no directives at all when the data is too thin to act on", () => {
    const thin = summary({
      period: { days: 30, start: "", end: "", daysWithAnyData: 2 },
      adherence: { ...summary().adherence, plannedMeals: 4 },
    });
    const d = deriveProfile(thin).planningDirectives;

    expect(deriveProfile(thin).confidence).toBe("insufficient");
    expect(d.simplifySlots).toEqual([]);
    expect(d.weekendNeedsOwnShape).toBe(false);
    expect(d.reduceLateEating).toBe(false);
    expect(d.increaseVariety).toBe(false);
    expect(d.emphasiseMacro).toBeNull();
  });

  it("does not call a slot complicated when the skipped ones were the quick ones", () => {
    const s = summary({
      prepTime: {
        ...summary().prepTime,
        bySlot: {
          ...summary().prepTime.bySlot,
          dinner: { avgCompleted: 40, avgSkipped: 8 },
        },
      },
    });
    expect(deriveProfile(s).planningDirectives.simplifySlots).toEqual([]);
  });
});
