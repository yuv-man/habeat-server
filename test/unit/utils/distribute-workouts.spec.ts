import { distributeWorkouts } from "../../../src/utils/helpers";

const dayToName: Record<number, string> = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
  0: "sunday",
};
const nameToDay: Record<string, number> = Object.fromEntries(
  Object.entries(dayToName).map(([n, name]) => [name, Number(n)]),
);

const workout = (name: string) => ({ name, category: "strength", duration: 40, caloriesBurned: 300, done: false });

/** 3 sessions a week: Mon, Wed, Sat (workout-schedule.ts). */
const MON_WED_SAT = [1, 3, 6];

describe("distributeWorkouts", () => {
  it("keeps the model's workout on a workout day when the week starts mid-week", () => {
    // A plan made on a Wednesday is generated as Wednesday first: no Monday.
    // The model's session used to go to the absent Monday and be dropped.
    const days = [{ day: "wednesday", workouts: [workout("Upper Body Push")] }];
    distributeWorkouts(days, MON_WED_SAT, dayToName, nameToDay);
    expect(days[0].workouts.map((w) => w.name)).toEqual(["Upper Body Push"]);
  });

  it("keeps it for the later part of the week too", () => {
    const days = [
      { day: "thursday", workouts: [] as any[] },
      { day: "friday", workouts: [] as any[] },
      { day: "saturday", workouts: [workout("Lower Body Strength")] },
      { day: "sunday", workouts: [] as any[] },
    ];
    distributeWorkouts(days, MON_WED_SAT, dayToName, nameToDay);
    expect(days[2].workouts.map((w) => w.name)).toEqual(["Lower Body Strength"]);
    expect(days[0].workouts).toEqual([]);
    expect(days[3].workouts).toEqual([]);
  });

  it("gives no workouts to a part of the week with no workout day", () => {
    const days = [
      { day: "thursday", workouts: [workout("Stray")] },
      { day: "friday", workouts: [] as any[] },
    ];
    distributeWorkouts(days, MON_WED_SAT, dayToName, nameToDay);
    expect(days.every((d) => d.workouts.length === 0)).toBe(true);
  });

  it("still fills a whole week's workout days", () => {
    const names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const days = names.map((day) => ({ day, workouts: [] as any[] }));
    days[0].workouts = [workout("A"), workout("B"), workout("C")];
    distributeWorkouts(days, MON_WED_SAT, dayToName, nameToDay);
    expect(days.map((d) => d.workouts.length)).toEqual([1, 0, 1, 0, 0, 1, 0]);
  });
});
