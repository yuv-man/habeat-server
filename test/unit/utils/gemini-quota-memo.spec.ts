import {
  markModelExhausted,
  isModelExhausted,
  resetExhaustedModels,
} from "../../../src/utils/gemini-rate-limiter";

describe("daily quota memo", () => {
  beforeEach(() => resetExhaustedModels());

  it("reports a model as available until it is marked", () => {
    expect(isModelExhausted("gemini-3.5-flash")).toBe(false);
  });

  it("remembers an exhausted model", () => {
    markModelExhausted("gemini-3.5-flash");
    expect(isModelExhausted("gemini-3.5-flash")).toBe(true);
  });

  it("only affects the model that ran out", () => {
    markModelExhausted("gemini-3.5-flash");
    expect(isModelExhausted("gemini-2.5-flash")).toBe(false);
  });

  it("expires when the Pacific date rolls over", () => {
    // Free-tier quota resets at midnight US/Pacific, so a memo recorded
    // yesterday must not keep a model benched today.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-03T12:00:00-07:00"));
    markModelExhausted("gemini-3.5-flash");
    expect(isModelExhausted("gemini-3.5-flash")).toBe(true);

    jest.setSystemTime(new Date("2026-08-04T00:30:00-07:00"));
    expect(isModelExhausted("gemini-3.5-flash")).toBe(false);

    jest.useRealTimers();
  });

  it("holds the memo across the UTC rollover that is still the same Pacific day", () => {
    // 2026-08-03 18:00 Pacific is already 2026-08-04 in UTC. Keying off UTC
    // would wrongly free the model six hours before Google actually resets it.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-03T18:00:00-07:00"));
    markModelExhausted("gemini-3.5-flash");

    jest.setSystemTime(new Date("2026-08-03T23:00:00-07:00"));
    expect(isModelExhausted("gemini-3.5-flash")).toBe(true);

    jest.useRealTimers();
  });
});
