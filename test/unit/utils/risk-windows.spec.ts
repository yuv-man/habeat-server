import {
  computeDominantWindow,
  computeRiskWindows,
  formatHourRange,
  formatDays,
  formatWindow,
} from "../../../src/utils/risk-windows";

/** Build a Date at a given weekday-of-a-known-week and hour. 2026-07-27 is a Monday. */
const at = (dayOffsetFromMonday: number, hour: number) =>
  new Date(2026, 6, 27 + dayOffsetFromMonday, hour, 0, 0);

describe("computeDominantWindow", () => {
  it("returns null below the minimum number of observations", () => {
    expect(computeDominantWindow([])).toBeNull();
    expect(computeDominantWindow([at(0, 16)])).toBeNull();
  });

  it("finds the 3-hour slot events cluster in", () => {
    const w = computeDominantWindow([at(0, 16), at(2, 17), at(4, 16)]);
    expect(w).not.toBeNull();
    expect(w!.hourStart).toBe(15);
    expect(w!.hourEnd).toBe(18);
    expect(w!.occurrences).toBe(3);
    expect(w!.share).toBe(1);
  });

  it("names the specific days when the pattern clusters on a few", () => {
    // Mon and Wed, both mid-afternoon
    const w = computeDominantWindow([at(0, 16), at(2, 17)]);
    expect(w!.days).toEqual([1, 3]); // Mon=1, Wed=3
    expect(formatWindow(w!)).toBe("Mon & Wed, 3–6 PM");
  });

  it("omits days when the pattern is spread across the week", () => {
    const w = computeDominantWindow([
      at(0, 16), at(1, 16), at(2, 17), at(3, 16), at(4, 17),
    ]);
    expect(w!.days).toEqual([]);
    expect(formatWindow(w!)).toBe("3–6 PM, most days");
  });

  it("returns null when events are too scattered to claim a window", () => {
    // One event in each of six different slots — no concentration.
    const scattered = [
      at(0, 1), at(1, 4), at(2, 7), at(3, 10), at(4, 13), at(5, 22),
    ];
    expect(computeDominantWindow(scattered)).toBeNull();
  });

  it("ignores invalid dates", () => {
    const w = computeDominantWindow([at(0, 16), at(2, 17), new Date("nope")]);
    expect(w!.occurrences).toBe(2);
  });
});

describe("computeRiskWindows", () => {
  it("returns nothing without at least two observations in a slot", () => {
    expect(computeRiskWindows([{ at: at(0, 16), emotional: true }])).toEqual([]);
  });

  it("flags a slot where emotional eating dominates", () => {
    const windows = computeRiskWindows([
      { at: at(0, 16), emotional: true },
      { at: at(7, 17), emotional: true },
    ]);
    expect(windows).toEqual([
      { dayOfWeek: 1, hourStart: 15, hourEnd: 18, risk: "high" },
    ]);
  });

  it("grades a half-emotional slot as medium, not high", () => {
    const windows = computeRiskWindows([
      { at: at(0, 16), emotional: true },
      { at: at(7, 17), emotional: false },
    ]);
    expect(windows[0].risk).toBe("medium");
  });

  it("excludes slots where emotional eating is the minority", () => {
    expect(
      computeRiskWindows([
        { at: at(0, 16), emotional: true },
        { at: at(7, 17), emotional: false },
        { at: at(14, 16), emotional: false },
      ]),
    ).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats hour ranges within one meridiem", () => {
    expect(formatHourRange(15, 18)).toBe("3–6 PM");
    expect(formatHourRange(6, 9)).toBe("6–9 AM");
  });

  it("formats hour ranges crossing noon and midnight", () => {
    expect(formatHourRange(9, 12)).toBe("9 AM–12 PM");
    expect(formatHourRange(21, 24)).toBe("9 PM–12 AM");
    expect(formatHourRange(0, 3)).toBe("12–3 AM");
  });

  it("formats day lists", () => {
    expect(formatDays([])).toBe("");
    expect(formatDays([2])).toBe("Tue");
    expect(formatDays([2, 4])).toBe("Tue & Thu");
    expect(formatDays([1, 3, 5])).toBe("Mon, Wed & Fri");
  });
});
