/**
 * Dish tuning — docs/the-repertoire.md §5.
 *
 * The model proposes three tuned versions of a dish the user already cooks.
 * It is asked for the *same dish*; `validateTunes` is what makes sure that is
 * what we keep. A tune is dropped when its numbers don't add up, when it moves
 * calories in the wrong direction for the user's goal, when it touches a
 * forbidden ingredient, or when it changes more than a tune is allowed to —
 * the point where it has quietly become a new recipe.
 *
 * Tunes are generated once per dish and cached. They depend on the dish and
 * the user's diet path, not on this week's calorie target: hitting the target
 * is the weekly balancer's job (§6), by portion scaling a tune it already has.
 */

import { Injectable } from "@nestjs/common";
import { ANALYSIS_MODELS, callGeminiWithFallback } from "../utils/gemini-models";
import {
  DietaryConstraints,
  buildDietaryConstraintBlock,
  findMealViolations,
} from "../utils/dietary-constraints";
import { ingredientKey } from "../utils/ingredient-key";
import { dishKey } from "./repertoire.capture";
import logger from "../utils/logger";
import { IDishNutrition, IRepertoireDish } from "./repertoire-dish.schema";

export type TuneLevel = 1 | 2 | 3;

export interface ProposedIngredient {
  name: string;
  amount: string;
}

export interface ProposedTune {
  level: TuneLevel;
  /** What the dish is called now — this is what the user sees on their plan. */
  name: string;
  /** One line in terms of their own dish: "Your schnitzel, oven-baked". */
  swapNote: string;
  changes: string[];
  ingredients: ProposedIngredient[];
  nutritionPerServing: IDishNutrition;
}

export interface TuneProposal {
  /** Only returned when the dish had no ingredients — i.e. it was captured from
   *  logs. The model reconstructs how the dish is typically made. */
  usual: { ingredients: ProposedIngredient[]; nutritionPerServing: IDishNutrition } | null;
  tunes: ProposedTune[];
  /** Why each dropped tune was dropped, for logs and tests. */
  dropped: { level: number; reason: string }[];
}

/**
 * A version may list at most this many differences per level.
 *
 * Each level restates the ones below it, so level 2 carries level 1's changes
 * plus its own.
 */
export const MAX_CHANGES_PER_LEVEL = 3;

/** Words that carry no meaning when matching one dish against another. */
const STOPWORDS = new Set([
  "with", "and", "the", "for", "a", "an", "of", "in", "on", "my", "our", "her", "his",
  "style", "homemade", "home", "fresh", "classic", "easy", "quick", "simple", "best",
  "favourite", "favorite", "plate", "bowl", "dish", "served", "side", "sides",
]);

