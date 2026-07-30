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
  findMealViolations,
} from "../utils/dietary-constraints";

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
}

const BREAKFAST_ARCHETYPES: Archetype[] = [
  { form: "egg-based hot dish (scramble, omelette, frittata, shakshuka)", requires: ["egg"] },
  { form: "hot porridge or cooked grain bowl (oats, congee, semolina, millet)" },
  { form: "creamy yogurt- or curd-style bowl with fruit and a crunchy topping", requires: ["yogurt"] },
  { form: "handheld toast, flatbread or breakfast wrap with a savoury topping", requires: ["bread"] },
  { form: "blended smoothie or smoothie bowl with a thickener and topping" },
  { form: "batter-based griddle item (pancakes, waffles, crepes)", requires: ["flour"] },
  { form: "savoury breakfast skillet or hash built on potato or sweet potato" },
  { form: "overnight / no-cook soaked grain or chia pot with fruit" },
  { form: "protein-forward breakfast plate with a starch and a vegetable" },
];

const LUNCH_ARCHETYPES: Archetype[] = [
  { form: "substantial salad bowl with a protein and a dressing" },
  { form: "sandwich, wrap or pita filled with a protein and vegetables", requires: ["bread"] },
  { form: "grain bowl with a protein, two vegetables and a sauce" },
  { form: "hearty soup or broth with a side of bread or crackers" },
  { form: "cold noodle or pasta salad with a protein" , requires: ["pasta"] },
  { form: "one-pan skillet of protein, vegetables and a starch" },
  { form: "stuffed or filled vegetable (peppers, sweet potato, courgette)" },
  { form: "flatbread, quesadilla or savoury pancake with a filling", requires: ["flour"] },
  { form: "rice or grain plate with a stew-style topping" },
];

const DINNER_ARCHETYPES: Archetype[] = [
  { form: "roasted or baked main with two simple sides" },
  { form: "stir-fry over rice or noodles" },
  { form: "slow-simmered stew, chilli or curry with a starch" },
  { form: "grilled or pan-seared main with a salad and a starch" },
  { form: "pasta or noodle dish with a sauce and a vegetable", requires: ["pasta"] },
  { form: "sheet-pan tray bake of protein and vegetables" },
  { form: "tacos, burritos or filled tortillas with sides", requires: ["tortilla"] },
  { form: "layered or baked casserole" },
  { form: "soup-and-side dinner with a substantial bread", requires: ["bread"] },
  { form: "burger, patty or kofta with a starch and a vegetable" },
];

