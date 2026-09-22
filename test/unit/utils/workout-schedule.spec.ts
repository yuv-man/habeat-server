import { weeklyWorkoutDays, WORKOUT_PATTERNS } from "../../../src/utils/workout-schedule";

const WEEKEND = new Set([0, 6]);

describe("weeklyWorkoutDays", () => {
  it("gives a 4x/week runner weekday sessions, not just weekends", () => {
    // A plan made on a Saturday used to put all four sessions on Sat/Sun.
    const days = weeklyWorkoutDays(4);
    expect(days).toHaveLength(4);
    expect(days.filter((d) => !WEEKEND.has(d)).length).toBeGreaterThanOrEqual(2);
  });

  it("has exactly n distinct days for every n", () => {
    for (let n = 0; n <= 7; n++) {
      const days = weeklyWorkoutDays(n);
      expect(new Set(days).size).toBe(n);
      days.forEach((d) => expect(d).toBeGreaterThanOrEqual(0));
    }
  });

  it("leaves a rest day between sessions up to 4 a week", () => {
    for (let n = 2; n <= 4; n++) {
      const sorted = [...WORKOUT_PATTERNS[n]].map((d) => (d === 0 ? 7 : d)).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it("clamps nonsense input", () => {
    expect(weeklyWorkoutDays(undefined)).toEqual([]);
    expect(weeklyWorkoutDays(12)).toHaveLength(7);
    expect(weeklyWorkoutDays(-3)).toEqual([]);
  });

  it("does not hand out the shared pattern array", () => {
    weeklyWorkoutDays(3).push(99);
    expect(WORKOUT_PATTERNS[3]).not.toContain(99);
  });
});
