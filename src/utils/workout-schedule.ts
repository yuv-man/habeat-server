/**
 * Which weekdays are training days, for a given number of sessions per week.
 *
 * Used to be derived from "today through Sunday" at generation time: sessions
 * were spread over whatever days were left in the current week. A plan made on
 * a Saturday put every session on a weekend — including next week's, since
 * that request computed from the same Saturday — so a runner training four
 * times a week got runs on Saturday and Sunday only.
 *
 * A fixed weekly pattern doesn't depend on when the plan was generated, keeps
 * rest days between sessions, and is the same every week, which is what a
 * training routine is.
 *
 * Weekday numbers follow Date#getDay(): 0 = Sunday … 6 = Saturday.
 */
export const WORKOUT_PATTERNS: Record<number, number[]> = {
  0: [],
  1: [6], // Sat
  2: [2, 6], // Tue, Sat
  3: [1, 3, 6], // Mon, Wed, Sat
  4: [1, 3, 5, 0], // Mon, Wed, Fri, Sun
  5: [1, 2, 4, 5, 0], // Mon, Tue, Thu, Fri, Sun
  6: [1, 2, 3, 5, 6, 0], // rest Thursday
  7: [1, 2, 3, 4, 5, 6, 0],
};

export const weeklyWorkoutDays = (sessionsPerWeek: number | undefined | null): number[] => {
  const n = Math.max(0, Math.min(7, Math.round(Number(sessionsPerWeek) || 0)));
  return [...WORKOUT_PATTERNS[n]];
};