const words = (text: string): string[] =>
  (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * Is this still the same kind of food to the person who eats it?
 *
 * A swap has to be recognisable: their schnitzel may become baked chicken, but
 * it may not become a salad. Judged on the main ingredients rather than the
 * name, because a good swap renames the dish on purpose.
 */
export const staysTheSameFood = (
  originalName: string,
  originalIngredients: { name: string }[],
  tuneName: string,
  tuneIngredients: { name: string }[],
): boolean => {
  const before = [...new Set([...words(originalName), ...originalIngredients.flatMap((i) => words(i.name))])];
  const after = [...new Set([...words(tuneName), ...tuneIngredients.flatMap((i) => words(i.name))])];
  if (!before.length || !after.length) return true; // nothing to judge on

  // "chicken" against "chicken_breast" is the same food, not a coincidence.
  const shared = after.filter((word) =>
    before.some((b) => b === word || b.includes(word) || word.includes(b)),
  ).length;
  return shared >= 1 && shared / after.length >= 0.25;
};

/** Energy from macros may differ from stated calories by at most this share. */
const ENERGY_TOLERANCE = 0.15;

// ─── Goal direction by diet path ────────────────────────────────────────────

interface PathGoal {
  /** What "healthier" means for this user, in the model's terms. */
  direction: string;
  /**
   * Sanity bounds on the swap's calories, not a target.
   *
   * A real swap changes the food, so its calories move: baked chicken instead
   * of fried schnitzel is 31% lighter, and a tight range rejected exactly the
   * swaps this feature exists for. The plan portions every dish to its slot
   * anyway; what has to be right is the balance, below.
   */
  calorieRange: [number, number];
  /** Tuned carbs may not exceed usual carbs. */
  capCarbs: boolean;
  /** Which way the mix has to move for this to count as healthier. */
  betterMeans: "less fat" | "more protein" | "fewer carbs";
}

const DEFAULT_GOAL: PathGoal = {
  direction:
    "balanced: at least as much protein, more vegetables and fibre, less added fat and refined starch — the mix matters more than the total",
  calorieRange: [0.5, 1.4],
  capCarbs: false,
  betterMeans: "less fat",
};

const PATH_GOALS: Record<string, PathGoal> = {
  lose: {
    direction:
      "weight loss: lower energy density per serving while keeping protein at least as high, so the plate stays filling — more vegetables, less oil and refined starch",
    calorieRange: [0.5, 1.1],
    capCarbs: false,
    betterMeans: "less fat",
  },
  muscle: {
    direction:
      "muscle gain: more protein per serving, portions kept generous, starch kept for training days",
    calorieRange: [0.7, 1.4],
    capCarbs: false,
    betterMeans: "more protein",
  },
  running: {
    direction:
      "endurance training: this is about the MIX, not eating less. Keep the calories about where they are — swap refined starch for whole grains and keep the carbohydrate that fuels the runs, trim added fat, keep protein adequate",
    calorieRange: [0.5, 1.35],
    capCarbs: false,
    betterMeans: "less fat",
  },
  keto: {
    direction:
      "keto: replace starch with vegetables or fat, keep protein moderate — carbs must go down",
    calorieRange: [0.5, 1.35],
    capCarbs: true,
    betterMeans: "fewer carbs",
  },
};

export const goalForPath = (path?: string | null): PathGoal => {
  const p = (path ?? "").toLowerCase();
  const key = p === "lose-weight" ? "lose" : p === "gain-muscle" ? "muscle" : p;
  return PATH_GOALS[key] ?? DEFAULT_GOAL;
};

// ─── Prompt ─────────────────────────────────────────────────────────────────

export const TUNER_SYSTEM_INSTRUCTION = `You are a dietitian who helps someone eat better by swapping a dish they already eat for a healthier dish they would happily eat instead.

You are given one dish this person makes regularly. Return three versions of it — a ladder from the smallest change to the biggest. Each one is a DISH WITH ITS OWN NAME that they will see on their plan.

What a good swap is:

- Recognisably the same food to this person: same main ingredient and the same kind of meal. Fried chicken schnitzel → oven-baked chicken schnitzel → baked chicken breast with the same salad. Creamy pasta → pasta with tomato and basil. Beef burger → grilled beef burger in a wholemeal bun.
- Something they would order on a normal weeknight: ordinary home cooking, no unfamiliar ingredients, no restaurant technique.
- Honestly better: less added fat, less refined starch, more vegetables or fibre, protein kept up.

What a swap is NOT:

- Not the same dish with smaller numbers. Changing 150 g to 130 g is invisible to a person and does not count as a version.
- Not a different food. Schnitzel does not become a salad, a soup does not become a stir-fry.
- Not a new project: no ingredient they would have to go looking for, nothing that takes much longer to make.

The three levels:

- Level 1 — the same dish, cooked better. The cooking method or one ingredient changes (fried → oven-baked, white rice → wholegrain, cream → yoghurt). The name usually gains a word: "Oven-baked chicken schnitzel".
- Level 2 — the nearest healthier relative. The dish changes but the meal does not: same protein, same role on the plate, same sides. "Baked chicken breast with the same salad".
- Level 3 — the version someone who eats well would make, still clearly from the same family and still something this person would eat.

For each level give:

- "name": what the dish is called now. It must be different from the original name unless truly nothing changed.
- "swapNote": one short line the person will read, saying what it is in terms of their own dish — e.g. "Your schnitzel, oven-baked instead of fried".
- "changes": the few concrete differences, at most 3 at level 1, 6 at level 2, 9 at level 3.
- "ingredients" and "nutritionPerServing" for one serving, with calories ≈ 4×protein + 4×carbs + 9×fat.

Return JSON only:
{
  "usual": { "ingredients": [{"name": "...", "amount": "..."}], "nutritionPerServing": {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0} } | null,
  "tunes": [
    { "level": 1, "name": "...", "swapNote": "...", "changes": ["..."], "ingredients": [{"name": "...", "amount": "..."}], "nutritionPerServing": {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0} },
    { "level": 2, ... },
    { "level": 3, ... }
  ]
}`;

export const buildTunePrompt = (
  dish: Pick<IRepertoireDish, "name" | "slots" | "usual">,
  path: string | null | undefined,
  constraints: DietaryConstraints,
  dislikes: string[] = [],
): string => {
  const goal = goalForPath(path);
  const known = dish.usual.ingredients.length > 0;
  const n = dish.usual.nutritionPerServing;

  const sections: string[] = [
    `DISH: ${dish.name}`,
    dish.slots.length ? `EATEN AS: ${dish.slots.join(", ")}` : "",
  ];

  if (known) {
    sections.push(
      `HOW THEY MAKE IT NOW (one serving):\n${dish.usual.ingredients
        .map((i) => `- ${i.name}: ${i.amount}`)
        .join("\n")}`,
    );
  } else {
    sections.push(
      `We do not have their recipe. First reconstruct how this dish is typically made at home, as "usual" — ordinary supermarket ingredients, one serving.` +
        (n
          ? ` Their logged serving is about ${n.calories} kcal (protein ${n.protein} g, carbs ${n.carbs} g, fat ${n.fat} g); make "usual" match that.`
          : ""),
    );
  }

  if (known && n) {
    sections.push(
      `CURRENT NUTRITION PER SERVING: ${n.calories} kcal, protein ${n.protein} g, carbs ${n.carbs} g, fat ${n.fat} g.`,
    );
  }

  sections.push(`WHAT BETTER MEANS FOR THIS PERSON: ${goal.direction}.`);
  if (goal.capCarbs) sections.push("Carbs must be lower at every level than in the usual version.");

  const constraintBlock = buildDietaryConstraintBlock(constraints);
  if (constraintBlock) sections.push(constraintBlock);
  if (dislikes.length) sections.push(`NEVER ADD (disliked): ${dislikes.join(", ")}`);

  sections.push(`Return "usual" as ${known ? "null" : "the reconstructed recipe"}.`);

  return sections.filter(Boolean).join("\n\n");
};

// ─── Validation ─────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

const parseNutrition = (raw: any): IDishNutrition | null => {
  if (!raw || !isNum(raw.calories) || raw.calories <= 0) return null;
  if (!isNum(raw.protein) || !isNum(raw.carbs) || !isNum(raw.fat)) return null;
  const out: IDishNutrition = {
    calories: Math.round(raw.calories),
    protein: Math.round(raw.protein),
    carbs: Math.round(raw.carbs),
    fat: Math.round(raw.fat),
  };
  if (isNum(raw.fiber)) out.fiber = Math.round(raw.fiber);
  return out;
};

/** Stated calories agree with the energy in the stated macros. */
export const energyConsistent = (n: IDishNutrition): boolean => {
  const fromMacros = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  return Math.abs(fromMacros - n.calories) <= ENERGY_TOLERANCE * n.calories;
};

const parseIngredients = (raw: any): ProposedIngredient[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((i) => i && typeof i.name === "string" && i.name.trim())
    .map((i) => ({ name: i.name.trim(), amount: String(i.amount ?? "").trim() }));

/**
 * Disliked foods a tune brings in. A dislike already in the user's own recipe
 * is theirs to keep — the tune didn't add it.
 */
export const addedDislikes = (
  ingredients: ProposedIngredient[],
  baseline: { name: string }[],
  dislikes: string[],
): string[] => {
  const has = (list: { name: string }[], word: string) =>
    list.some((i) => i.name.toLowerCase().includes(word));
  return dislikes
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d && has(ingredients, d) && !has(baseline, d));
};

/** Where a dish's calories come from. */
const macroShares = (n: IDishNutrition) => {
  const kcal = n.protein * 4 + n.carbs * 4 + n.fat * 9 || n.calories || 1;
  return { protein: (n.protein * 4) / kcal, carbs: (n.carbs * 4) / kcal, fat: (n.fat * 9) / kcal };
};

/** Enough of a shift to be worth serving instead of their own version. */
const MEANINGFUL_SHIFT = 0.02;

/**
 * Is the swap actually healthier for this person?
 *
 * Judged on the mix rather than the calorie count: their dish portioned
 * smaller is not a healthier dish, and a swap that is lighter only because it
 * is less food teaches nothing.
 */
export const improvesBalance = (
  usual: IDishNutrition,
  tune: IDishNutrition,
  betterMeans: PathGoal["betterMeans"],
): boolean => {
  const before = macroShares(usual);
  const after = macroShares(tune);
  if (betterMeans === "more protein") {
    return after.protein >= before.protein + MEANINGFUL_SHIFT || after.fat <= before.fat - MEANINGFUL_SHIFT;
  }
  if (betterMeans === "fewer carbs") return after.carbs <= before.carbs - MEANINGFUL_SHIFT;
  return after.fat <= before.fat - MEANINGFUL_SHIFT || after.protein >= before.protein + MEANINGFUL_SHIFT;
};

/** Same ingredients, whatever the amounts say. */
const sameIngredientSet = (
  before: { name: string }[],
  after: { name: string }[],
): boolean => {
  const keys = (list: { name: string }[]) => new Set(list.map((i) => ingredientKey(i.name)));
  const a = keys(before);
  const b = keys(after);
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
};

const parseChanges = (raw: any): string[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((c) => typeof c === "string" && c.trim())
    .map((c: string) => c.trim());

export const validateTunes = (
  raw: any,
  dish: Pick<IRepertoireDish, "name" | "usual">,
  path: string | null | undefined,
  constraints: DietaryConstraints,
  dislikes: string[] = [],
): TuneProposal => {
  const goal = goalForPath(path);
  const dropped: TuneProposal["dropped"] = [];

  // The baseline: the dish's own record when we have it, else what the model
  // reconstructed. A reconstruction that doesn't add up gives no baseline, and
  // with no baseline no tune can be judged, so nothing is kept.
  let usual: TuneProposal["usual"] = null;
  if (dish.usual.ingredients.length === 0) {
    const ingredients = parseIngredients(raw?.usual?.ingredients);
    const nutrition = parseNutrition(raw?.usual?.nutritionPerServing);
    if (ingredients.length && nutrition && energyConsistent(nutrition)) {
      usual = { ingredients, nutritionPerServing: nutrition };
    }
  }
  const baseline = dish.usual.nutritionPerServing ?? usual?.nutritionPerServing ?? null;
  const baselineIngredients = dish.usual.ingredients.length
    ? dish.usual.ingredients
    : usual?.ingredients ?? [];
  // Every tune is shown as a diff from the recipe; without one there is
  // nothing to diff against, even when the logs gave us nutrition.
  if (!baseline || !baselineIngredients.length) {
    return { usual: null, tunes: [], dropped: [{ level: 0, reason: "no usable baseline" }] };
  }

  const tunes: ProposedTune[] = [];
  const seen = new Set<number>();

  for (const t of Array.isArray(raw?.tunes) ? raw.tunes : []) {
    const level = t?.level;
    const drop = (reason: string) => dropped.push({ level: Number(level) || 0, reason });

    if (level !== 1 && level !== 2 && level !== 3) { drop("invalid level"); continue; }
    if (seen.has(level)) { drop("duplicate level"); continue; }

    const changes = parseChanges(t.changes);
    const ingredients = parseIngredients(t.ingredients);
    const nutrition = parseNutrition(t.nutritionPerServing);
    const tuneName = typeof t.name === "string" ? t.name.trim() : "";
    const swapNote = typeof t.swapNote === "string" ? t.swapNote.trim() : "";

    // The user meets this as a dish on their plan. Nobody re-reads a recipe to
    // notice 20 g less chicken, so a version with no name of its own is a
    // change the user would never see — and therefore not a change at all.
    if (!tuneName) { drop("no name — the user would never see this change"); continue; }
    if (!changes.length) { drop("no changes listed"); continue; }
    if (changes.length > MAX_CHANGES_PER_LEVEL * level) {
      drop(`${changes.length} changes — a new recipe, not a tune`);
      continue;
    }
    if (!ingredients.length) { drop("no ingredients"); continue; }
    if (!nutrition) { drop("missing nutrition"); continue; }
    if (!energyConsistent(nutrition)) { drop("calories do not match macros"); continue; }

    if (!improvesBalance(baseline, nutrition, goal.betterMeans)) {
      drop(`"${tuneName}" is not a healthier version — the balance barely moves`);
      continue;
    }

    const ratio = nutrition.calories / baseline.calories;
    if (ratio < goal.calorieRange[0] || ratio > goal.calorieRange[1]) {
      drop(`calories ${Math.round(ratio * 100)}% of usual, outside the goal's range`);
      continue;
    }
    if (goal.capCarbs && nutrition.carbs > baseline.carbs) { drop("carbs went up on a low-carb path"); continue; }

    // Recognisably their food still: schnitzel may become baked chicken, but
    // not a salad.
    if (!staysTheSameFood(dish.name, baselineIngredients, tuneName, ingredients)) {
      drop(`"${tuneName}" is a different food, not a healthier version of theirs`);
      continue;
    }

    // The user meets this on their plan as a meal, and they read the name.
    // A version called exactly what their own dish is called is a change they
    // cannot see, whatever moved underneath it.
    if (dishKey(tuneName) === dishKey(dish.name)) {
      drop(`"${tuneName}" keeps the original name — the change would be invisible`);
      continue;
    }

    // Belt and braces: nor may it be their recipe with the amounts shuffled.
    if (sameIngredientSet(baselineIngredients, ingredients)) {
      drop("same ingredients — only the amounts moved");
      continue;
    }

    const violations = findMealViolations({ name: tuneName, ingredients }, constraints);
    if (violations.length) { drop(`violates dietary constraints (${violations.join(", ")})`); continue; }

    const added = addedDislikes(ingredients, baselineIngredients, dislikes);
    if (added.length) { drop(`adds disliked ${added.join(", ")}`); continue; }

    seen.add(level);
    tunes.push({ level, name: tuneName, swapNote, changes, ingredients, nutritionPerServing: nutrition });
  }

  // Levels build on each other; a level 3 with no level 2 has nothing to step
  // up from, and the user would jump two rungs at once.
  tunes.sort((a, b) => a.level - b.level);
  const contiguous: ProposedTune[] = [];
  for (const t of tunes) {
    if (t.level !== contiguous.length + 1) {
      dropped.push({ level: t.level, reason: "lower level missing" });
      continue;
    }
    contiguous.push(t);
  }

  return { usual, tunes: contiguous, dropped };
};

const parseJson = (raw: string): any | null => {
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const match = body.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
};

// ─── Agent ──────────────────────────────────────────────────────────────────

@Injectable()
export class DishTuner {
  /**
   * Returns null when no model is configured or the call fails. The dish stays
   * at level 0 — as the user already makes it — which is always a valid plan.
   */
  async tune(
    dish: Pick<IRepertoireDish, "name" | "slots" | "usual">,
    path: string | null | undefined,
    constraints: DietaryConstraints,
    dislikes: string[] = [],
  ): Promise<TuneProposal | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn("[DishTuner] GEMINI_API_KEY not set — skipping tuning");
      return null;
    }

    try {
      // Picked at runtime: a hard-coded model was retired upstream and this
      // call failed silently for every user (utils/gemini-models.ts).
      const raw = await callGeminiWithFallback(
        apiKey,
        ANALYSIS_MODELS,
        async (model) => {
          const result = await model.generateContent([
            { text: buildTunePrompt(dish, path, constraints, dislikes) },
          ]);
          if (!result?.response) throw new Error("Empty response");
          return result.response.text();
        },
        { context: "DishTuner", systemInstruction: TUNER_SYSTEM_INSTRUCTION },
      );

      const parsed = parseJson(raw);
      if (!parsed) {
        logger.warn(`[DishTuner] "${dish.name}": response was not parseable JSON`);
        return null;
      }

      const proposal = validateTunes(parsed, dish, path, constraints, dislikes);
      if (proposal.dropped.length) {
        logger.info(
          `[DishTuner] "${dish.name}": dropped ${proposal.dropped
            .map((d) => `L${d.level} (${d.reason})`)
            .join("; ")}`,
        );
      }
      return proposal;
    } catch (err) {
      logger.error(`[DishTuner] "${dish.name}": tuning failed: ${err}`);
      return null;
    }
  }
}
