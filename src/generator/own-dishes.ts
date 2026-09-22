/**
 * Put the user's own dishes into their week.
 *
 * The outline can ask the model to cook "Mum's chicken soup", but the model
 * drifts: a real week asked for nine of Chloe's dishes and returned none of
 * them — "Pasta with tomato and basil" came back as "Garlic Tomato Beef Pasta".
 * That is not a prompt problem to keep fighting. Her dishes are already known
 * in full (ingredients, nutrition, prep time, from repertoire.resolver.ts), so
 * code places them and the model only cooks the rest of the week.
 *
 * This is the simple form of the weekly balancing in docs/the-repertoire.md §6:
 * choose which of the dishes someone already cooks goes in which slot, and
 * portion it to that slot. The full version also optimises the week's macros.
 */

import { scaleMeal } from "./calorie-balance";
import { MealSlot, slotCalorieShares } from "./meal-plan-prompt";

/** Share of a week's lunches and dinners given to dishes the user cooks. */
export const OWN_DISH_MAIN_SHARE = 0.4;
/** A serving of one's own dish can double; past that it is not that dish. */
export const OWN_DISH_MAX_SCALE = 2;

export interface DishNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface PlannableTune {
  level: 1 | 2 | 3;
  /** The healthier dish's own name — what goes on the plan. */
  name?: string;
  swapNote?: string;
  changes: string[];
  ingredients?: { name: string; amount: string }[];
  nutritionPerServing: DishNutrition;
}

export interface PlannableDish {
  _id?: unknown;
  name: string;
  slots?: string[];
  usual?: {
    ingredients?: { name: string; amount: string }[];
    prepMinutes?: number | null;
    nutritionPerServing?: DishNutrition | null;
  };
  /** Better versions of the same dish (repertoire.tuner.ts). */
  tunes?: PlannableTune[];
  /** How far this user tolerates tuning this dish. */
  tuneCeiling?: 0 | 1 | 2 | 3;
  rhythm?: { usualPerMonth?: number | null; observedPerMonth?: number };
}

export interface OwnDishStats {
  placed: number;
  dishes: string[];
  /** Dishes served as a better version of themselves, and what changed. */
  tuned: { dish: string; level: number; changes: string[] }[];
}

const parseKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** How often this dish may appear in one week: their own rhythm, plus one. */
const weeklyCap = (dish: PlannableDish): number => {
  const perMonth = dish.rhythm?.usualPerMonth ?? dish.rhythm?.observedPerMonth ?? 0;
  return perMonth > 0 ? Math.ceil(perMonth / 4) + 1 : 2;
};

const usableFor = (dish: PlannableDish, slot: MealSlot): boolean => {
  const n = dish.usual?.nutritionPerServing;
  if (!n?.calories || !dish.usual?.ingredients?.length) return false;
  const slots = dish.slots?.length ? dish.slots : ["lunch", "dinner"];
  return slots.includes(slot);
};

/**
 * Which version of their dish to serve.
 *
 * Never a different dish — the same one, made better, as far as this user is
 * ready for (stage ceiling) and as far as it actually helps the day's targets.
 * Between two allowed levels, the one that lands closer to what the slot needs
 * wins; a tie goes to the gentler change.
 */
export const chooseTune = (
  dish: PlannableDish,
  target: { calories: number; macros?: DishNutrition },
  maxLevel: 0 | 1 | 2 | 3,
): PlannableTune | null => {
  const allowed = Math.min(maxLevel, dish.tuneCeiling ?? 3);
  if (allowed < 1 || !dish.tunes?.length) return null;

  const candidates = dish.tunes.filter(
    (t) =>
      t.level <= allowed &&
      t.nutritionPerServing?.calories &&
      // A version with no name of its own would reach the plan as their own
      // dish with quietly different numbers — the change nobody notices.
      // (Older stored versions predate the named ladder.)
      t.name?.trim(),
  );
  if (!candidates.length) return null;

  /**
   * Judged on the BALANCE of the dish, not its size.
   *
   * The plan portions every serving anyway, so comparing totals made a tuned
   * version look identical to the original and nothing was ever tuned. What a
   * tune actually changes is the mix — more tomato, less oil — and that shows
   * up as the share of the dish's calories coming from each macro.
   */
  const shares = (n: DishNutrition): Record<"protein" | "carbs" | "fat", number> => {
    const kcal = n.protein * 4 + n.carbs * 4 + n.fat * 9 || n.calories || 1;
    return {
      protein: (n.protein * 4) / kcal,
      carbs: (n.carbs * 4) / kcal,
      fat: (n.fat * 9) / kcal,
    };
  };

  const wanted = target.macros ? shares(target.macros) : null;
  const fit = (n: DishNutrition): number => {
    if (!wanted) return Math.abs(n.calories - target.calories) / (target.calories || 1);
    const has = shares(n);
    return (["protein", "carbs", "fat"] as const).reduce(
      (sum, macro) => sum + Math.abs(has[macro] - wanted[macro]),
      0,
    );
  };

  const best = [...candidates].sort(
    (a, b) => fit(a.nutritionPerServing) - fit(b.nutritionPerServing) || a.level - b.level,
  )[0];

  // No comparison against their own version here: every stored version has
  // already been checked as a genuinely healthier swap of the same food
  // (repertoire.tuner.ts). Whether to improve the dish is the stage's call —
  // this only picks which improvement suits the day.
  return best;
};

