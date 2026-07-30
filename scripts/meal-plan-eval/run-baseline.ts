import { PERSONAS, DAYS, scorePlan, callGemini, parseDays, fmtScore, resolveDietaryConstraints } from "./harness";
import { buildMultiDayPromptBaseline } from "./baseline-prompt";

const MODEL = process.argv[2] || "gemini-2.5-flash-lite";
const RUNS = Number(process.argv[3] || 2);

(async () => {
  console.log(`\n=== BASELINE (current production prompt) — model=${MODEL}, runs=${RUNS} ===\n`);

  const allNamesPerPersona: Record<string, string[][]> = {};

  for (const p of PERSONAS) {
    const c = resolveDietaryConstraints(p.user);
    allNamesPerPersona[p.id] = [];

    for (let run = 1; run <= RUNS; run++) {
      const prompt = buildMultiDayPromptBaseline(p.user, DAYS, p.targetCalories, p.macros, "");
      try {
        const { text, ms } = await callGemini(MODEL, prompt, { temperature: 0.7 });
        const days = parseDays(text);
        const s = scorePlan(days, c, p.targetCalories, p.macros);
        console.log(`[${p.id}] run${run} (${(ms / 1000).toFixed(1)}s) ${fmtScore(s)}`);
        if (s.violations) console.log(`         VIOLATIONS: ${s.violationDetail.slice(0, 4).join(" ; ")}`);
        if (s.badBreakfasts.length) console.log(`         ODD BREAKFASTS: ${s.badBreakfasts.slice(0, 4).join(" ; ")}`);

        const names = days.flatMap((d: any) =>
          ["breakfast", "lunch", "dinner"].map((k) => d?.meals?.[k]?.name).filter(Boolean),
        );
        allNamesPerPersona[p.id].push(names);
        if (run === 1) console.log(`         sample: ${names.slice(0, 6).join(" | ")}`);
      } catch (e: any) {
        console.log(`[${p.id}] run${run} FAILED: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Cross-run repetition: does the same user get the same plan every time?
    const runs = allNamesPerPersona[p.id];
    if (runs.length >= 2) {
      const a = new Set(runs[0].map((n) => n.toLowerCase()));
      const overlap = runs[1].filter((n) => a.has(n.toLowerCase())).length;
      console.log(`         CROSS-RUN REPEAT: ${overlap}/${runs[1].length} identical meal names between run1 and run2\n`);
    }
  }
})();
