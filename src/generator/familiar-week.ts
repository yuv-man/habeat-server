/**
 * The familiar week: repetition by design.
 *
 * A plan where every one of 28 meals is a new dish is a plan nobody follows —
 * new shopping, new cooking, a new decision at every meal. Real weeks repeat:
 * the same breakfast most mornings, a couple of go-to snacks, last night's
 * dinner for lunch. Habeat is about habits people keep (docs/the-repertoire.md),
 * so the plan repeats on purpose:
 *
 *   - Breakfast: one breakfast every weekday, one every weekend day.
 *   - Snacks: two snacks, alternating.
 *   - Cook once, eat twice: some dinners come back as the next day's lunch.
 *
 * Applied in code to the stored plan rather than asked of the model: a model
 * told to repeat things repeats them unreliably, and the anchors can come
 * from separate generation requests (today is generated first, the rest of
 * the week afterwards). Idempotent — the anchor is always the earliest day of
 * its group — so it can run again after every generation phase.
 */

import { scaleMeal } from "./calorie-balance";

/** Lunches (by weekday, 0 = Sunday) that are the previous day's dinner. */
export const LEFTOVER_LUNCH_DAYS = new Set([2, 4]); // Tue ← Mon, Thu ← Wed

export interface FamiliarWeekStats {
  breakfastRepeats: number;
  snackRepeats: number;
  leftoverLunches: number;
}

const parseKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const toKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Monday of the date's week, as a key — groups a plan into calendar weeks. */
const weekOf = (key: string): string => {
  const d = parseKey(key);
  const back = (d.getDay() + 6) % 7; // Mon → 0 … Sun → 6
  d.setDate(d.getDate() - back);
  return toKey(d);
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Copy of `source` standing in for `replaced`, keeping the replaced meal's slot. */
const repeatOf = (source: any, replaced: any, extra: Record<string, unknown>) => ({
  ...clone(source),
  category: replaced?.category ?? source.category,
  done: false,
  ...extra,
});

export const applyFamiliarWeek = (
  weeklyPlan: Record<string, any>,
): { weeklyPlan: Record<string, any>; stats: FamiliarWeekStats } => {
  const stats: FamiliarWeekStats = { breakfastRepeats: 0, snackRepeats: 0, leftoverLunches: 0 };
  const keys = Object.keys(weeklyPlan).sort();

  const weeks = new Map<string, string[]>();
  for (const k of keys) {
    const w = weekOf(k);
    weeks.set(w, [...(weeks.get(w) ?? []), k]);
  }

  for (const days of weeks.values()) {
    // ── breakfast: one for weekdays, one for the weekend ──
    for (const weekend of [false, true]) {
      const group = days.filter((k) => [0, 6].includes(parseKey(k).getDay()) === weekend);
      const anchorKey = group.find((k) => weeklyPlan[k]?.meals?.breakfast);
      if (!anchorKey) continue;
      const anchor = weeklyPlan[anchorKey].meals.breakfast;
      for (const k of group) {
        const meals = weeklyPlan[k]?.meals;
        if (!meals?.breakfast || k === anchorKey) continue;
        // Already a repeat of this anchor (an earlier pass): leave it — the
        // user may have ticked it off.
        if (meals.breakfast.repeatOf === anchorKey) continue;
        meals.breakfast = repeatOf(anchor, meals.breakfast, { repeatOf: anchorKey });
        stats.breakfastRepeats++;
      }
    }

    // ── snacks: two, alternating ──
    const withSnack = days.filter((k) => weeklyPlan[k]?.meals?.snacks?.[0]);
    const snackAnchors = withSnack.slice(0, 2);
    withSnack.forEach((k, i) => {
      if (i < 2) return;
      const anchorKey = snackAnchors[i % 2];
      const meals = weeklyPlan[k].meals;
      if (meals.snacks[0].repeatOf === anchorKey) return;
      meals.snacks[0] = repeatOf(weeklyPlan[anchorKey].meals.snacks[0], meals.snacks[0], {
        repeatOf: anchorKey,
      });
      stats.snackRepeats++;
    });

    // ── cook once, eat twice ──
    for (const k of days) {
      if (!LEFTOVER_LUNCH_DAYS.has(parseKey(k).getDay())) continue;
      const prev = parseKey(k);
      prev.setDate(prev.getDate() - 1);
      const prevKey = toKey(prev);
      const dinner = weeklyPlan[prevKey]?.meals?.dinner;
      const meals = weeklyPlan[k]?.meals;
      if (!dinner || !meals?.lunch || meals.lunch.leftoverOf === prevKey) continue;

      // Keep the day's total: the leftover portion takes the lunch it replaces'
      // calories, within the same limits as any other portion change.
      const leftover = repeatOf(dinner, meals.lunch, { leftoverOf: prevKey });
      const want = Number(meals.lunch.calories) || 0;
      const have = Number(dinner.calories) || 0;
      if (want > 0 && have > 0) scaleMeal(leftover, Math.min(1.5, Math.max(0.5, want / have)));
      meals.lunch = leftover;
      dinner.makesLeftovers = true;
      stats.leftoverLunches++;
    }
  }

  return { weeklyPlan, stats };
};
