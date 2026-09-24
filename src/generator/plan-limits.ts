/**
 * How often a free user may have a new weekly plan made: once per calendar
 * week (Monday to Sunday, local time). Every plan is paid model calls; before
 * this a free user could generate five an hour. Paying users are not limited
 * here (only by the request throttle).
 */

/** Monday 00:00 of the week `now` falls in, local time. */
export const startOfWeek = (now: Date): Date => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; // Mon → 0 … Sun → 6
  d.setDate(d.getDate() - back);
  return d;
};

/**
 * Whether a free user may generate now, given their current plan. No plan, a
 * plan from an earlier week, or one that failed to generate: yes. A plan
 * already made this week: no — it is the week's plan.
 */
export const freePlanAllowed = (
  plan: { createdAt?: Date | string | null; generationStatus?: string | null } | null,
  now: Date = new Date(),
): boolean => {
  if (!plan?.createdAt) return true;
  if (plan.generationStatus === "failed") return true;
  return new Date(plan.createdAt).getTime() < startOfWeek(now).getTime();
};

export const FREE_PLAN_LIMIT_MESSAGE =
  "The free plan includes one new meal plan a week. Your next one is ready to make on Monday — or upgrade to Plus to make a new plan anytime.";
