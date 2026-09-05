/**
 * Risk windows — when, concretely, a user's eating pattern tends to fire.
 *
 * Both the behaviour profile and the CBT insight endpoint need the same
 * "bucket these events into 3-hour slots and find the concentration" logic, and
 * both previously either duplicated it or threw the result away at display time
 * (pattern cards showed a fixed string like "After 9 PM" regardless of what the
 * user's own data said). This is the single implementation.
 */

/** Width of a bucket, in hours. Three hours is coarse enough to be stable at
 *  low data volumes and narrow enough to be actionable ("3–6 PM"). */
export const WINDOW_HOURS = 3;

export interface TimeWindow {
  /** Start of the dominant bucket, 0–23. */
  hourStart: number;
  /** Exclusive end of the bucket. */
  hourEnd: number;
  /** Days of week (0=Sun) this window concentrates on; empty means "spread out". */
  days: number[];
  /** How many events fell inside the window. */
  occurrences: number;
  /** Share of this pattern's events that fell inside the window, 0–1. */
  share: number;
}

export interface RiskWindow {
  dayOfWeek: number;
  hourStart: number;
  hourEnd: number;
  risk: "medium" | "high";
}

const bucketOf = (d: Date): number => Math.floor(d.getHours() / WINDOW_HOURS) * WINDOW_HOURS;

/**
 * Find the single time-of-day window a set of events concentrates in.
 *
 * Returns null when there is not enough signal to claim a pattern — better to
 * say nothing than to tell a user they stress-eat at 4 PM on the basis of one
 * logged meal.
 */
export const computeDominantWindow = (
  timestamps: Date[],
  opts: { minOccurrences?: number; minShare?: number } = {},
): TimeWindow | null => {
  const { minOccurrences = 2, minShare = 0.34 } = opts;

  const valid = timestamps.filter((d) => d instanceof Date && !isNaN(d.getTime()));
  if (valid.length < minOccurrences) return null;

  const buckets = new Map<number, Date[]>();
  for (const d of valid) {
    const b = bucketOf(d);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(d);
  }

  const [hourStart, members] = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0] - b[0],
  )[0];

  const occurrences = members.length;
  const share = occurrences / valid.length;
  if (occurrences < minOccurrences || share < minShare) return null;

  // Only name specific days when the window genuinely clusters on a few of
  // them; otherwise it is an everyday pattern and listing days would mislead.
  const dayCounts = new Map<number, number>();
  for (const d of members) {
    dayCounts.set(d.getDay(), (dayCounts.get(d.getDay()) ?? 0) + 1);
  }
  const distinctDays = [...dayCounts.keys()];
  const days =
    distinctDays.length <= 3 && occurrences >= 2
      ? distinctDays.sort(
          (a, b) => (dayCounts.get(b) ?? 0) - (dayCounts.get(a) ?? 0) || a - b,
        )
      : [];

  return {
    hourStart,
    hourEnd: hourStart + WINDOW_HOURS,
    days,
    occurrences,
    share: Math.round(share * 100) / 100,
  };
};

/**
 * Day-of-week × time-of-day buckets where emotional eating dominates.
 * A bucket qualifies at ≥2 observations and ≥50% emotional; ≥75% is "high".
 */
export const computeRiskWindows = (
  events: { at: Date; emotional: boolean }[],
  limit = 5,
): RiskWindow[] => {
  const counts = new Map<string, { emotional: number; total: number }>();

  for (const { at, emotional } of events) {
    if (!(at instanceof Date) || isNaN(at.getTime())) continue;
    const key = `${at.getDay()}-${bucketOf(at)}`;
    if (!counts.has(key)) counts.set(key, { emotional: 0, total: 0 });
    const bucket = counts.get(key)!;
    bucket.total++;
    if (emotional) bucket.emotional++;
  }

  return [...counts.entries()]
    .filter(([, v]) => v.total >= 2 && v.emotional / v.total >= 0.5)
    .map(([key, v]) => {
      const [dayOfWeek, hourStart] = key.split("-").map(Number);
      const rate = v.emotional / v.total;
      return {
        dayOfWeek,
        hourStart,
        hourEnd: hourStart + WINDOW_HOURS,
        risk: (rate >= 0.75 ? "high" : "medium") as "high" | "medium",
      };
    })
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hourStart - b.hourStart)
    .slice(0, limit);
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "3–6 PM", "9 AM–12 PM", "12–3 AM" */
export const formatHourRange = (hourStart: number, hourEnd: number): string => {
  const meridiem = (h: number) => (h < 12 || h === 24 ? "AM" : "PM");
  const to12 = (h: number) => {
    const m = h % 24;
    if (m === 0) return 12;
    return m > 12 ? m - 12 : m;
  };

  const startM = meridiem(hourStart);
  const endM = meridiem(hourEnd);

  return startM === endM
    ? `${to12(hourStart)}–${to12(hourEnd)} ${endM}`
    : `${to12(hourStart)} ${startM}–${to12(hourEnd)} ${endM}`;
};

/** "Tue & Thu", "Mon, Wed & Fri", "" when the pattern is spread across the week. */
export const formatDays = (days: number[]): string => {
  const names = days.map((d) => DAY_NAMES[d]).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
};

/** "Tue & Thu, 3–6 PM" or "3–6 PM, most days". */
export const formatWindow = (w: TimeWindow): string => {
  const hours = formatHourRange(w.hourStart, w.hourEnd);
  const days = formatDays(w.days);
  return days ? `${days}, ${hours}` : `${hours}, most days`;
};
