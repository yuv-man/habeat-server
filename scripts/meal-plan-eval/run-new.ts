import { PERSONAS, DAYS, scorePlan, callGemini, parseDays, fmtScore, resolveDietaryConstraints } from "./harness";
import {
  buildMenuSkeleton,
  buildWeeklyPlanPrompt,
  MEAL_PLAN_SYSTEM_INSTRUCTION,
  planSeed,
} from "../../src/generator/meal-plan-prompt";

const MODEL = process.argv[2] || "gemini-2.5-flash-lite";
const RUNS = Number(process.argv[3] || 2);

(async () => {
  console.log(`\n=== NEW (skeleton + system instruction) — model=${MODEL}, runs=${RUNS} ===\n`);

  for (const p of PERSONAS) {
    const c = resolveDietaryConstraints(p.user);
    const runNames: string[][] = [];

    for (let run = 1; run <= RUNS; run++) {
      // Different week each run — this is what production does week to week.
      const seed = planSeed(`user-${p.id}`, `2026-08-0${run * 3}`);
      const skeleton = buildMenuSkeleton(DAYS, c, p.targetCalories, seed);

      const prompt = buildWeeklyPlanPrompt({
        userData: p.user,
        skeleton,
        constraints: c,
        targetCalories: p.targetCalories,
        macros: p.macros,
      });

      try {
        const { text, ms } = await callGemini(MODEL, prompt, {
          temperature: 0.9,
          systemInstruction: MEAL_PLAN_SYSTEM_INSTRUCTION,
        });
        const days = parseDays(text);
        const s = scorePlan(days, c, p.targetCalories, p.macros);
        console.log(`[${p.id}] run${run} (${(ms / 1000).toFixed(1)}s) ${fmtScore(s)}`);
        if (s.violations) console.log(`         VIOLATIONS: ${s.violationDetail.slice(0, 4).join(" ; ")}`);
        if (s.badBreakfasts.length) console.log(`         ODD BREAKFASTS: ${s.badBreakfasts.slice(0, 4).join(" ; ")}`);

        const names = days.flatMap((d: any) =>
          ["breakfast", "lunch", "dinner"].map((k) => d?.meals?.[k]?.name).filter(Boolean),
        );
        runNames.push(names);
        if (run === 1) console.log(`         sample: ${names.slice(0, 6).join(" | ")}`);
      } catch (e: any) {
        console.log(`[${p.id}] run${run} FAILED: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (runNames.length >= 2) {
      const a = new Set(runNames[0].map((n) => n.toLowerCase()));
      const overlap = runNames[1].filter((n) => a.has(n.toLowerCase())).length;
      console.log(`         CROSS-WEEK REPEAT: ${overlap}/${runNames[1].length} identical meal names between week1 and week2\n`);
    }
  }
})();
