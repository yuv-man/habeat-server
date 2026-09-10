/**
 * Weekly meal-plan prompting.
 *
 * Replaces the previous single free-form prompt, which had four structural
 * problems visible in real generations (see scripts/meal-plan-eval):
 *
 *  1. It listed concrete example dishes ("scrambled eggs with toast, oatmeal
 *     with banana, grilled chicken with rice…") to convey "keep it simple". The
 *     model copied them verbatim, so every user got the same handful of meals.
 *  2. Cuisine and protein were assigned per DAY and applied to all three slots,
 *     which is how "Mediterranean Beef and Tomato Bowl" ended up as a breakfast.
 *  3. The rotation was indexed by day number alone, so the same user received an
 *     identical assignment every week.
 *  4. Calorie/macro figures were echoed straight back from the template, giving
 *     a suspiciously perfect 0.0% error against target and no relation to the
 *     ingredients actually listed.
 *
 * The approach here: **code owns the skeleton, the model owns the cooking.** We
 * deterministically pick a slot-appropriate archetype, protein and cooking
 * method for every single meal, seeded so it varies week to week, and hand the
 * model a filled-in menu outline to flesh out. The model never chooses the shape
 * of the week, so it cannot collapse onto its favourite six dishes.
 */

import {
  DietaryConstraints,
  buildDietaryConstraintBlock,
  filterFoodPreferences,
  findMealViolations,
} from "../utils/dietary-constraints";
import logger from "../utils/logger";
import {
  COOKING_LEVEL_SPECS,
  CookingLevel,
  prepCeilingFor,
} from "../constants/cookingLevel";

/** Used when the user has not told us how much cooking they are up for. */
const DEFAULT_MAX_PREP_MINUTES = 45;

// ─── Slot definitions ───────────────────────────────────────────────────────

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** Share of the daily calorie budget per slot. Must sum to 1. */
export const SLOT_CALORIE_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};

/**
 * Determine which meal slots fall within a fasting eating window.
 * fastingStartTime is "HH:MM" when fasting BEGINS (e.g. "20:00").
 * Returns slots whose typical time falls inside the eating window.
 */
export function computeActiveSlots(opts: {
  fastingHours?: number;
  fastingStartTime?: string;
  mealsPerDay?: number;
}): MealSlot[] {
  const { fastingHours, fastingStartTime, mealsPerDay } = opts;

  // Fasting takes priority over mealsPerDay
  if (fastingHours && fastingHours >= 12 && fastingStartTime) {
    const [h, m] = fastingStartTime.split(":").map(Number);
    const fastStartMin = (h ?? 0) * 60 + (m ?? 0);
    // Fasting begins at fastStartMin and lasts fastingHours hours.
    // The eating window opens when the fast ends and closes when the next fast begins.
    // eatStartMin = time when eating is allowed again (fast end = fastStart + fastingHours)
    // eatEndMin   = time when eating stops again (= fastStartMin, when next fast begins)
    const eatStartMin = (fastStartMin + fastingHours * 60) % 1440;
    const eatEndMin = fastStartMin;

    // Typical time (minutes from midnight) for each slot
    const SLOT_TIMES: Record<MealSlot, number> = {
      breakfast: 8 * 60,    // 8:00
      lunch: 12 * 60 + 30,  // 12:30
      snack: 15 * 60,       // 15:00
      dinner: 18 * 60 + 30, // 18:30
    };

    const inWindow = (t: number): boolean => {
      if (eatStartMin < eatEndMin) return t >= eatStartMin && t < eatEndMin;
      // window wraps midnight
      return t >= eatStartMin || t < eatEndMin;
    };

    const active = (Object.entries(SLOT_TIMES) as [MealSlot, number][])
      .filter(([, t]) => inWindow(t))
      .map(([slot]) => slot);

    // Guarantee at least 2 slots so the plan is functional
    if (active.length < 2) {
      // eating window too narrow — keep lunch+dinner as minimum
      return ["lunch", "dinner"];
    }
    return active;
  }

  // Non-fasting: honour mealsPerDay preference
  if (mealsPerDay === 2) return ["lunch", "dinner"];
  if (mealsPerDay === 3) return ["breakfast", "lunch", "dinner"];
  return ["breakfast", "lunch", "dinner", "snack"]; // default 4
}

