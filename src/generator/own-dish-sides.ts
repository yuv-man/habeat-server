/**
 * A side next to the user's own dish, so their dish can stay theirs.
 *
 * Their dish is served at their portion (own-dishes.ts). Most are stored as the
 * main alone — skewers at 410 kcal against an 841 kcal dinner — and letting the
 * rest of the day make up the difference put a 1,187 kcal lunch next to them.
 * A plate of skewers is eaten with rice and salad anyway, so that is what fills
 * the meal: their dish untouched, the healthier part beside it.
 *
 * Chosen in code from a short list with known nutrition, not asked of the
 * model: the numbers must be right, and a side is not where variety matters.
 */

import { roundAmount } from "./calorie-balance";

export interface SideNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface PlanSide {
  /** Which option this is (see sideOptions), so the picker can mark it. */
  id: string;
  name: string;
  calories: number;
  macros: { protein: number; carbs: number; fat: number };
  /** [name, amount, shopping category] — the shape a plan meal carries. */
  ingredients: [string, string, string][];
}

/** Per 100 g as served. */
interface Part {
  id: string;
  name: string;
  /** Shopping-list category, as generated meals carry it. */
  category: string;
  per100: SideNutrition;
  /** Words that, in an ingredient list, mean this part is off the table. */
  avoidIf: string[];
  /** Grams on the plate when it is the second half of a pair (default 150). */
  plateGrams?: number;
  /** Most grams of it as the starch of a pair (default 250) — bread is denser than rice. */
  maxGrams?: number;
}

const RICE: Part = {
  id: "rice",
  name: "Rice",
  category: "Grains",
  per100: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  avoidIf: ["rice"],
};
const POTATOES: Part = {
  id: "potatoes",
  name: "Roasted potatoes",
  category: "Vegetables",
  per100: { calories: 110, protein: 2, carbs: 19, fat: 3 },
  avoidIf: ["potato", "nightshade"],
};
const QUINOA: Part = {
  id: "quinoa",
  name: "Quinoa",
  category: "Grains",
  per100: { calories: 120, protein: 4.4, carbs: 21, fat: 1.9 },
  avoidIf: ["quinoa"],
};
const ISRAELI_SALAD: Part = {
  // Tomato, cucumber, onion, lemon and a teaspoon of olive oil.
  id: "israeli-salad",
  name: "Israeli salad",
  category: "Vegetables",
  per100: { calories: 47, protein: 0.8, carbs: 5, fat: 2.7 },
  avoidIf: ["tomato", "cucumber", "onion", "nightshade"],
};
const ROASTED_VEG: Part = {
  // Courgette, pepper and onion, roasted with a little olive oil.
  id: "roasted-veg",
  name: "Roasted vegetables",
  category: "Vegetables",
  per100: { calories: 55, protein: 1.3, carbs: 6, fat: 3 },
  avoidIf: ["zucchini", "courgette", "pepper", "onion", "nightshade"],
};
const GREEN_SALAD: Part = {
  id: "green-salad",
  name: "Green salad",
  category: "Vegetables",
  per100: { calories: 35, protein: 1.2, carbs: 3, fat: 2 },
  avoidIf: ["lettuce", "leafy"],
};

const BULGUR: Part = {
  id: "bulgur",
  name: "Bulgur",
  category: "Grains",
  per100: { calories: 83, protein: 3.1, carbs: 18.6, fat: 0.2 },
  avoidIf: ["bulgur", "wheat", "gluten"],
  // Lighter than rice per gram, so a plate of it weighs more.
  maxGrams: 300,
};
const SWEET_POTATO: Part = {
  id: "sweet-potato",
  name: "Baked sweet potato",
  category: "Vegetables",
  per100: { calories: 90, protein: 2, carbs: 20.7, fat: 0.2 },
  avoidIf: ["sweet potato"],
  // One large sweet potato.
  maxGrams: 350,
};
const COUSCOUS: Part = {
  id: "couscous",
  name: "Couscous",
  category: "Grains",
  per100: { calories: 112, protein: 3.8, carbs: 23.2, fat: 0.2 },
  avoidIf: ["couscous", "wheat", "gluten"],
};
const PITA: Part = {
  id: "pita",
  name: "Wholewheat pita",
  category: "Bakery",
  per100: { calories: 266, protein: 9.8, carbs: 55, fat: 2.6 },
  avoidIf: ["pita", "bread", "wheat", "gluten"],
  // One pita and a bit: a second one is a sandwich, not a side.
  maxGrams: 100,
};
const GREEN_BEANS: Part = {
  // Steamed, with a teaspoon of olive oil and lemon.
  id: "green-beans",
  name: "Green beans",
  category: "Vegetables",
  per100: { calories: 45, protein: 1.8, carbs: 7, fat: 1.2 },
  avoidIf: ["green bean", "legume"],
};
const TAHINI_SALAD: Part = {
  // Chopped vegetables with a tahini and lemon dressing.
  id: "tahini-salad",
  name: "Tahini salad",
  category: "Vegetables",
  per100: { calories: 85, protein: 2.2, carbs: 5.5, fat: 6.3 },
  avoidIf: ["tahini", "sesame", "tomato", "cucumber", "nightshade"],
};
const HUMMUS: Part = {
  id: "hummus",
  name: "Hummus",
  category: "Pantry",
  per100: { calories: 166, protein: 7.9, carbs: 14.3, fat: 9.6 },
  avoidIf: ["hummus", "chickpea", "legume", "tahini", "sesame"],
  // A few spoonfuls next to the pita, not a bowl.
  plateGrams: 80,
};