const SNACK_ARCHETYPES: Archetype[] = [
  { form: "fruit paired with a protein or fat source" },
  { form: "yogurt-style pot or pudding", requires: ["yogurt"] },
  { form: "raw vegetables with a dip" },
  { form: "no-bake energy bite or bar" },
  { form: "cracker, rice cake or toast with a spread", requires: ["bread"] },
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
const proteinsForSlot = (slot: MealSlot, c: DietaryConstraints): string[] => {
  if (slot === "lunch" || slot === "dinner") return c.proteinRotation;

  const pool = slot === "breakfast" ? BREAKFAST_PROTEIN_POOL : SNACK_PROTEIN_POOL;
  const fallback = slot === "breakfast" ? PLANT_BREAKFAST_FALLBACK : PLANT_SNACK_FALLBACK;

  const safe = pool.filter((p) => findMealViolations({ name: p }, c).length === 0);
  if (safe.length >= 3) return safe;

  const safeFallback = fallback.filter((p) => findMealViolations({ name: p }, c).length === 0);
  return safeFallback.length ? safeFallback : c.proteinRotation;
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
 * Drop archetypes whose required ingredient family the user cannot eat.
 * Falls back to the unrestricted forms so a heavily-restricted user still gets
 * a full set of shapes rather than the same two every day.
 */
const usableArchetypes = (slot: MealSlot, c: DietaryConstraints): string[] => {
  const safe = ARCHETYPES[slot].filter((a) => {
    if (!a.requires || !c.hasConstraints) return true;
    return a.requires.every((family) => findMealViolations({ name: family }, c).length === 0);
  });
  const chosen = safe.length >= 3 ? safe : ARCHETYPES[slot].filter((a) => !a.requires);
  return (chosen.length ? chosen : ARCHETYPES[slot]).map((a) => a.form);
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
): PlannedDay[] => {
  const random = rng(hashSeed(seed));

  // Independent cyclers per slot, so breakfast never inherits dinner's protein.
  const archetypeCyclers: Record<MealSlot, () => string> = {
    breakfast: makeCycler(usableArchetypes("breakfast", constraints), random),
    lunch: makeCycler(usableArchetypes("lunch", constraints), random),
    dinner: makeCycler(usableArchetypes("dinner", constraints), random),
    snack: makeCycler(usableArchetypes("snack", constraints), random),
  };
  const proteinCyclers: Record<MealSlot, () => string> = {
    breakfast: makeCycler(proteinsForSlot("breakfast", constraints), random),
    lunch: makeCycler(proteinsForSlot("lunch", constraints), random),
    dinner: makeCycler(proteinsForSlot("dinner", constraints), random),
    snack: makeCycler(proteinsForSlot("snack", constraints), random),
  };
  const flavourCycler = makeCycler(FLAVOUR_PROFILES, random);

  const slots: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

  return days.map((day) => ({
    ...day,
    meals: slots.map((slot) => ({
      slot,
      archetype: archetypeCyclers[slot](),
      protein: proteinCyclers[slot](),
      flavour: slot === "lunch" || slot === "dinner" ? flavourCycler() : "",
      calories: Math.round(targetCalories * SLOT_CALORIE_SHARE[slot]),
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
  /** Instruction added when re-generating days that failed verification. */
  repairNote?: string;
  /** Cooking-time ceiling in minutes. */
  maxPrepMinutes?: number;
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
    recentMeals = [], styleNote, moodContext, repairNote, maxPrepMinutes = 45,
  } = input;

  const constraintBlock = buildDietaryConstraintBlock(constraints);
  const dislikes = (userData.dislikes || []).filter(Boolean);
  const prefs = (userData.foodPreferences || []).filter(Boolean);

  const sections: string[] = [];

  if (constraintBlock) sections.push(constraintBlock);
  if (repairNote) sections.push(`CORRECTION REQUIRED\n${repairNote}`);

  sections.push(
    [
      `PERSON: ${userData.age ?? "?"}y ${userData.gender ?? "?"}, ${userData.height ?? "?"}cm, ${userData.weight ?? "?"}kg, goal: ${userData.path ?? "maintain"}`,
      `DAILY TARGET: ${targetCalories} kcal — protein ${macros.protein}g, carbs ${macros.carbs}g, fat ${macros.fat}g`,
      `MAX PREP TIME: ${maxPrepMinutes} minutes per meal`,
      dislikes.length ? `NEVER INCLUDE (disliked): ${dislikes.join(", ")}` : null,
      prefs.length ? `ENJOYS (use as flavour inspiration where the outline allows, not as a rule): ${prefs.join(", ")}` : null,
      styleNote ? `STYLE NOTE: ${styleNote.slice(0, 300)}` : null,
      moodContext ? `WELLNESS CONTEXT: ${moodContext}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

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

  sections.push(
    `VARIETY — every one of the ${skeleton.length * 4} dishes must be different. Do not reuse a dish name, and do not serve the same protein-and-starch combination twice in the week.`,
  );

  sections.push(
    `RETURN a JSON array with one object per day, in the order listed above:
[{"date":"YYYY-MM-DD","day":"monday","meals":{"breakfast":MEAL,"lunch":MEAL,"dinner":MEAL,"snacks":[MEAL]},"workouts":[]}]

MEAL = {"name":string,"calories":number,"macros":{"protein":number,"carbs":number,"fat":number},"ingredients":[string],"prepTime":number}

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