/** Redistribute calorie shares so active slots sum to 1.0, preserving relative proportions. */
export function slotCalorieShares(activeSlots: MealSlot[]): Record<MealSlot, number> {
  const totalWeight = activeSlots.reduce((s, slot) => s + SLOT_CALORIE_SHARE[slot], 0);
  const result: Partial<Record<MealSlot, number>> = {};
  for (const slot of activeSlots) {
    result[slot] = SLOT_CALORIE_SHARE[slot] / totalWeight;
  }
  return result as Record<MealSlot, number>;
}

/**
 * A meal *form* rather than a specific dish. `requires` lists ingredient
 * families the form depends on, so an archetype is dropped automatically when
 * the user's constraints forbid that family (no egg dishes for a vegan, no
 * toast-based forms for a coeliac) instead of relying on the model to improvise
 * a substitution.
 */
interface Archetype {
  /** Short description handed to the model. */
  form: string;
  /** Ingredient families this form depends on. */
  requires?: string[];
  /**
   * The form is built on a starch (grains, flour, batter, potato). Dropped for
   * low-carb diets, where a 5%-carb macro target and a pancake brief in the
   * same prompt are a straight contradiction — and the model resolves it by
   * ignoring one of them.
   */
  carbLed?: boolean;
}

const BREAKFAST_ARCHETYPES: Archetype[] = [
  { form: "egg-based hot dish (scramble, omelette, frittata, shakshuka)", requires: ["egg"] },
  { form: "hot porridge or cooked grain bowl (oats, congee, semolina, millet)", carbLed: true },
  { form: "creamy yogurt- or curd-style bowl with fruit and a crunchy topping", requires: ["yogurt"] },
  { form: "handheld toast, flatbread or breakfast wrap with a savoury topping", requires: ["bread"], carbLed: true },
  { form: "blended smoothie or smoothie bowl with a thickener and topping" },
  { form: "batter-based griddle item (pancakes, waffles, crepes)", requires: ["flour"], carbLed: true },
  { form: "savoury breakfast skillet or hash built on potato or sweet potato", carbLed: true },
  { form: "overnight / no-cook soaked grain or chia pot with fruit", carbLed: true },
  // Was "protein-forward breakfast plate with a starch and a vegetable", which
  // named no morning protein and no morning form. The model read it as licence
  // to plate a dinner main and returned things like "Garlic Herb Broccoli with
  // Sirloin and Sunny Side Up Eggs" for breakfast. The form now says what the
  // plate actually is.
  { form: "protein-forward breakfast plate: eggs or a soft cheese with a fruit or vegetable side (no steak, chops or roast joints)" },
];

const LUNCH_ARCHETYPES: Archetype[] = [
  { form: "substantial salad bowl with a protein and a dressing" },
  { form: "sandwich, wrap or pita filled with a protein and vegetables", requires: ["bread"], carbLed: true },
  { form: "grain bowl with a protein, two vegetables and a sauce", carbLed: true },
  { form: "hearty soup or broth with a side of bread or crackers", carbLed: true },
  { form: "cold noodle or pasta salad with a protein", requires: ["pasta"], carbLed: true },
  { form: "one-pan skillet of protein, vegetables and a starch", carbLed: true },
  { form: "stuffed or filled vegetable (peppers, sweet potato, courgette)", carbLed: true },
  { form: "flatbread, quesadilla or savoury pancake with a filling", requires: ["flour"], carbLed: true },
  { form: "rice or grain plate with a stew-style topping", carbLed: true },
];

const DINNER_ARCHETYPES: Archetype[] = [
  { form: "roasted or baked main with two simple sides" },
  { form: "stir-fry over rice or noodles", carbLed: true },
  { form: "slow-simmered stew, chilli or curry with a starch", carbLed: true },
  { form: "grilled or pan-seared main with a salad and a starch", carbLed: true },
  { form: "pasta or noodle dish with a sauce and a vegetable", requires: ["pasta"], carbLed: true },
  { form: "sheet-pan tray bake of protein and vegetables" },
  { form: "tacos, burritos or filled tortillas with sides", requires: ["tortilla"], carbLed: true },
  { form: "layered or baked casserole" },
  { form: "soup-and-side dinner with a substantial bread", requires: ["bread"], carbLed: true },
  { form: "burger, patty or kofta with a starch and a vegetable", carbLed: true },
];

