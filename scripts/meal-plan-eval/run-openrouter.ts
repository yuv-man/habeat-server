/**
 * Scores OpenRouter candidates on the real meal-plan prompt.
 *
 * The fallback provider only matters when Gemini's free quota is gone, which is
 * exactly when users are still expecting a plan — so it is held to the same bar
 * as the primary, not treated as a best-effort afterthought.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import axios from "axios";
import { PERSONAS, DAYS, scorePlan, parseDays, fmtScore, resolveDietaryConstraints } from "./harness";
import {
  buildMenuSkeleton,
  buildWeeklyPlanPrompt,
  MEAL_PLAN_SYSTEM_INSTRUCTION,
  planSeed,
} from "../../src/generator/meal-plan-prompt";

const CANDIDATES = process.argv[2]
  ? process.argv[2].split(",")
  : [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
      "inclusionai/ling-3.0-flash:free",
      "openai/gpt-oss-20b:free",
    ];

const call = async (model: string, prompt: string) => {
  const t0 = Date.now();
  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model,
      messages: [
        { role: "system", content: MEAL_PLAN_SYSTEM_INSTRUCTION },
        { role: "user", content: `${prompt}\n\nReturn ONLY a JSON array. No markdown, no explanation.` },
      ],
      temperature: 0.9,
      max_tokens: 2500 + DAYS.length * 2000,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPEN_ROUTER_KEY}`,
        "HTTP-Referer": "https://habeat.app",
        "X-Title": "Habeat",
        "Content-Type": "application/json",
      },
      timeout: 180000,
    },
  );
  return { text: res.data?.choices?.[0]?.message?.content as string, ms: Date.now() - t0 };
};

(async () => {
  for (const model of CANDIDATES) {
    console.log(`\n=== ${model} ===`);
    for (const p of PERSONAS) {
      const c = resolveDietaryConstraints(p.user);
      const skeleton = buildMenuSkeleton(DAYS, c, p.targetCalories, planSeed(`u-${p.id}`, "2026-08-03"));
      const prompt = buildWeeklyPlanPrompt({
        userData: p.user, skeleton, constraints: c,
        targetCalories: p.targetCalories, macros: p.macros,
      });

      try {
        const { text, ms } = await call(model, prompt);
        if (!text) throw new Error("empty content");
        const days = parseDays(text);
        const s = scorePlan(days, c, p.targetCalories, p.macros);
        console.log(`  [${p.id}] (${(ms / 1000).toFixed(1)}s) ${fmtScore(s)}`);
        if (s.violations) console.log(`      VIOLATIONS: ${s.violationDetail.slice(0, 3).join(" ; ")}`);
        const names = days.flatMap((d: any) =>
          ["breakfast", "lunch", "dinner"].map((k) => d?.meals?.[k]?.name).filter(Boolean),
        );
        console.log(`      sample: ${names.slice(0, 4).join(" | ")}`);
      } catch (e: any) {
        const detail = e.response?.data?.error?.message || e.message;
        console.log(`  [${p.id}] FAILED: ${String(detail).slice(0, 160)}`);
      }
    }
  }
})();