/** The stored dish as a plan meal, portioned for the slot it is taking. */
const asMeal = (
  dish: PlannableDish,
  replaced: any,
  targetCalories: number,
  tune: PlannableTune | null,
) => {
  const n = (tune?.nutritionPerServing ?? dish.usual!.nutritionPerServing!) as DishNutrition;
  const ingredients = tune?.ingredients?.length ? tune.ingredients : dish.usual!.ingredients ?? [];
  // The swap is the point, so the plan carries the new dish's name. Calling a
  // baked chicken breast "chicken schnitzel" would hide the whole change.
  const shown = tune?.name?.trim() || dish.name;
  const meal: any = {
    name: shown,
    nameEn: shown,
    category: replaced?.category ?? "dinner",
    calories: n.calories,
    macros: { protein: n.protein, carbs: n.carbs, fat: n.fat },
    // Stored as [name, amount] tuples, the shape a plan meal carries.
    ingredients: ingredients.map((i) => [i.name, i.amount]),
    prepTime: dish.usual?.prepMinutes ?? 20,
    done: false,
    _id: replaced?._id,
    /** So the client can say "one of your own" and the Brain can tell them apart. */
    fromRepertoire: dish._id ? String(dish._id) : dish.name,
    ...(tune
      ? {
          tuneLevel: tune.level,
          tuneChanges: tune.changes,
          /** Their own dish this replaces, so the client can say where it came
           *  from: "Baked chicken breast — your schnitzel, oven-baked". */
          insteadOf: dish.name,
          swapNote: tune.swapNote ?? "",
        }
      : {}),
  };
  if (targetCalories > 0 && n.calories > 0) {
    // Wider than the generated-meal limits (calorie-balance.ts): a light dish
    // of their own — a lentil soup at 284 kcal against an 841 kcal dinner —
    // is normally eaten as a bigger bowl, not left to leave the day short.
    scaleMeal(meal, Math.min(OWN_DISH_MAX_SCALE, Math.max(0.5, targetCalories / n.calories)));
  }
  return meal;
};

/**
 * Replace a share of the week's mains with dishes the user actually cooks.
 * Spread through the week, no dish on consecutive days, none more often than
 * they already eat it. Mutates and returns the plan.
 */
export const applyOwnDishes = (
  weeklyPlan: Record<string, any>,
  dishes: PlannableDish[],
  targetCalories: number,
  activeSlots: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"],
  /** How far the Brain says this user is ready to have their food changed
   *  (behaviour.types.ts). Portion only until a change is holding. */
  maxTuneLevel: 0 | 1 | 2 | 3 = 1,
  /** The day's macro targets, so the chosen version fits the day. */
  dailyMacros?: DishNutrition,
): { weeklyPlan: Record<string, any>; stats: OwnDishStats } => {
  const stats: OwnDishStats = { placed: 0, dishes: [], tuned: [] };
  const usable = dishes.filter((d) => d?.name && d.usual?.nutritionPerServing?.calories);
  if (!usable.length) return { weeklyPlan, stats };

  const shares = slotCalorieShares(activeSlots);
  const keys = Object.keys(weeklyPlan).sort();
  const slots: { key: string; slot: MealSlot }[] = [];
  for (const key of keys) {
    for (const slot of ["lunch", "dinner"] as const) {
      if (weeklyPlan[key]?.meals?.[slot] && shares[slot]) slots.push({ key, slot });
    }
  }

  const every = 1 / OWN_DISH_MAIN_SHARE;
  const used = new Map<string, number>();
  const lastDay = new Map<string, string>();
  let credit = 0;
  let next = 0;

  for (const { key, slot } of slots) {
    const meal = weeklyPlan[key].meals[slot];
    credit += 1;

    // Already one of theirs (an earlier phase placed it): leave it alone, but
    // count it — it is one of this week's own-dish slots, so the spacing and
    // the per-dish caps have to include it or a second phase places more.
    if (meal?.fromRepertoire) {
      const id = String(meal.fromRepertoire);
      used.set(id, (used.get(id) ?? 0) + 1);
      lastDay.set(id, key);
      credit -= every;
      continue;
    }

    if (credit < every) continue;

    const yesterday = parseKey(key);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

    // Walk the rotation from where it left off, taking the first dish that fits.
    let chosen: PlannableDish | undefined;
    for (let i = 0; i < usable.length; i++) {
      const dish = usable[(next + i) % usable.length];
      const id = String(dish._id ?? dish.name);
      if (!usableFor(dish, slot)) continue;
      if ((used.get(id) ?? 0) >= weeklyCap(dish)) continue;
      if (lastDay.get(id) === yesterdayKey || lastDay.get(id) === key) continue;
      chosen = dish;
      next = (next + i + 1) % usable.length;
      break;
    }
    if (!chosen) continue;

    const id = String(chosen._id ?? chosen.name);
    const slotCalories = Math.round(targetCalories * shares[slot]);
    const tune = chooseTune(
      chosen,
      {
        calories: slotCalories,
        ...(dailyMacros
          ? {
              macros: {
                calories: slotCalories,
                protein: dailyMacros.protein * shares[slot],
                carbs: dailyMacros.carbs * shares[slot],
                fat: dailyMacros.fat * shares[slot],
              },
            }
          : {}),
      },
      maxTuneLevel,
    );
    weeklyPlan[key].meals[slot] = asMeal(chosen, meal, slotCalories, tune);
    if (tune) {
      stats.tuned.push({ dish: chosen.name, level: tune.level, changes: tune.changes });
    }
    used.set(id, (used.get(id) ?? 0) + 1);
    lastDay.set(id, key);
    credit -= every;
    stats.placed++;
    if (!stats.dishes.includes(chosen.name)) stats.dishes.push(chosen.name);
  }

  return { weeklyPlan, stats };
};