const SNACK_ARCHETYPES: Archetype[] = [
  { form: "fruit paired with a protein or fat source" },
  { form: "yogurt-style pot or pudding", requires: ["yogurt"] },
  { form: "raw vegetables with a dip" },
  { form: "no-bake energy bite or bar", carbLed: true },
  { form: "cracker, rice cake or toast with a spread", requires: ["bread"], carbLed: true },
  { form: "small savoury portion (roasted chickpeas, edamame, olives)" },
  { form: "blended drink or small smoothie" },
  { form: "handful-style mix of seeds, dried fruit and a crunchy element" },
];

const ARCHETYPES: Record<MealSlot, Archetype[]> = {
  breakfast: BREAKFAST_ARCHETYPES,
  lunch: LUNCH_ARCHETYPES,
  dinner: DINNER_ARCHETYPES,
  snack: SNACK_ARCHETYPES,
};

/**
 * Extra forms offered only to low-carb diets.
 *
 * Most of the standard lunch and dinner shapes are built on a starch, so simply
 * filtering them out left keto with one usable lunch form and the same salad
 * every day. These replace the variety that the filter removes, rather than
 * leaving the user with a narrower plan for having picked a stricter diet.
 */
const LOW_CARB_ARCHETYPES: Record<MealSlot, Archetype[]> = {
  breakfast: [
    { form: "baked or pan-fried egg dish with a soft cheese and greens", requires: ["egg"] },
    { form: "savoury breakfast bowl built on avocado and a soft protein" },
  ],
  lunch: [
    { form: "protein and vegetable plate with a rich sauce or dressing" },
    { form: "lettuce or cabbage wrap with a protein filling" },
    { form: "creamy vegetable soup finished with a protein" },
  ],
  dinner: [
    { form: "roasted main with a cauliflower or courgette side" },
    { form: "skillet of protein and greens in a pan sauce" },
    { form: "baked main topped with cheese and served with a salad" },
  ],
  snack: [
    { form: "cheese or cured protein with olives or nuts" },
    { form: "hard-boiled or devilled eggs", requires: ["egg"] },
  ],
};

/**
 * Proteins people actually eat at breakfast and for snacks.
 *
 * The user's general rotation is dinner-shaped (chicken, beef, salmon…). Reusing
 * it for every slot is what produced "Beef and Tomato Scramble" and "Chicken and
 * Coconut Curry Pancakes", so those two slots draw from their own pool instead.
 * Entries are filtered against the user's constraints, so a vegan keeps only the
 * plant-based ones.
 */
const BREAKFAST_PROTEIN_POOL = [
  "Eggs", "Greek yogurt", "Cottage cheese", "Tofu", "Peanut butter",
  "Almond butter", "Chia seeds", "Black beans", "Smoked salmon", "Milk",
];

const SNACK_PROTEIN_POOL = [
  "Greek yogurt", "Almonds", "Walnuts", "Pumpkin seeds", "Hummus",
  "Cottage cheese", "Edamame", "Peanut butter", "Cheese", "Chickpeas",
];

/** Plant-only fallbacks, used when constraints wipe out a whole pool. */
const PLANT_BREAKFAST_FALLBACK = ["Tofu", "Chia seeds", "Black beans", "Oats", "Sunflower seeds"];
const PLANT_SNACK_FALLBACK = ["Hummus", "Edamame", "Pumpkin seeds", "Chickpeas", "Sunflower seeds"];

/**
 * Slot-appropriate protein rotation. Lunch and dinner use the user's normal
 * rotation; breakfast and snacks use their own pool so the slot stays plausible.
 */
