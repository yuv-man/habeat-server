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
import { isOwnAsIs } from "./own-dishes";

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
        // A missing breakfast is filled too: the generator leaves repeat slots
        // out of the prompt (familiarWeekFills) rather than pay for a dish that
        // would be replaced here.
        if (!meals || k === anchorKey) continue;
        // Already a repeat of this anchor (an earlier pass): leave it — the
        // user may have ticked it off.
        if (meals.breakfast?.repeatOf === anchorKey) continue;
        meals.breakfast = repeatOf(anchor, meals.breakfast, { repeatOf: anchorKey });
        stats.breakfastRepeats++;
      }
    }

    // ── snacks: two, alternating ──
    const snackAnchors = days.filter((k) => weeklyPlan[k]?.meals?.snacks?.[0]).slice(0, 2);
    // Every other day of the week gets one of the two — including a day whose
    // snack was left out of the prompt on purpose.
    days
      .filter((k) => weeklyPlan[k]?.meals && !snackAnchors.includes(k))
      .forEach((k, i) => {
        if (!snackAnchors.length) return;
        const anchorKey = snackAnchors[i % snackAnchors.length];
        const meals = weeklyPlan[k].meals;
        if (meals.snacks?.[0]?.repeatOf === anchorKey) return;
        const repeat = repeatOf(weeklyPlan[anchorKey].meals.snacks[0], meals.snacks?.[0], {
          repeatOf: anchorKey,
        });
        meals.snacks = Array.isArray(meals.snacks) && meals.snacks.length ? meals.snacks : [];
        meals.snacks[0] = repeat;
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
      if (!dinner || !meals || meals.lunch?.leftoverOf === prevKey) continue;
      // Never over a dish the user cooks: it was placed on purpose, and one
      // week's schnitzel vanished under Wednesday's soup this way.
      if (meals.lunch?.fromRepertoire && !meals.lunch.leftoverOf) continue;

      // Keep the day's total: the leftover portion takes the lunch it replaces'
      // calories, within the same limits as any other portion change. A lunch
      // left out of the prompt has no size to take; the portion stays.
      const leftover = repeatOf(dinner, meals.lunch, { leftoverOf: prevKey });
      const want = Number(meals.lunch?.calories) || 0;
      const have = Number(dinner.calories) || 0;
      // Their own dish keeps their portion here too; the day balances around it.
      if (want > 0 && have > 0 && !isOwnAsIs(dinner)) {
        scaleMeal(leftover, Math.min(1.5, Math.max(0.5, want / have)));
      }
      meals.lunch = leftover;
      dinner.makesLeftovers = true;
      stats.leftoverLunches++;
    }
  }

  return { weeklyPlan, stats };
};

/**
 * The slots applyFamiliarWeek will fill itself, for a plan covering `planKeys`
 * — breakfasts after each group's first, snacks after the first two days,
 * leftover lunches. The generator leaves these out of the prompt: it used to
 * pay for a dish in each and then throw it away here. Only slots in
 * `activeSlots` are returned, as "YYYY-MM-DD|slot".
 */
export const familiarWeekFills = (
  planKeys: string[],
  activeSlots: string[] = ["breakfast", "lunch", "dinner", "snack"],
): Set<string> => {
  const fills = new Set<string>();
  const keys = [...new Set(planKeys)].sort();
  const weeks = new Map<string, string[]>();
  for (const k of keys) weeks.set(weekOf(k), [...(weeks.get(weekOf(k)) ?? []), k]);

  for (const days of weeks.values()) {
    if (activeSlots.includes("breakfast")) {
      for (const weekend of [false, true]) {
        const group = days.filter((k) => [0, 6].includes(parseKey(k).getDay()) === weekend);
        group.slice(1).forEach((k) => fills.add(`${k}|breakfast`));
      }
    }
    if (activeSlots.includes("snack")) days.slice(2).forEach((k) => fills.add(`${k}|snack`));
    if (activeSlots.includes("lunch") && activeSlots.includes("dinner")) {
      for (const k of days) {
        if (!LEFTOVER_LUNCH_DAYS.has(parseKey(k).getDay())) continue;
        const prev = parseKey(k);
        prev.setDate(prev.getDate() - 1);
        if (days.includes(toKey(prev))) fills.add(`${k}|lunch`);
      }
    }
  }
  return fills;
};
