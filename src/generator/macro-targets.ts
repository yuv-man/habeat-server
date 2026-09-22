/**
 * Macros, not just calories.
 *
 * Calories are now hit almost exactly (calorie-balance.ts), but a day can land
 * on 2,800 kcal and still be wrong: one real week came in 26% under its carb
 * target and 53% over on fat — for a runner, the two macros that matter most.
 * Portion-scaling a meal cannot fix that, because scaling moves every macro by
 * the same factor.
 *
 * Three pieces here:
 *
 *  1. `slotMacroTargets` — what each meal of the day should carry. Split by the
 *     slot's share of the day's calories, so the parts add up to the whole. (The
 *     old per-slot split assigned 175% of the day's carbs and 115% of its fat.)
 *  2. `dayMacroError` — how far a finished day actually is from target.
 *  3. `nudgeDayMacros` — the correction: grow the meal richest in what is short,
 *     shrink the meal richest in what is over, keeping the day's calories where
 *     they are. It changes portions, never dishes, so the week stays the week
 *     the user was shown.
 */

import { scaleMeal } from "./calorie-balance";
import { MealSlot, slotCalorieShares } from "./meal-plan-prompt";

export type Macro = "protein" | "carbs" | "fat";
export const MACROS: Macro[] = ["protein", "carbs", "fat"];
export const KCAL_PER_GRAM: Record<Macro, number> = { protein: 4, carbs: 4, fat: 9 };

/** A macro this close to target is left alone. */
export const MACRO_TOLERANCE = 0.12;
/** Portion limits for a correction: past this it is a different plate. */
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.3;
/** Corrections per day; each one trades one macro pair. */
const MAX_PASSES = 3;

export interface MacroSet {
  protein: number;
  carbs: number;
  fat: number;
}

/** Each slot's share of the day's macros, proportional to its calorie share. */
export const slotMacroTargets = (
  macros: MacroSet,
  activeSlots: MealSlot[],
): Record<MealSlot, MacroSet> => {
  const shares = slotCalorieShares(activeSlots);
  const out = {} as Record<MealSlot, MacroSet>;
  for (const slot of activeSlots) {
    out[slot] = {
      protein: Math.round(macros.protein * shares[slot]),
      carbs: Math.round(macros.carbs * shares[slot]),
      fat: Math.round(macros.fat * shares[slot]),
    };
  }
  return out;
};

const mealsOf = (day: any): any[] => {
  const m = day?.meals;
  if (!m) return [];
  return [m.breakfast, m.lunch, m.dinner, ...(Array.isArray(m.snacks) ? m.snacks : [])].filter(
    (x) => x && typeof x.calories === "number",
  );
};

export const dayMacroTotals = (day: any): MacroSet =>
  mealsOf(day).reduce(
    (acc, meal) => ({
      protein: acc.protein + (Number(meal.macros?.protein) || 0),
      carbs: acc.carbs + (Number(meal.macros?.carbs) || 0),
      fat: acc.fat + (Number(meal.macros?.fat) || 0),
    }),
    { protein: 0, carbs: 0, fat: 0 },
  );

/** Signed share off target per macro: +0.2 is 20% over, -0.2 is 20% under. */
export const dayMacroError = (day: any, target: MacroSet): MacroSet => {
  const totals = dayMacroTotals(day);
  const err = {} as MacroSet;
  for (const macro of MACROS) {
    const want = target[macro];
    err[macro] = want > 0 ? (totals[macro] - want) / want : 0;
  }
  return err;
};

export interface MacroNudge {
  date: string;
  grew: string;
  shrank: string;
  /** Total macro error before and after, as a share of target. */
  before: number;
  after: number;
}

const totalError = (totals: MacroSet, target: MacroSet): number =>
  MACROS.reduce(
    (sum, macro) => sum + (target[macro] > 0 ? Math.abs(totals[macro] - target[macro]) / target[macro] : 0),
    0,
  );

const caloriesOf = (meals: any[]): number =>
  meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);

/** Totals if these two meals were scaled by these factors. */
const totalsWith = (meals: any[], a: any, fa: number, b: any, fb: number): MacroSet => {
  const out: MacroSet = { protein: 0, carbs: 0, fat: 0 };
  for (const meal of meals) {
    const factor = meal === a ? fa : meal === b ? fb : 1;
    for (const macro of MACROS) out[macro] += (Number(meal.macros?.[macro]) || 0) * factor;
  }
  return out;
};

/** Portion sizes a person would accept, searched coarsely. */
const FACTORS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3];
/** The day's calories are already on target; a trade may move them this much. */
const CALORIE_DRIFT = 0.03;