/** The plates people actually eat next to a main. */
const PAIRS: [Part, Part][] = [
  [RICE, ISRAELI_SALAD],
  [POTATOES, ROASTED_VEG],
  [QUINOA, GREEN_SALAD],
  [BULGUR, TAHINI_SALAD],
  [SWEET_POTATO, GREEN_BEANS],
  [COUSCOUS, ROASTED_VEG],
  [PITA, HUMMUS],
];
const VEG: Part[] = [ISRAELI_SALAD, ROASTED_VEG, GREEN_SALAD, GREEN_BEANS, TAHINI_SALAD];

/**
 * What the planner puts on the plate by itself, from the everyday sides —
 * the rest are there for the user to choose. Kept to the original set so a
 * plan regenerated for the same week comes out the same.
 */
const DEFAULT_SIDE_IDS = new Set([
  "rice+israeli-salad",
  "potatoes+roasted-veg",
  "quinoa+green-salad",
  "israeli-salad",
  "roasted-veg",
  "green-salad",
]);

/** Ingredients that already make the dish a full plate of carbs. */
const CARB_BASES = [
  "bun", "bread", "pita", "pitta", "tortilla", "wrap", "rice", "pasta", "noodle",
  "spaghetti", "potato", "fries", "couscous", "bulgur", "quinoa", "baguette", "lavash",
];

/** Below this the meal is close enough to its slot; no side. */
export const SIDE_MIN_GAP_KCAL = 120;
const SIDE_MIN_GAP_SHARE = 0.15;
/** A side, not a second main. */
const MAX_CARB_G = 250;
const MAX_VEG_G = 300;
const DEFAULT_VEG_G = 150;
/** Less than a couple of spoonfuls of rice is not worth listing; vegetables fill it instead. */
const MIN_CARB_G = 80;

/** A coating, not a base: a schnitzel's breadcrumbs don't make it a plate of carbs. */
const COATINGS = ["breadcrumb", "bread crumb", "panko", "crumbs"];

const hasCarbBase = (ingredientNames: string[]): boolean =>
  ingredientNames.some((raw) => {
    const i = raw.toLowerCase();
    if (COATINGS.some((c) => i.includes(c))) return false;
    return CARB_BASES.some((b) => i.includes(b));
  });

const allowed = (part: Part, avoid: string[]): boolean =>
  !avoid.some((a) => {
    const term = a.toLowerCase().trim();
    return !!term && (part.name.toLowerCase().includes(term) || part.avoidIf.some((w) => term.includes(w)));
  });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const build = (parts: [Part, number][]): PlanSide => {
  const sum = { protein: 0, carbs: 0, fat: 0 };
  for (const [part, grams] of parts) {
    sum.protein += (part.per100.protein * grams) / 100;
    sum.carbs += (part.per100.carbs * grams) / 100;
    sum.fat += (part.per100.fat * grams) / 100;
  }
  const macros = {
    protein: Math.round(sum.protein),
    carbs: Math.round(sum.carbs),
    fat: Math.round(sum.fat),
  };
  return {
    id: parts.map(([p]) => p.id).join("+"),
    name: parts.map(([p]) => p.name).join(" & "),
    // Same invariant as every plan meal: calories are the energy in the macros.
    calories: macros.protein * 4 + macros.carbs * 4 + macros.fat * 9,
    macros,
    ingredients: parts.map(([p, grams]) => [p.name.toLowerCase(), `${grams} g`, p.category]),
  };
};

/** A carb and a vegetable filling `gap`: the vegetable plate-sized, the carb the rest. */
const pairSide = ([carb, veg]: [Part, Part], gap: number): PlanSide => {
  const vegGrams = veg.plateGrams ?? DEFAULT_VEG_G;
  const vegCalories = (veg.per100.calories * vegGrams) / 100;
  const maxCarb = carb.maxGrams ?? MAX_CARB_G;
  const carbGrams = clamp(
    ((gap - vegCalories) / carb.per100.calories) * 100,
    Math.min(MIN_CARB_G, maxCarb),
    maxCarb,
  );
  return build([
    [carb, roundAmount(carbGrams, "g")],
    [veg, vegGrams],
  ]);
};

