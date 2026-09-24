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

import { Types } from "mongoose";
import { scaleMeal } from "./calorie-balance";
import { MealSlot, slotCalorieShares } from "./meal-plan-prompt";
import {
  attachSide,
  chooseSide,
  detachSide,
  PlanSide,
  SideRequest,
  sideById,
  sideOptions,
} from "./own-dish-sides";

/** Share of a week's lunches and dinners given to dishes the user cooks. */
export const OWN_DISH_MAIN_SHARE = 0.4;
/**
 * At most this share of the week's own-dish meals are served as a healthier
 * swap; the rest come as the user makes them. A schnitzel is a schnitzel: a
 * week where every one of their dishes became a "better version" is a week
 * with none of their food in it, and the healthier part is the plan around it.
 */
export const OWN_DISH_SWAP_SHARE = 0.5;
/** Portion limits for the meals rebalanced around a dish served as-is. */
const AROUND_MIN_SCALE = 0.7;
const AROUND_MAX_SCALE = 1.3;
/** A day this close to its target is left alone. */
const AROUND_TOLERANCE = 0.03;

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
  avoid: string[] = [],
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
    // An id of its own. Keeping the replaced meal's id made the recipe button
    // open that meal: the recipe is looked up by id, library first, so Tamir's
    // schnitzel opened "Pan Seared Ribeye".
    _id: new Types.ObjectId(),
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
  // Their dish — or the swap for it — comes at its own portion: a smaller
  // schnitzel is not their schnitzel, a doubled chicken breast is not a
  // lighter take on it, and nobody re-reads the recipe to notice. A light one
  // gets a side to fill the meal (own-dish-sides.ts); what is left, the rest
  // of the day makes room for (balanceAroundOwnDishes).
  if (targetCalories > 0) {
    const side = chooseSide({
      dishName: dish.name,
      ingredientNames: ingredients.map((i) => i.name),
      dishCalories: meal.calories,
      slotCalories: targetCalories,
      avoid,
    });
    if (side) attachSide(meal, side);
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
  /** Allergies, dislikes and restrictions — what a side must not contain. */
  avoid: string[] = [],
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
  // Own-dish meals this week, and how many of them are swaps — including any
  // an earlier phase placed, so the share holds across phases.
  let ownMeals = 0;
  let swaps = 0;

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
      ownMeals++;
      if (meal.tuneLevel) swaps++;
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
    // As they make it first; a swap only while swaps stay within their share.
    const maySwap = swaps + 1 <= Math.floor((ownMeals + 1) * OWN_DISH_SWAP_SHARE);
    const tune = maySwap && chooseTune(
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
    weeklyPlan[key].meals[slot] = asMeal(chosen, meal, slotCalories, tune || null, avoid);
    ownMeals++;
    if (tune) {
      swaps++;
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

/** A dish of theirs served as they make it — including as the next day's leftovers. */
export const isOwnAsIs = (meal: any): boolean => !!meal?.fromRepertoire && !meal?.tuneLevel;

/**
 * A meal the day balances around rather than scales: their dish or the swap
 * for it (served at its own portion), or any meal carrying a side (whose
 * numbers must stay the ones it was attached with, so it can come off again).
 */
export const isFixedPortion = (meal: any): boolean => !!meal?.fromRepertoire || !!meal?.side;

/**
 * Make room in the day for their own dish.
 *
 * Their dish is served at their portion, so the day lands off its target by
 * whatever that portion differs from the slot. The other meals of the day —
 * the ones we chose — are scaled together to bring it back. Meals already
 * ticked off are left as eaten. Mutates and returns the plan.
 */
export const balanceAroundOwnDishes = (
  weeklyPlan: Record<string, any>,
  targetCalories: number,
): { weeklyPlan: Record<string, any>; days: number } => {
  let days = 0;
  if (!(targetCalories > 0)) return { weeklyPlan, days };

  for (const day of Object.values(weeklyPlan ?? {})) {
    const m = (day as any)?.meals;
    if (!m) continue;
    const meals = [m.breakfast, m.lunch, m.dinner, ...(Array.isArray(m.snacks) ? m.snacks : [])].filter(
      (x) => x && typeof x.calories === "number",
    );
    if (!meals.some(isFixedPortion)) continue;
    if (balanceDay(day, targetCalories)) days++;
  }

  return { weeklyPlan, days };
};

/**
 * Bring one day back to its target by scaling the meals that may be scaled —
 * not the fixed-portion ones, not the ones already eaten. Returns whether it
 * changed anything. Mutates the day.
 */
export const balanceDay = (day: any, targetCalories: number): boolean => {
  const m = day?.meals;
  if (!m || !(targetCalories > 0)) return false;
  const meals = [m.breakfast, m.lunch, m.dinner, ...(Array.isArray(m.snacks) ? m.snacks : [])].filter(
    (x) => x && typeof x.calories === "number",
  );

  const total = meals.reduce((s, x) => s + x.calories, 0);
  const gap = targetCalories - total;
  if (Math.abs(gap) <= AROUND_TOLERANCE * targetCalories) return false;

  const around = meals.filter((x) => !isFixedPortion(x) && !x.done);
  const aroundCalories = around.reduce((s, x) => s + x.calories, 0);
  if (!aroundCalories) return false;

  const factor = Math.min(
    AROUND_MAX_SCALE,
    Math.max(AROUND_MIN_SCALE, (aroundCalories + gap) / aroundCalories),
  );
  for (const meal of around) scaleMeal(meal, factor);
  return true;
};

const ingredientName = (i: unknown): string =>
  Array.isArray(i) ? String(i[0] ?? "") : String(i ?? "").split("|")[0];

/** What the side picker needs to size sides for this meal: the dish alone. */
export const sideRequestFor = (meal: any, slotCalories: number, avoid: string[] = []): SideRequest => {
  const sideCount = meal?.side?.ingredients?.length ?? 0;
  const ingredients: unknown[] = Array.isArray(meal?.ingredients) ? meal.ingredients : [];
  return {
    dishName: String(meal?.name ?? ""),
    ingredientNames: ingredients.slice(0, ingredients.length - sideCount).map(ingredientName),
    dishCalories: (Number(meal?.calories) || 0) - (Number(meal?.side?.calories) || 0),
    slotCalories,
    avoid,
  };
};

/** The sides this meal can have, and which one it has now. */
export const sideChoicesFor = (
  meal: any,
  slotCalories: number,
  avoid: string[] = [],
): { current: string | null; options: PlanSide[] } => {
  const options = sideOptions(sideRequestFor(meal, slotCalories, avoid));
  // Sides placed before they carried an id are matched by name.
  const current =
    meal?.side?.id ?? options.find((o) => o.name === meal?.side?.name)?.id ?? null;
  return { current, options };
};

export class SideChoiceError extends Error {}

/**
 * The user picked a side (or none) for a lunch or dinner — one of their own
 * dishes or any planned meal. Swap it on the meal, then let the rest of the
 * day make room, as when the plan was built. The dish itself is untouched.
 * Mutates the day.
 */
export const changeSide = (
  day: any,
  slot: "lunch" | "dinner",
  optionId: string | null,
  slotCalories: number,
  targetCalories: number,
  avoid: string[] = [],
): any => {
  const meal = day?.meals?.[slot];
  if (!meal) throw new SideChoiceError("No meal to add a side to");
  if (meal.done) throw new SideChoiceError("This meal is already logged");

  const request = sideRequestFor(meal, slotCalories, avoid);
  const next = optionId ? sideById(request, optionId) : null;
  if (optionId && !next) throw new SideChoiceError(`"${optionId}" is not a side for this dish`);

  detachSide(meal);
  if (next) attachSide(meal, next);
  /** Chosen by them: a later automatic pass must leave it as it is. */
  meal.sideChosen = true;

  balanceDay(day, targetCalories);
  return day;
};