/**
 * Correct one day's macro mix by trading portions between two meals.
 *
 * Searched rather than solved: solving for the two macros exactly asks for
 * portions far outside what anyone would serve, and once clamped the result
 * could be worse than doing nothing (it made carbs *more* short while fixing
 * fat). This tries the pairs and the portions that are actually allowed, and
 * only keeps a trade that improves the day.
 *
 * Mutates the day; returns what it did, for the log.
 */
export const nudgeDayMacros = (day: any, target: MacroSet): MacroNudge[] => {
  const done: MacroNudge[] = [];
  const locked = new Set<any>();
  // Measured against where the day started, not the pass before it: small
  // allowances compound, and three passes could walk a macro away from target
  // one step at a time.
  const started = dayMacroTotals(day);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const meals = mealsOf(day);
    if (meals.length < 2) break;

    const totals = dayMacroTotals(day);
    const current = totalError(totals, target);
    if (current <= MACRO_TOLERANCE * MACROS.length) break;

    const dayCalories = caloriesOf(meals);
    const movable = meals.filter((m) => !locked.has(m));

    let best: { a: any; b: any; fa: number; fb: number; score: number } | null = null;
    for (const a of movable) {
      for (const b of movable) {
        if (a === b) continue;
        for (const fa of FACTORS) {
          for (const fb of FACTORS) {
            if (fa === 1 && fb === 1) continue;
            const after = totalsWith(meals, a, fa, b, fb);
            const calories =
              dayCalories +
              (Number(a.calories) || 0) * (fa - 1) +
              (Number(b.calories) || 0) * (fb - 1);
            if (Math.abs(calories - dayCalories) > CALORIE_DRIFT * dayCalories) continue;
            // No robbing Peter to pay Paul: a trade that fixes fat by pushing
            // carbs further from target is not an improvement to a runner, and
            // the totals hid it.
            const worsens = MACROS.some((macro) => {
              if (target[macro] <= 0) return false;
              const wasOff = Math.abs(started[macro] - target[macro]) / target[macro];
              const isOff = Math.abs(after[macro] - target[macro]) / target[macro];
              return isOff > wasOff;
            });
            if (worsens) continue;

            const score = totalError(after, target);
            if (!best || score < best.score) best = { a, b, fa, fb, score };
          }
        }
      }
    }

    // Only worth doing if it is a real improvement.
    if (!best || best.score >= current - 0.01) break;

    const grew = best.fa >= best.fb ? best.a : best.b;
    const shrank = best.fa >= best.fb ? best.b : best.a;
    scaleMeal(best.a, best.fa);
    scaleMeal(best.b, best.fb);
    locked.add(best.a);
    locked.add(best.b);

    done.push({
      date: day?.date ?? "",
      grew: grew.name ?? "meal",
      shrank: shrank.name ?? "meal",
      before: Math.round(current * 100) / 100,
      after: Math.round(best.score * 100) / 100,
    });
  }

  return done;
};

export interface MacroAccuracy {
  /** Mean absolute error per macro across the plan, as a share of target. */
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

/** How close a finished plan is to its targets — stored so it can be tracked. */
export const planMacroAccuracy = (
  weeklyPlan: Record<string, any>,
  dailyMacros: MacroSet,
  targetCalories: number,
): MacroAccuracy => {
  const days = Object.values(weeklyPlan ?? {}).filter((d: any) => d?.meals);
  if (!days.length) return { protein: 0, carbs: 0, fat: 0, calories: 0 };

  const sums = { protein: 0, carbs: 0, fat: 0, calories: 0 };
  for (const day of days) {
    const error = dayMacroError(day, dailyMacros);
    for (const macro of MACROS) sums[macro] += Math.abs(error[macro]);
    const calories = mealsOf(day).reduce((s, m) => s + (Number(m.calories) || 0), 0);
    sums.calories += targetCalories > 0 ? Math.abs(calories - targetCalories) / targetCalories : 0;
  }

  const round = (v: number) => Math.round((v / days.length) * 1000) / 1000;
  return {
    protein: round(sums.protein),
    carbs: round(sums.carbs),
    fat: round(sums.fat),
    calories: round(sums.calories),
  };
};

/** Run the correction over a whole plan. */
export const balancePlanMacros = (
  weeklyPlan: Record<string, any>,
  dailyMacros: MacroSet,
): { weeklyPlan: Record<string, any>; nudges: MacroNudge[] } => {
  const nudges: MacroNudge[] = [];
  for (const [date, day] of Object.entries(weeklyPlan ?? {})) {
    if (!(day as any)?.meals) continue;
    nudges.push(...nudgeDayMacros({ ...(day as any), date }, dailyMacros));
  }
  return { weeklyPlan, nudges };
};