const proteinsForSlot = (
  slot: MealSlot,
  c: DietaryConstraints,
  dislikes: string[] = [],
): string[] => {
  const base =
    slot === "lunch" || slot === "dinner"
      ? c.proteinRotation
      : (() => {
          const pool = slot === "breakfast" ? BREAKFAST_PROTEIN_POOL : SNACK_PROTEIN_POOL;
          const fallback = slot === "breakfast" ? PLANT_BREAKFAST_FALLBACK : PLANT_SNACK_FALLBACK;

          const safe = pool.filter((p) => findMealViolations({ name: p }, c).length === 0);
          if (safe.length >= 3) return safe;

          const safeFallback = fallback.filter(
            (p) => findMealViolations({ name: p }, c).length === 0,
          );
          return safeFallback.length ? safeFallback : c.proteinRotation;
        })();

  return withoutDislikedProteins(base, dislikes);
};

/**
 * Remove disliked foods from a protein rotation.
 *
 * Dislikes are soft — a trace of onion in a sauce is not worth rejecting a meal
 * over — so they deliberately stay out of `forbiddenKeywords`. But making a
 * disliked food the *main protein* of a meal is a different matter: a vegan who
 * dislikes tofu was getting tofu as their most frequent protein, because the
 * rotation was only ever filtered against hard restrictions.
 *
 * Falls back to the unfiltered list if dislikes would empty it — some plan beats
 * no plan, and the constraint block still guarantees it is safe to eat.
 */
const withoutDislikedProteins = (proteins: string[], dislikes: string[]): string[] => {
  const disliked = dislikes.map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (disliked.length === 0) return proteins;

  const kept = proteins.filter((p) => {
    const name = p.toLowerCase();
    return !disliked.some((d) => name === d || name.includes(d) || d.includes(name));
  });

  return kept.length >= 2 ? kept : proteins;
};

/**
 * Flavour direction. Deliberately described as a seasoning/technique influence —
 * the prompt forbids putting these words in the dish name, because the old
 * prompt produced titles like "American Chicken and Potato Skillet".
 */
const FLAVOUR_PROFILES = [
  "warm spices (cumin, paprika, coriander)",
  "fresh herbs and lemon",
  "garlic, tomato and olive oil",
  "soy, ginger and sesame",
  "chilli, lime and coriander",
  "mustard, dill and vinegar",
  "smoked paprika and onion",
  "black pepper, butter-style fat and thyme",
  "curry spices and coconut",
  "honey-or-maple sweet-savoury glaze",
];

// NOTE: there is deliberately no separate cooking-method dimension. Each
// archetype already implies its technique, and assigning a method on top of it
// produced contradictions the model dutifully wrote into dish names — "Braised
// Chilli Lime Egg Stir Fry", "Roasted Ginger Sesame Almond Smoothie". Variety
// comes from archetype × protein × flavour, which is a large enough space.

// ─── Seeded rotation ────────────────────────────────────────────────────────

/** Deterministic 32-bit string hash — same seed in, same plan out. */
const hashSeed = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Small deterministic PRNG (mulberry32) so a seed reproduces a whole week. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Walk a list in a seed-dependent order, visiting every entry before repeating.
 * Gives variety across weeks while still guaranteeing no back-to-back repeats
 * within a week — a plain random pick does neither reliably.
 */
const makeCycler = <T>(items: T[], random: () => number) => {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let i = 0;
  return (): T => {
    if (order.length === 0) throw new Error("cycler over empty list");
    const item = order[i % order.length];
    i++;
    return item;
  };
};

/**
 * The diet the user picked, as stored on `user.path`. Only the low-carb ones
 * change which *forms* are on the table; the rest are expressed through the
 * calorie and macro targets, which the archetypes are neutral about.
 */
const LOW_CARB_PATHS = new Set(["keto"]);

/** Whether this user's chosen diet rules out starch-led meal forms. */
export const isLowCarbPath = (path?: string): boolean =>
  LOW_CARB_PATHS.has((path ?? "").toLowerCase());

/**
 * Drop archetypes the user cannot eat: the required ingredient family is
 * forbidden, or the form is starch-led and the diet they chose is not.
 *
 * Without the diet check a keto user was handed a 5%-carb macro target and a
 * "pancakes, waffles, crepes" brief in the same prompt. The two cannot both be
 * satisfied, so the model silently picked one — usually the pancakes.
 *
 * Falls back to the unrestricted forms so a heavily-restricted user still gets
 * a full set of shapes rather than the same two every day.
 */
