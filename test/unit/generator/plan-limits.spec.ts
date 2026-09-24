import { freePlanAllowed, startOfWeek } from "../../../src/generator/plan-limits";

// Thursday 24 Sep 2026, 14:00 local.
const THU = new Date(2026, 8, 24, 14);

describe("free plan limit", () => {
  it("starts the week on Monday", () => {
    expect(startOfWeek(THU)).toEqual(new Date(2026, 8, 21));
    // Sunday belongs to the week that started the Monday before.
    expect(startOfWeek(new Date(2026, 8, 27, 23))).toEqual(new Date(2026, 8, 21));
  });

  it("lets a new user make their first plan", () => {
    expect(freePlanAllowed(null, THU)).toBe(true);
  });

  it("allows one plan a week", () => {
    expect(freePlanAllowed({ createdAt: new Date(2026, 8, 22, 9) }, THU)).toBe(false);
    expect(freePlanAllowed({ createdAt: new Date(2026, 8, 20, 22) }, THU)).toBe(true);
  });

  it("does not count a plan that failed to generate", () => {
    expect(freePlanAllowed({ createdAt: new Date(2026, 8, 24, 9), generationStatus: "failed" }, THU)).toBe(true);
  });
});
