/**
 * Measures the latency users actually experience.
 *
 * Phase 1 generates TODAY only and is what the client waits on; Phase 2 fills
 * in the rest of the week in the background. Benchmarking 7-day batches — as
 * the first round of this work did — measures the part nobody waits for.
 *
 *   npx ts-node --transpile-only scripts/meal-plan-eval/run-latency.ts [days] [models,...]
 */
import { PERSONAS, scorePlan, callGemini, parseDays, resolveDietaryConstraints } from "./harness";
import {
  buildMenuSkeleton,
  buildWeeklyPlanPrompt,
  MEAL_PLAN_SYSTEM_INSTRUCTION,
  planSeed,
} from "../../src/generator/meal-plan-prompt";

const DAY_COUNT = Number(process.argv[2] || 1);
const MODELS = (process.argv[3] ||
  "gemini-3-flash-preview,gemini-2.5-flash,gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite"
).split(",");

const DAYS = Array.from({ length: DAY_COUNT }, (_, i) => ({
  dateStr: `2026-08-${String(3 + i).padStart(2, "0")}`,
  dayName: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][i % 7],
  hasWorkout: i % 2 === 0,
}));

// The vegan persona mirrors the reported failure most closely.
const persona = PERSONAS.find((p) => p.id === "vegan")!;

(async () => {
  console.log(`\n=== Phase-${DAY_COUNT === 1 ? "1" : "2"} latency: ${DAY_COUNT} day(s) ===\n`);
  console.log(`${"model".padEnd(26)}${"time".padEnd(10)}${"viol".padEnd(6)}sample`);

  for (const model of MODELS) {
    const c = resolveDietaryConstraints(persona.user);
    const skeleton = buildMenuSkeleton(
      DAYS, c, persona.targetCalories, planSeed("latency", "2026-08-03"), persona.user.dislikes,
    );
    const prompt = buildWeeklyPlanPrompt({
      userData: persona.user, skeleton, constraints: c,
      targetCalories: persona.targetCalories, macros: persona.macros,
    });

    try {
      const { text, ms } = await callGemini(model, prompt, {
        temperature: 0.9,
        systemInstruction: MEAL_PLAN_SYSTEM_INSTRUCTION,
        maxOutputTokens: 2500 + DAY_COUNT * 2000,
      });
      const days = parseDays(text);
      const s = scorePlan(days, c, persona.targetCalories, persona.macros);
      const sample = days[0]?.meals?.breakfast?.name ?? "?";
      console.log(
        `${model.padEnd(26)}${(ms / 1000).toFixed(1).padStart(6)}s   ${String(s.violations).padEnd(6)}${sample}`,
      );
    } catch (e: any) {
      const m = String(e.message);
      console.log(`${model.padEnd(26)}${"—".padStart(6)}    ${m.includes("429") ? "QUOTA" : m.slice(0, 60)}`);
    }
  }
})();