const usableArchetypes = (
  slot: MealSlot,
  c: DietaryConstraints,
  path?: string,
): string[] => {
  const lowCarb = isLowCarbPath(path);

  const allowed = (a: Archetype) => {
    if (lowCarb && a.carbLed) return false;
    if (!a.requires || !c.hasConstraints) return true;
    return a.requires.every((family) => findMealViolations({ name: family }, c).length === 0);
  };

  const pool = lowCarb
    ? [...ARCHETYPES[slot], ...LOW_CARB_ARCHETYPES[slot]]
    : ARCHETYPES[slot];

  const safe = pool.filter(allowed);
  if (safe.length >= 3) return safe.map((a) => a.form);

  // Not enough shapes survived. Relax the ingredient-family requirement (the
  // hard dietary block in the prompt still protects the user) but never the
  // diet-style one — a low-carb plan made of grain bowls is not a fallback,
  // it is the wrong plan.
  const relaxed = pool.filter((a) => !a.requires && (!lowCarb || !a.carbLed));
  if (relaxed.length) return relaxed.map((a) => a.form);

  const lastResort = lowCarb ? pool.filter((a) => !a.carbLed) : pool;
  return (lastResort.length ? lastResort : ARCHETYPES[slot]).map((a) => a.form);
};

export interface DaySpec {
  dateStr: string;
  dayName: string;
  hasWorkout: boolean;
}

export interface PlannedMeal {
  slot: MealSlot;
  archetype: string;
  protein: string;
  /**
   * Seasoning direction, and only for the two slots where it reads naturally.
   * Empty for breakfast and snacks — a flavour brief on every single meal is
   * what pushed the model into stacking every dimension into the dish name.
   */
  flavour: string;
  calories: number;
}

export interface PlannedDay extends DaySpec {
  meals: PlannedMeal[];
}

/**
 * Build the week's skeleton: one archetype/protein/method/flavour assignment per
 * meal. This is the part that actually fixes repetition and slot-appropriateness,
 * and it is pure and testable without calling the model.
 */
export const buildMenuSkeleton = (
  days: DaySpec[],
  constraints: DietaryConstraints,
  targetCalories: number,
  seed: string,
  /** Soft preferences: kept out of the protein assignment, not banned outright. */
  dislikes: string[] = [],
  /** Which meal slots to include. Defaults to all four. */
  activeSlots: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"],
  /** The diet the user chose (`user.path`). Rules starch-led forms in or out. */
  path?: string,
): PlannedDay[] => {
  const random = rng(hashSeed(seed));

  // Independent cyclers per slot, so breakfast never inherits dinner's protein.
  // Build cyclers for all four slots regardless of activeSlots — the RNG
  // must consume the same number of values so the seed stays stable.
  const archetypeCyclers: Record<MealSlot, () => string> = {
    breakfast: makeCycler(usableArchetypes("breakfast", constraints, path), random),
    lunch: makeCycler(usableArchetypes("lunch", constraints, path), random),
    dinner: makeCycler(usableArchetypes("dinner", constraints, path), random),
    snack: makeCycler(usableArchetypes("snack", constraints, path), random),
  };
  const proteinCyclers: Record<MealSlot, () => string> = {
    breakfast: makeCycler(proteinsForSlot("breakfast", constraints, dislikes), random),
    lunch: makeCycler(proteinsForSlot("lunch", constraints, dislikes), random),
    dinner: makeCycler(proteinsForSlot("dinner", constraints, dislikes), random),
    snack: makeCycler(proteinsForSlot("snack", constraints, dislikes), random),
  };
  const flavourCycler = makeCycler(FLAVOUR_PROFILES, random);

  const calorieShares = slotCalorieShares(activeSlots);

  return days.map((day) => ({
    ...day,
    meals: activeSlots.map((slot) => ({
      slot,
      archetype: archetypeCyclers[slot](),
      protein: proteinCyclers[slot](),
      flavour: slot === "lunch" || slot === "dinner" ? flavourCycler() : "",
      calories: Math.round(targetCalories * calorieShares[slot]),
    })),
  }));
};

