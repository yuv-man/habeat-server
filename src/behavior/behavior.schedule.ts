/**
 * When the profile refresh runs.
 *
 * The refresh is the one part of this system that calls a model, so it is kept
 * away from anything a person is waiting on and put somewhere they will never
 * see it: the middle of the night, before the morning they ask for a plan.
 *
 * Anchoring to a local hour rather than "every 24 hours from boot" matters —
 * an interval started at boot drifts to whatever time the last deploy happened,
 * which is as likely to be the middle of the working day as not.
 */

/** Local hour the nightly refresh runs at. */
export const REFRESH_HOUR = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds until the next occurrence of `hour` in local time.
 * Always strictly positive: at exactly the hour, it waits for tomorrow rather
 * than firing repeatedly through the minute.
 */
export const msUntilNextLocalHour = (hour: number, from: Date = new Date()): number => {
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - from.getTime();
};

/**
 * Run `task` at the next `hour` and every 24 hours after.
 * Returns a cancel function; timers are unref'd so they never hold a process
 * open on their own.
 */
export const scheduleDailyAt = (
  hour: number,
  task: () => void,
): (() => void) => {
  let interval: NodeJS.Timeout | null = null;

  const timeout = setTimeout(() => {
    task();
    interval = setInterval(task, DAY_MS);
    interval.unref?.();
  }, msUntilNextLocalHour(hour));
  timeout.unref?.();

  return () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
};
