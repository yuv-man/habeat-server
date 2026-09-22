/**
 * "Pasta with tuna" → a dish record.
 *
 * Onboarding asks what someone cooks most weeks (docs/the-repertoire.md §4.1).
 * They type a name; nobody is going to type an ingredient list. This turns the
 * name into an ordinary home version of that dish — ingredients, a portion, a
 * nutrition estimate — so the planner has something to work with.
 *
 * The estimate is marked `estimated` and is the weakest kind of evidence we
 * hold: a logged portion replaces it, and the user can correct it. As
 * everywhere else, the model proposes and code decides what is kept.
 */

import { Injectable } from "@nestjs/common";
import {
  DietaryConstraints,
  buildDietaryConstraintBlock,
  findMealViolations,
} from "../utils/dietary-constraints";
import { ANALYSIS_MODELS, callGeminiWithFallback } from "../utils/gemini-models";
import logger from "../utils/logger";
import { IDishNutrition } from "./repertoire-dish.schema";
import { RepertoireSlot } from "./repertoire.capture";

export interface ResolvedDish {
  ingredients: { name: string; amount: string }[];
  nutritionPerServing: IDishNutrition;
  prepMinutes: number;
  slots: RepertoireSlot[];
  leftoversFriendly: boolean;
  /** Set when the dish breaks the user's own restrictions — stored, not planned. */
  violations: string[];
}

const SLOTS: RepertoireSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** Sane bounds for one home serving; outside these the estimate is not usable. */
const MIN_CALORIES = 80;
const MAX_CALORIES = 1600;
const ENERGY_TOLERANCE = 0.2;

export const RESOLVER_SYSTEM_INSTRUCTION = `You describe how an ordinary person cooks a named dish at home.

Given a dish name, return the usual home version for ONE serving: the ingredients with amounts, the nutrition of that serving, and how long it takes to make. Rules:

- Ordinary supermarket ingredients and the way the dish is normally made. Not a restaurant version, not a "healthy" version — this is what they already cook.
- Amounts are for one serving, as a person would measure them (g, ml, tbsp, tsp, piece, slice).
- Nutrition is for that one serving and must match the ingredients: calories ≈ 4×protein + 4×carbs + 9×fat.
- "slots" are the meals this dish is eaten at: breakfast, lunch, dinner, snack. Most main dishes are ["lunch","dinner"].
- "leftoversFriendly" is true when a batch keeps and reheats well (stews, bakes, pasta sauces), false for things best eaten fresh (fried eggs, salads that wilt).
- If the name is too vague to cook (e.g. "food", "dinner"), return {"unknown": true}.

Return JSON only:
{"ingredients":[{"name":"...","amount":"120 g"}],"nutritionPerServing":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0},"prepMinutes":0,"slots":["dinner"],"leftoversFriendly":false}`;

export const buildResolverPrompt = (
  name: string,
  constraints: DietaryConstraints,
  slotHint?: RepertoireSlot[],
): string => {
  const sections = [`DISH: ${name}`];
  if (slotHint?.length) sections.push(`They eat it as: ${slotHint.join(", ")}`);
  const block = buildDietaryConstraintBlock(constraints);
  if (block) {
    sections.push(
      `${block}\n\nDescribe the dish as this person would actually make it within those restrictions. Do not rename it.`,
    );
  }
  return sections.join("\n\n");
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

const parseNutrition = (raw: any): IDishNutrition | null => {
  if (!raw || !isNum(raw.calories) || !isNum(raw.protein) || !isNum(raw.carbs) || !isNum(raw.fat)) {
    return null;
  }
  const n: IDishNutrition = {
    calories: Math.round(raw.calories),
    protein: Math.round(raw.protein),
    carbs: Math.round(raw.carbs),
    fat: Math.round(raw.fat),
  };
  if (isNum(raw.fiber)) n.fiber = Math.round(raw.fiber);
  if (n.calories < MIN_CALORIES || n.calories > MAX_CALORIES) return null;
  const fromMacros = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  if (Math.abs(fromMacros - n.calories) > ENERGY_TOLERANCE * n.calories) return null;
  return n;
};

export const validateResolved = (
  raw: any,
  name: string,
  constraints: DietaryConstraints,
  slotHint?: RepertoireSlot[],
): ResolvedDish | null => {
  if (!raw || raw.unknown === true) return null;

  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .filter((i: any) => i && typeof i.name === "string" && i.name.trim())
    .map((i: any) => ({ name: i.name.trim(), amount: String(i.amount ?? "").trim() }));
  if (ingredients.length < 2) return null;

  const nutritionPerServing = parseNutrition(raw.nutritionPerServing);
  if (!nutritionPerServing) return null;

  const slots: RepertoireSlot[] = (Array.isArray(raw.slots) ? raw.slots : []).filter(
    (s: unknown): s is RepertoireSlot => SLOTS.includes(s as RepertoireSlot),
  );

  return {
    ingredients,
    nutritionPerServing,
    prepMinutes: isNum(raw.prepMinutes) ? Math.min(240, Math.round(raw.prepMinutes)) : 20,
    slots: slots.length ? [...new Set(slots)] : slotHint?.length ? slotHint : ["lunch", "dinner"],
    leftoversFriendly: raw.leftoversFriendly === true,
    // Kept rather than refused: it is their dish and they told us they cook it.
    // The service pauses it so the planner never serves it back to them.
    violations: findMealViolations({ name, ingredients }, constraints),
  };
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

@Injectable()
export class DishResolver {
  /**
   * Null when there is no model configured, the call fails, or the answer does
   * not survive validation. The caller still stores the dish — a name the user
   * gave us is worth keeping even when we cannot cost it yet.
   */
  async resolve(
    name: string,
    constraints: DietaryConstraints,
    slotHint?: RepertoireSlot[],
  ): Promise<ResolvedDish | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn("[DishResolver] GEMINI_API_KEY not set — storing the dish unresolved");
      return null;
    }

    try {
      const raw = await callGeminiWithFallback(
        apiKey,
        ANALYSIS_MODELS,
        async (model) => {
          const result = await model.generateContent([
            { text: buildResolverPrompt(name, constraints, slotHint) },
          ]);
          if (!result?.response) throw new Error("Empty response");
          return result.response.text();
        },
        { context: "DishResolver", systemInstruction: RESOLVER_SYSTEM_INSTRUCTION, timeoutMs: 30000 },
      );

      const resolved = validateResolved(parseJson(raw), name, constraints, slotHint);
      if (!resolved) logger.warn(`[DishResolver] "${name}": no usable description came back`);
      return resolved;
    } catch (err) {
      logger.error(`[DishResolver] "${name}" failed: ${err}`);
      return null;
    }
  }
}