// ─── Prompt assembly ────────────────────────────────────────────────────────

/**
 * Stable across every request for a given deployment, so it is a good candidate
 * for Gemini context caching and keeps the per-request prompt small.
 */
export const MEAL_PLAN_SYSTEM_INSTRUCTION = `You are a registered dietitian writing weekly meal plans for ordinary home cooks.

How you work:
- You cook like a competent home cook, not a restaurant. Dishes use supermarket ingredients and finish in under 45 minutes unless the plan says otherwise.
- You follow the menu outline you are given exactly: it fixes the form, main protein, cooking method and flavour direction of every meal. You choose the actual dish, its ingredients and its real nutrition.
- The outline is a brief, not a naming template. Never assemble a dish name by joining the fields you were given. Decide what the dish actually is, then name that. "Chilli Lime Roasted Peach Oats" and "Thyme Butter Almond Gravy Plate" are what happens when the fields get concatenated — they are not real food and are unacceptable.
- Dish names read like something off a family menu: "Lemon Herb Chicken with Roast Potatoes", "Peanut Butter Banana Oats", "Black Bean Chilli". Two to five words, at most one seasoning word. Never open a name with a nationality or cuisine label ("American ...", "Mediterranean ...").
- If a brief would produce something nobody would eat, keep the form and the protein and quietly drop the seasoning direction. A plain, real dish always beats a novel one.
- Breakfast must read as breakfast. A dish a person would only eat at 7pm does not belong in the breakfast slot, whatever protein the outline assigns — build it into a genuinely morning form (scramble, oats, yogurt bowl, toast, smoothie, pancake, breakfast hash).
- Nutrition is derived from the ingredients you list, at the amounts you list. You do not restate the target numbers: you write what the food actually contains, which will land near the target but rarely exactly on it.
- Hard dietary constraints outrank everything else, including the outline. If the outline suggests something a constraint forbids, you keep the form and swap the ingredient.

You always return valid JSON matching the requested schema, with no commentary.`;

const ingredientRules = `INGREDIENT FORMAT — each entry is a single string "name|amount|unit|category":
- name: the raw ingredient in lowercase with underscores. No preparation words ("chopped", "diced", "fresh", "dried", "sliced", "ground", "cooked").
- amount: a number. unit: g, ml, tbsp, tsp, piece, slice, cup.
- category: exactly one of Proteins, Vegetables, Fruits, Grains, Dairy, Pantry, Spices.
- List every ingredient that carries meaningful calories. Include the fat you cook in.
- Example: "red_lentils|120|g|Grains", "olive_oil|1|tbsp|Pantry"`;

const nutritionRules = `NUTRITION — this is checked:
- protein, carbs and fat are grams for the whole meal, computed from the ingredient amounts above.
- calories must equal protein*4 + carbs*4 + fat*9, rounded to the nearest whole number.
- Aim within about 10% of each meal's calorie target. Do not force an exact match — a real dish rarely lands on a round number.`;

export interface WeeklyPromptInput {
  userData: {
    age?: number;
    gender?: string;
    height?: number;
    weight?: number;
    path?: string;
    dislikes?: string[];
    foodPreferences?: string[];
    unrecognisedTerms?: string[];
    /** How much cooking the user says they'll do. Sets the prep ceiling and the
     *  techniques the plan may assume. */
    cookingLevel?: CookingLevel;
  };
  skeleton: PlannedDay[];
  constraints: DietaryConstraints;
  targetCalories: number;
  macros: { protein: number; carbs: number; fat: number };
  /** Dish names the user has had recently — never repeat these. */
  recentMeals?: string[];
  /** Free-text style note from the user's goals or a plan template. */
  styleNote?: string;
  /** Mood/wellness context, already summarised. */
  moodContext?: string;
  /** What the user's own history says about how this week has to be shaped —
   *  which meals they actually follow, how long they'll really cook for, which
   *  days are hard. Produced by the behaviour pipeline, already reduced to
   *  instructions. See src/behavior/behavior.prompts.ts. */
  behaviourContext?: string;
  /** Instruction added when re-generating days that failed verification. */
  repairNote?: string;
  /** Cooking-time ceiling in minutes, as observed by the behaviour pipeline.
   *  It can only tighten the user's declared cooking level, never loosen it. */
  maxPrepMinutes?: number;
  /** BCP-47/ISO language code for the response text. Defaults to English. */
  language?: string;
  /** Fasting/meal-frequency context to inject into the prompt. */
  fastingContext?: string;
}

