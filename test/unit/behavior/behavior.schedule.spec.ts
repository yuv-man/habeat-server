import {
  msUntilNextLocalHour,
  scheduleDailyAt,
  REFRESH_HOUR,
} from "../../../src/behavior/behavior.schedule";

describe("msUntilNextLocalHour", () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 7, h, m, 0, 0);

  it("waits until later today when the hour has not passed", () => {
    expect(msUntilNextLocalHour(3, at(1, 0))).toBe(2 * 60 * 60 * 1000);
  });

  it("rolls over to tomorrow once the hour has gone", () => {
    expect(msUntilNextLocalHour(3, at(9, 0))).toBe(18 * 60 * 60 * 1000);
  });

  it("waits a full day when called exactly on the hour", () => {
    // Otherwise the task would re-fire for every tick of that minute.
    expect(msUntilNextLocalHour(3, at(3, 0))).toBe(24 * 60 * 60 * 1000);
  });

  it("always returns a positive delay, whatever the hour", () => {
    for (let h = 0; h < 24; h++) {
      const ms = msUntilNextLocalHour(REFRESH_HOUR, at(h, 30));
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });
});

describe("scheduleDailyAt", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fires at the hour and then every day", () => {
    jest.setSystemTime(new Date(2026, 8, 7, 1, 0, 0, 0));
    const task = jest.fn();
    const cancel = scheduleDailyAt(3, task);

    jest.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(task).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(task).toHaveBeenCalledTimes(2);

    cancel();
    jest.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not run before its hour — a deploy at noon must not trigger it", () => {
    jest.setSystemTime(new Date(2026, 8, 7, 12, 0, 0, 0));
    const task = jest.fn();
    const cancel = scheduleDailyAt(3, task);

    jest.advanceTimersByTime(14 * 60 * 60 * 1000);
    expect(task).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(task).toHaveBeenCalledTimes(1);
    cancel();
  });
});
