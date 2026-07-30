/**
 * Verbatim copy of the CURRENT production buildMultiDayPrompt
 * (src/generator/generate.service.ts:415) so the eval can measure the baseline
 * without exporting internals. Keep in sync only for the duration of this eval.
 */
import {
  resolveDietaryConstraints,
  buildDietaryConstraintBlock,
  buildMealExamples,
  filterFoodPreferences,
} from "../../src/utils/dietary-constraints";

const CUISINE_ROTATION = [
  "American home cooking",
  "simple Mediterranean",
  "classic comfort food",
  "simple Asian home cooking",
  "everyday Italian",
  "simple Mexican home cooking",
  "classic homestyle",
];

export const buildMultiDayPromptBaseline = (
  userData: any,
  daysData: Array<{ dateStr: string; dayName: string; dayIndex: number; hasWorkout: boolean }>,
  targetCalories: number,
  macros: { protein: number; carbs: number; fat: number },
  goalContextStr: string,
  moodContext?: string,
  repairNote?: string,
): string => {
  const bCal = Math.round(targetCalories * 0.25);
  const lCal = Math.round(targetCalories * 0.35);
  const dCal = Math.round(targetCalories * 0.3);
  const sCal = Math.round(targetCalories * 0.1);

  const constraints = resolveDietaryConstraints(userData);
  const constraintBlock = buildDietaryConstraintBlock(constraints);
  const avoidList = (userData.dislikes || []).join(", ") || "none";
  const { allowed: allowedPreferences } = filterFoodPreferences(userData.foodPreferences || [], constraints);

  const rawPreferList = allowedPreferences.join(", ") || "none";
  const preferList = rawPreferList !== "none"
    ? `${rawPreferList} — apply to LUNCH/DINNER by default. For breakfast, default to morning-appropriate foods (eggs, oatmeal, yogurt, toast, smoothie, granola, pancakes, fruit, rice porridge). Avoid automatically applying a dinner-type preference (steak, beef cut, pasta, curry, rice bowl, etc.) to breakfast unless the user explicitly asked for it. Calling a dinner protein a "scramble" does not make it a breakfast meal; egg scrambles should use eggs as the primary protein.`
    : "none";

  const daySpecs = daysData
    .map((d) => {
      const cuisine = CUISINE_ROTATION[d.dayIndex % CUISINE_ROTATION.length];
      const protein = constraints.proteinRotation[d.dayIndex % constraints.proteinRotation.length];
      const workoutStr = d.hasWorkout ? "WORKOUT" : "REST";
      return `- ${d.dateStr} (${d.dayName}): ${cuisine} cuisine, ${protein} protein, ${workoutStr}`;
    })
    .join("\n");

  const dayStructures = daysData
    .map((d) => {
      const workoutJson = d.hasWorkout
        ? `"workouts":[{"name":"...","category":"...","duration":30,"caloriesBurned":200}]`
        : `"workouts":[]`;
      return `{"date":"${d.dateStr}","day":"${d.dayName}","meals":{"breakfast":{...},"lunch":{...},"dinner":{...},"snacks":[{...}]},${workoutJson}}`;
    })
    .join(",\n    ");

  return `Generate a ${daysData.length}-day meal plan as a JSON array. Each day MUST be unique with different meals.
${constraintBlock ? `\n${constraintBlock}\n` : ""}${repairNote ? `\n${repairNote}\n` : ""}
PERSON: ${userData.age}y ${userData.gender} ${userData.height}cm ${userData.weight}kg path=${userData.path}
DAILY TARGETS: ${targetCalories} kcal | P:${macros.protein}g C:${macros.carbs}g F:${macros.fat}g
DISLIKES (avoid if possible): ${avoidList}
PREFER: ${preferList}
${goalContextStr ? `STYLE: ${goalContextStr.substring(0, 200)}` : ""}
${moodContext ? `MOOD & WELLNESS: ${moodContext}` : ""}

DAYS TO GENERATE (each with DIFFERENT meal style and protein):
${daySpecs}

MEAL CALORIE TARGETS (per day):
- breakfast: ~${bCal} kcal
- lunch: ~${lCal} kcal
- dinner: ~${dCal} kcal
- snacks[0]: ~${sCal} kcal

CRITICAL RULES:
0. ${constraintBlock ? "The HARD DIETARY CONSTRAINTS above outrank every rule below. If a rule conflicts with them, follow the constraints." : "Follow the targets above."}
1. NO REPEATED MEALS across days - every breakfast, lunch, dinner must be unique
2. SIMPLE, everyday home-cooked meals only. Examples: ${buildMealExamples(constraints)}. NO exotic restaurant dishes.
3. Use the specified meal style and protein for each day
4. INGREDIENT FORMAT: "ingredient_name|amount|unit|category"
   - ingredient_name: RAW only (no "chopped", "diced", "minced", "fresh", "dried")
   - category: Proteins/Vegetables/Fruits/Grains/Dairy/Pantry/Spices
5. Macros must add up: protein*4 + carbs*4 + fat*9 ≈ calories

RETURN ONLY THIS JSON ARRAY (no markdown, no extra text):
[
    ${dayStructures}
]

Each meal object structure:
{"name":"Meal Name","calories":${bCal},"macros":{"protein":20,"carbs":40,"fat":10},"ingredients":["${constraints.proteinRotation[0].toLowerCase().replace(/ /g, "_")}|150|g|Proteins","rice|100|g|Grains"],"prepTime":15}`;
};