const renderDay = (day: PlannedDay): string => {
  const lines = day.meals.map((m) => {
    const bits = [
      `form: ${m.archetype}`,
      `main protein: ${m.protein}`,
      m.flavour ? `season towards: ${m.flavour}` : null,
      `~${m.calories} kcal`,
    ].filter(Boolean);
    return `    ${m.slot.padEnd(9)} → ${bits.join(" | ")}`;
  });
  return `  ${day.dateStr} (${day.dayName})${day.hasWorkout ? " — training day, this day's meals should skew higher protein" : " — rest day"}\n${lines.join("\n")}`;
};

/**
 * The per-request prompt. Everything invariant lives in the system instruction;
 * this carries only the user's situation and the outline to execute.
 */
export const buildWeeklyPlanPrompt = (input: WeeklyPromptInput): string => {
  const {
    userData, skeleton, constraints, targetCalories, macros,
    recentMeals = [], styleNote, moodContext, behaviourContext, repairNote,
    maxPrepMinutes, language = "en", fastingContext,
  } = input;

  // Two sources want a say in how long a meal may take: what the user told us
  // they can cook, and what their history shows they actually finish. The
  // lower one wins — a declared "confident cook" who abandons anything over 25
  // minutes should not keep being handed 75-minute dinners, and a declared
  // beginner should never be handed one because the behaviour pipeline hasn't
  // seen enough of them yet.
  const declaredPrepCeiling = prepCeilingFor(userData.cookingLevel);
  const effectiveMaxPrep = Math.min(
    declaredPrepCeiling ?? DEFAULT_MAX_PREP_MINUTES,
    maxPrepMinutes ?? Number.POSITIVE_INFINITY,
  );
  const cookingSpec = userData.cookingLevel
    ? COOKING_LEVEL_SPECS[userData.cookingLevel]
    : null;
  const needsEnglishName = language.toLowerCase() !== "en";

  // Terms the user was warned about but kept ("white socks" as a dislike) are
  // dropped before the prompt: they are noise that costs tokens and competes
  // with real instructions. Allergies are deliberately NOT filtered this way —
  // they flow through `constraints`, so a wrongly flagged allergen still binds.
  const unrecognised = new Set(
    (userData.unrecognisedTerms || [])
      .filter(Boolean)
      .map((t: string) => t.trim().toLowerCase()),
  );
  const keepRecognised = (list: string[]) =>
    unrecognised.size
      ? list.filter((t) => !unrecognised.has(String(t).trim().toLowerCase()))
      : list;

  const dislikes = keepRecognised((userData.dislikes || []).filter(Boolean));
  const constraintBlock = buildDietaryConstraintBlock(constraints, dislikes);

  // Preferences MUST be filtered against the hard constraints before they reach
  // the prompt. A vegan whose stored preferences still contain "Sirloin Steak"
  // would otherwise be described to the model as someone who enjoys steak, in
  // the same prompt that forbids meat — and the model resolves that
  // contradiction by cooking the steak.
  const { allowed: prefs, removed: droppedPrefs } = filterFoodPreferences(
    keepRecognised((userData.foodPreferences || []).filter(Boolean)),
    constraints,
  );
  if (droppedPrefs.length) {
    logger.warn(
      `[MealGen] Dropped food preferences that conflict with dietary restrictions: ${droppedPrefs.join(", ")}`,
    );
  }

  const sections: string[] = [];

  if (constraintBlock) sections.push(constraintBlock);
  if (fastingContext) sections.push(`FASTING SCHEDULE\n${fastingContext}`);
  if (repairNote) sections.push(`CORRECTION REQUIRED\n${repairNote}`);

  sections.push(
    [
      `PERSON: ${userData.age ?? "?"}y ${userData.gender ?? "?"}, ${userData.height ?? "?"}cm, ${userData.weight ?? "?"}kg, goal: ${userData.path ?? "maintain"}`,
      `LANGUAGE: Respond in ${language} — dish names and ingredient names must be written in ${language}.`,
      `DAILY TARGET: ${targetCalories} kcal — protein ${macros.protein}g, carbs ${macros.carbs}g, fat ${macros.fat}g`,
      `MAX PREP TIME: ${effectiveMaxPrep} minutes per meal`,
      cookingSpec
        ? `COOKING SKILL: ${cookingSpec.label} — ${cookingSpec.guidance}`
        : null,
      dislikes.length ? `NEVER INCLUDE (disliked): ${dislikes.join(", ")}` : null,
      // Scoped to lunch and dinner: a preference like "steak" or "curry" is a
      // dinner taste, and letting it reach breakfast is how it turns up next to
      // the morning oats.
      prefs.length
        ? `ENJOYS (loose inspiration for LUNCH and DINNER only, never a rule, and never applied to breakfast or snacks): ${prefs.join(", ")}`
        : null,
      styleNote ? `STYLE NOTE: ${styleNote.slice(0, 300)}` : null,
      moodContext ? `WELLNESS CONTEXT: ${moodContext}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  // Placed before the menu outline: these are constraints on the shape of the
  // week, and the model should read them before it reads what to cook. This is
  // the whole reason the plan differs from last week's — a plan that ignored a
  // repeatedly skipped breakfast just produced the same breakfast again.
  if (behaviourContext) {
    sections.push(
      `COACH'S BRIEF ON THIS USER — written by the analyst who reviewed a month of their logs.\nTreat it as requirements, not suggestions. The aim is a week they will actually follow, not the most impressive week you can write:\n${behaviourContext}`,
    );
  }

  if (recentMeals.length) {
    sections.push(
      `ALREADY EATEN RECENTLY — do not reuse these dishes or close variants of them:\n${recentMeals
        .slice(0, 40)
        .map((m) => `- ${m}`)
        .join("\n")}`,
    );
  }

  sections.push(
    `MENU OUTLINE — follow this exactly, one dish per line:\n${skeleton.map(renderDay).join("\n\n")}`,
  );

  sections.push(ingredientRules);
  sections.push(nutritionRules);

  // Derive active slot set from the skeleton to build a dynamic output schema
  const activeSlotSet = new Set(skeleton[0]?.meals.map((m) => m.slot) ?? ["breakfast", "lunch", "dinner", "snack"]);
  const mealSchema = [
    activeSlotSet.has("breakfast") ? `"breakfast":MEAL` : null,
    activeSlotSet.has("lunch") ? `"lunch":MEAL` : null,
    activeSlotSet.has("dinner") ? `"dinner":MEAL` : null,
    activeSlotSet.has("snack") ? `"snacks":[MEAL]` : null,
  ].filter(Boolean).join(",");

  sections.push(
    `VARIETY — every one of the ${skeleton.length * activeSlotSet.size} dishes must be different. Do not reuse a dish name, and do not serve the same protein-and-starch combination twice in the week.`,
  );

  sections.push(
    `RETURN a JSON array with one object per day, in the order listed above:
[{"date":"YYYY-MM-DD","day":"monday","meals":{${mealSchema}},"workouts":[]}]

MEAL = {"name":string,"calories":number,"macros":{"protein":number,"carbs":number,"fat":number},"ingredients":[string],"prepTime":number${needsEnglishName ? `,"nameEn":string` : ""}}
${needsEnglishName ? `\nEvery MEAL must also include "nameEn": the plain English name of the same dish (e.g. "name":"עוף בגריל עם ברוקולי" → "nameEn":"Grilled Chicken with Broccoli"). It is used only to look up a photo — it is never shown to the user.\n` : ""}
On training days include exactly one workout: {"name":string,"category":string,"duration":number,"caloriesBurned":number}. On rest days "workouts" is [].`,
  );

  return sections.join("\n\n");
};

/**
 * Seed for the week's rotation. Includes the week start so the same user gets a
 * different shape next week, and the user id so two users never share a plan.
 */
export const planSeed = (userId: string, weekStartKey: string, salt = ""): string =>
  `${userId}:${weekStartKey}:${salt}`;
