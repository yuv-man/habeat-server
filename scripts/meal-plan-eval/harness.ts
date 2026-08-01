/**
 * Meal-plan generation eval harness.
 *
 * Runs a prompt-builder against a Gemini model for a set of user personas and
 * scores the output on the things that are actually broken in production:
 * dietary violations, repeated meals, breakfast-appropriateness, calorie drift.
 *
 * Usage: npx ts-node scratchpad/eval-harness.ts <variant> <model> [runs]
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  resolveDietaryConstraints,
  findPlanViolations,
  DietaryConstraints,
} from "../../src/utils/dietary-constraints";

export interface Persona {
  id: string;
  user: any;
  targetCalories: number;
  macros: { protein: number; carbs: number; fat: number };
}

export const PERSONAS: Persona[] = [
  {
    id: "vegan",
    user: {
      age: 29, gender: "female", height: 168, weight: 62, path: "maintain",
      dietaryRestrictions: ["Vegan"], allergies: [],
      foodPreferences: ["Italian", "Sirloin Steak"], dislikes: ["mushrooms"],
      workoutFrequency: 3,
    },
    targetCalories: 2000,
    macros: { protein: 120, carbs: 220, fat: 67 },
  },
  {
    id: "omnivore",
    user: {
      age: 34, gender: "male", height: 180, weight: 84, path: "lose",
      dietaryRestrictions: [], allergies: [],
      foodPreferences: ["Mediterranean"], dislikes: ["olives"],
      workoutFrequency: 4,
    },
    targetCalories: 2200,
    macros: { protein: 165, carbs: 220, fat: 73 },
  },
  {
    id: "gf-dairyfree",
    user: {
      age: 41, gender: "female", height: 162, weight: 70, path: "lose",
      dietaryRestrictions: ["Gluten-free", "Dairy-free"], allergies: ["peanuts"],
      foodPreferences: [], dislikes: [],
      workoutFrequency: 2,
    },
    targetCalories: 1700,
    macros: { protein: 128, carbs: 170, fat: 57 },
  },
  {
    id: "kosher-nutfree",
    user: {
      age: 52, gender: "male", height: 175, weight: 95, path: "lose",
      dietaryRestrictions: ["Kosher"], allergies: ["tree nuts", "shellfish"],
      foodPreferences: ["comfort food"], dislikes: ["liver"],
      workoutFrequency: 1,
    },
    targetCalories: 1900,
    macros: { protein: 143, carbs: 190, fat: 63 },
  },
];

export const DAYS = [
  { dateStr: "2026-08-03", dayName: "monday", dayIndex: 0, hasWorkout: true },
  { dateStr: "2026-08-04", dayName: "tuesday", dayIndex: 1, hasWorkout: false },
  { dateStr: "2026-08-05", dayName: "wednesday", dayIndex: 2, hasWorkout: true },
  { dateStr: "2026-08-06", dayName: "thursday", dayIndex: 3, hasWorkout: false },
  { dateStr: "2026-08-07", dayName: "friday", dayIndex: 4, hasWorkout: true },
  { dateStr: "2026-08-08", dayName: "saturday", dayIndex: 5, hasWorkout: false },
  { dateStr: "2026-08-09", dayName: "sunday", dayIndex: 6, hasWorkout: false },
];

// ── Scoring ─────────────────────────────────────────────────────────────────

const DINNER_FOODS = [
  "steak", "curry", "lasagna", "roast", "stir-fry", "stir fry", "casserole",
  "chili", "meatloaf", "burger", "pizza", "risotto", "stew", "kebab", "taco",
  "shepherd", "pot pie", "salmon fillet", "pork chop", "schnitzel",
];
const BREAKFAST_FOODS = [
  "oat", "egg", "yogurt", "yoghurt", "toast", "smoothie", "granola", "pancake",
  "waffle", "cereal", "porridge", "muesli", "bagel", "muffin", "scramble",
  "omelette", "omelet", "fruit", "chia", "avocado toast", "shakshuka", "tofu scramble",
  "burrito", "hash", "banana", "berr", "coffee", "croissant", "crepe", "bircher",
  // Added after review: these were counted as odd breakfasts but are ordinary
  // morning food, which made the metric read worse than the plans actually were.
  "frittata", "congee", "parfait", "pudding", "breakfast", "soaked", "compote",
  "peanut butter", "almond butter", "cottage cheese", "smoked salmon",
];

export interface Score {
  days: number;
  violations: number;
  violationDetail: string[];
  uniqueMeals: number;
  totalMeals: number;
  dupRate: number;
  badBreakfasts: string[];
  calorieMAPE: number;
  macroMAPE: number;
  missingFields: number;
}

const mealsOf = (day: any): Array<[string, any]> => {
  const m = day?.meals || {};
  return [
    ["breakfast", m.breakfast],
    ["lunch", m.lunch],
    ["dinner", m.dinner],
    ...(Array.isArray(m.snacks) ? m.snacks.map((s: any, i: number): [string, any] => [`snack${i}`, s]) : []),
  ].filter(([, v]) => v);
};

export const scorePlan = (
  days: any[],
  c: DietaryConstraints,
  targetCalories: number,
  macros: { protein: number; carbs: number; fat: number },
): Score => {
  const violations = findPlanViolations(days, c);

  const names: string[] = [];
  const badBreakfasts: string[] = [];
  let missingFields = 0;
  const calErrs: number[] = [];
  const macroErrs: number[] = [];

  for (const day of days) {
    for (const [slot, meal] of mealsOf(day)) {
      const name = String(meal?.name || "").toLowerCase().trim();
      names.push(name);

      if (!meal?.name || !meal?.calories || !meal?.macros || !Array.isArray(meal?.ingredients) || meal.ingredients.length === 0) {
        missingFields++;
      }

      if (slot === "breakfast") {
        const looksBreakfast = BREAKFAST_FOODS.some((f) => name.includes(f));
        const looksDinner = DINNER_FOODS.some((f) => name.includes(f));
        if (looksDinner || !looksBreakfast) badBreakfasts.push(meal?.name || "(unnamed)");
      }

      // Macro math consistency: p*4 + c*4 + f*9 should ≈ stated calories
      const mm = meal?.macros;
      if (mm && meal?.calories) {
        const derived = (mm.protein || 0) * 4 + (mm.carbs || 0) * 4 + (mm.fat || 0) * 9;
        macroErrs.push(Math.abs(derived - meal.calories) / meal.calories);
      }
    }

    const dayCals = mealsOf(day).reduce((s, [, m]) => s + (m?.calories || 0), 0);
    if (dayCals > 0) calErrs.push(Math.abs(dayCals - targetCalories) / targetCalories);
  }

  const unique = new Set(names.filter(Boolean));
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  return {
    days: days.length,
    violations: violations.length,
    violationDetail: violations.map((v) => `${v.mealType} "${v.mealName}" → ${v.matched.join(",")}`),
    uniqueMeals: unique.size,
    totalMeals: names.length,
    dupRate: names.length ? 1 - unique.size / names.length : 0,
    badBreakfasts,
    calorieMAPE: mean(calErrs),
    macroMAPE: mean(macroErrs),
    missingFields,
  };
};

// ── Runner ──────────────────────────────────────────────────────────────────

export const callGemini = async (
  modelName: string,
  prompt: string,
  opts: { temperature?: number; systemInstruction?: string; maxOutputTokens?: number } = {},
): Promise<{ text: string; ms: number }> => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
  });
  const t0 = Date.now();
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      // Mirrors generate.service.ts — a full week overruns the default cap and
      // truncates mid-array.
      maxOutputTokens: opts.maxOutputTokens ?? 32768,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    } as any,
  });
  return { text: result.response.text(), ms: Date.now() - t0 };
};

// Use the production parser so the eval exercises the same recovery paths the
// server does, rather than a more forgiving copy that hides real failures.
export { parseMultiDayResponse as parseDays } from "../../src/generator/generate.service";

export const fmtScore = (s: Score): string =>
  [
    `days=${s.days}`,
    `violations=${s.violations}`,
    `unique=${s.uniqueMeals}/${s.totalMeals} (dup ${(s.dupRate * 100).toFixed(0)}%)`,
    `badBreakfast=${s.badBreakfasts.length}`,
    `calMAPE=${(s.calorieMAPE * 100).toFixed(1)}%`,
    `macroMAPE=${(s.macroMAPE * 100).toFixed(1)}%`,
    `missing=${s.missingFields}`,
  ].join(" | ");

export { resolveDietaryConstraints };