/** A vegetable alone filling `gap`, at least a plate's worth. */
const vegSide = (veg: Part, gap: number): PlanSide =>
  build([[veg, roundAmount(clamp((gap / veg.per100.calories) * 100, DEFAULT_VEG_G, MAX_VEG_G), "g")]]);

export interface SideRequest {
  dishName: string;
  ingredientNames: string[];
  /** The dish alone, without any side. */
  dishCalories: number;
  slotCalories: number;
  /** Allergies, dislikes and restrictions, as free text. */
  avoid?: string[];
  seed?: string;
}

/**
 * Every side that suits this dish, each sized to fill the meal to its slot.
 * A dish with its own carb base (a burger's bun) is offered vegetables only.
 * What the side picker lists; "no side" is the picker's own option.
 */
export const sideOptions = (req: SideRequest): PlanSide[] => {
  const avoid = req.avoid ?? [];
  const gap = req.slotCalories - req.dishCalories;
  const pairs = hasCarbBase(req.ingredientNames)
    ? []
    : PAIRS.filter(([c, v]) => allowed(c, avoid) && allowed(v, avoid)).map((p) => pairSide(p, gap));
  const veg = VEG.filter((v) => allowed(v, avoid)).map((v) => vegSide(v, gap));
  return [...pairs, ...veg];
};

/** The option with this id for this dish, or null when it does not suit it. */
export const sideById = (req: SideRequest, id: string): PlanSide | null =>
  sideOptions(req).find((o) => o.id === id) ?? null;

/** Pick deterministically, so a plan regenerated for the same week comes out the same. */
const pick = <T>(items: T[], seed: string): T | undefined => {
  if (!items.length) return undefined;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return items[h % items.length];
};

/**
 * The side the planner serves by default, or null when the dish already fills
 * its slot. A carb and a vegetable when there is room for a real portion of
 * the carb; otherwise vegetables alone.
 */
export const chooseSide = (req: SideRequest): PlanSide | null => {
  const gap = req.slotCalories - req.dishCalories;
  if (gap < Math.max(SIDE_MIN_GAP_KCAL, SIDE_MIN_GAP_SHARE * req.slotCalories)) return null;

  const seed = req.seed ?? req.dishName;
  const options = sideOptions(req).filter((o) => DEFAULT_SIDE_IDS.has(o.id));
  const pairs = options.filter((o) => o.ingredients.length === 2);
  const vegOnly = options.filter((o) => o.ingredients.length === 1);
  // Room for a real portion of the carb once the vegetables are on the plate?
  const roomForCarb = gap - (ISRAELI_SALAD.per100.calories * DEFAULT_VEG_G) / 100 >= (RICE.per100.calories * MIN_CARB_G) / 100;
  return (roomForCarb ? pick(pairs, seed) : undefined) ?? pick(vegOnly, seed) ?? null;
};

/**
 * Put the side on the meal: the dish keeps its name and recipe, the meal's
 * totals and ingredient list include the side (so the day, the progress log
 * and the shopping list all count it), and `side` says what it is.
 */
export const attachSide = (meal: any, side: PlanSide): any => {
  const macros = meal.macros ?? {};
  const protein = (Number(macros.protein) || 0) + side.macros.protein;
  const carbs = (Number(macros.carbs) || 0) + side.macros.carbs;
  const fat = (Number(macros.fat) || 0) + side.macros.fat;
  meal.macros = { ...macros, protein, carbs, fat };
  meal.calories = (Number(meal.calories) || 0) + side.calories;
  meal.ingredients = [...(Array.isArray(meal.ingredients) ? meal.ingredients : []), ...side.ingredients];
  meal.side = side;
  return meal;
};

/** Take the side back off the meal: its totals and ingredients, and `side`. */
export const detachSide = (meal: any): any => {
  const side: PlanSide | undefined = meal?.side;
  if (!side) return meal;
  const macros = meal.macros ?? {};
  meal.macros = {
    ...macros,
    protein: Math.max(0, (Number(macros.protein) || 0) - side.macros.protein),
    carbs: Math.max(0, (Number(macros.carbs) || 0) - side.macros.carbs),
    fat: Math.max(0, (Number(macros.fat) || 0) - side.macros.fat),
  };
  meal.calories = Math.max(0, (Number(meal.calories) || 0) - side.calories);
  if (Array.isArray(meal.ingredients)) {
    meal.ingredients = meal.ingredients.slice(0, Math.max(0, meal.ingredients.length - side.ingredients.length));
  }
  delete meal.side;
  return meal;
};
