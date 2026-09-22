import {
  TuneStateError,
  acceptLevel,
  clampToAvailable,
  rejectLevel,
} from "../../../src/repertoire/repertoire.tune-state";

const tune = (level: 1 | 2 | 3) => ({
  level,
  changes: ["x"],
  ingredients: [],
  nutritionPerServing: { calories: 500, protein: 30, carbs: 50, fat: 20 },
  rejections: 0,
});

const dish = (over: any = {}) => ({
  tunes: [tune(1), tune(2), tune(3)],
  currentTuneLevel: 0 as const,
  tuneCeiling: 3 as const,
  ...over,
});

describe("acceptLevel", () => {
  it("makes the level current and stamps it", () => {
    const at = new Date("2026-09-18T10:00:00Z");
    const s = acceptLevel(dish(), 2, at);
    expect(s.currentTuneLevel).toBe(2);
    expect(s.tunes[1].acceptedAt).toBe(at);
  });

  it("lifts a pinned ceiling when the user asks for the level themselves", () => {
    expect(acceptLevel(dish({ tuneCeiling: 1 }), 2).tuneCeiling).toBe(2);
  });

  it("always allows going back to as-usual", () => {
    expect(acceptLevel(dish({ currentTuneLevel: 2 }), 0).currentTuneLevel).toBe(0);
  });

  it("refuses a level with no tune", () => {
    expect(() => acceptLevel(dish({ tunes: [tune(1)] }), 2)).toThrow(TuneStateError);
  });

  it("does not mutate the dish it was given", () => {
    const d = dish();
    acceptLevel(d, 1);
    expect(d.tunes[0]).not.toHaveProperty("acceptedAt");
  });
});

describe("rejectLevel", () => {
  it("drops the dish below the rejected level, without pinning it the first time", () => {
    const s = rejectLevel(dish({ currentTuneLevel: 2 }), 2);
    expect(s.currentTuneLevel).toBe(1);
    expect(s.tuneCeiling).toBe(3);
    expect(s.tunes[1].rejections).toBe(1);
  });

  it("pins the dish below a level rejected twice", () => {
    const once = rejectLevel(dish({ currentTuneLevel: 2 }), 2);
    const twice = rejectLevel({ ...dish(), ...once }, 2);
    expect(twice.tuneCeiling).toBe(1);
  });

  it("leaves a lower current level alone", () => {
    expect(rejectLevel(dish({ currentTuneLevel: 1 }), 3).currentTuneLevel).toBe(1);
  });
});

describe("clampToAvailable", () => {
  it("keeps the current level only while its tune still exists", () => {
    expect(clampToAvailable(2, [tune(1), tune(2), tune(3)])).toBe(2);
    expect(clampToAvailable(3, [tune(1)])).toBe(1);
    expect(clampToAvailable(2, [])).toBe(0);
  });
});
