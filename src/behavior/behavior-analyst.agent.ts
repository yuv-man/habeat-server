/**
 * LLM #1 — the behavioural analyst.
 *
 * Answers one question: *what is happening with this user?* It never sees a
 * MongoDB document; it sees the aggregated summary, and it never writes a plan.
 *
 * Its output is treated as a proposal, not a result. `validateAnalysis` drops
 * anything the summary can't support — a pattern claimed on one occurrence, a
 * confidence below the floor, a directive that contradicts the arithmetic — so
 * a model in a bad mood can weaken the profile but cannot corrupt it.
 */

import { Injectable } from "@nestjs/common";
import { STRUCTURED_MODELS, callGeminiWithFallback } from "../utils/gemini-models";
import { loadKnowledge } from "../knowledge/loader";
import logger from "../utils/logger";
import { BehaviorSummary } from "./behavior-summary.types";
import {
  ANALYST_SYSTEM_INSTRUCTION,
  buildAnalystPrompt,
  MIN_PATTERN_CONFIDENCE,
  MIN_PATTERN_OCCURRENCES,
} from "./behavior.prompts";
import { IBehaviorPattern, IPlanningDirectives } from "./behavior-profile.model";
import { CheckResult } from "./behavior-checks";
import { PATTERN_TAGS, SUGGESTION_TAGS } from "./banks/tags";

const VALID_AREAS = new Set([
  "breakfast", "lunch", "dinner", "snacks", "timing",
  "variety", "hydration", "exercise", "wellbeing", "planning", "nutrition",
]);

const VALID_EATING_TYPES = new Set([
  "mindful", "emotional", "habitual", "social", "mixed",
]);

const VALID_RISKS = new Set(["low", "medium", "high"]);

const VALID_SLOTS = new Set(["breakfast", "lunch", "dinner", "snacks"]);

const VALID_MACROS = new Set(["protein", "carbs", "fat"]);

/** Words that turn an observation into a verdict about the person. The prompt
 *  forbids them; this is the check that they actually stayed out. */
const JUDGEMENT_WORDS = [
  "bad habit", "junk", "cheat", "cheating", "guilty", "guilt", "lazy",
  "willpower", "discipline", "unhealthy relationship", "binge", "clean eating",
  "should be ashamed", "failure", "failed you", "poor choices",
];

export interface AnalysisResult {
  behavioralSummary: string;
  /** The instructions the meal planner actually receives. This is how the
   *  analysis reaches the food; without it the model's understanding never
   *  leaves the database. */
  planningBrief: string;
  keyPatterns: IBehaviorPattern[];
  /** Absorbed from the old eating-profile agent: the same run now produces the
   *  characterisation and the bank tags, so there is one answer rather than
   *  two that could disagree. */
  eatingType: string;
  emotionalEatingRisk: string;
  patternTags: string[];
  suggestionTags: string[];
  feelingFoodRelationship: { observation: string; evidence: string; confidence: number }[];
  whatWorked: string[];
  whatDidNotWork: string[];
  habitOpportunities: { area: string; priority: string; reason: string }[];
  recommendations: { recommendation: string; rationale: string; confidence: number }[];
  planningDirectives: Partial<IPlanningDirectives>;
}

const str = (v: unknown, max = 400): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const strList = (v: unknown, max: number, itemMax = 300): string[] =>
  Array.isArray(v)
    ? v.map((x) => str(x, itemMax)).filter(Boolean).slice(0, max)
    : [];

const containsJudgement = (text: string): boolean => {
  const lower = text.toLowerCase();
  return JUDGEMENT_WORDS.some((w) => lower.includes(w));
};

/**
 * Keep only what the data behind the summary can carry.
 *
 * Exported and pure so the rules are testable without a model in the loop —
 * these guardrails are the product, not a safety net bolted on afterwards.
 */
export const validateAnalysis = (
  raw: any,
  summary: BehaviorSummary,
  checks: CheckResult[] = [],
): AnalysisResult => {
  // The set of findings the arithmetic actually supports. A pattern may only
  // ever be an explanation of one of these.
  const firedIds = new Set(checks.filter((c) => c.fired).map((c) => c.id));

  const patterns: IBehaviorPattern[] = (Array.isArray(raw?.keyPatterns) ? raw.keyPatterns : [])
    .map((p: any, i: number): IBehaviorPattern | null => {
      const pattern = str(p?.pattern);
      const evidence = str(p?.evidence);
      const confidence = num(p?.confidence) ?? 0;
      const occurrences = num(p?.occurrences) ?? 0;
      const checkId = str(p?.checkId, 60);

      if (!pattern || !evidence) return null;
      // The self-test at write time: no claim without a check that fired.
      if (!firedIds.has(checkId)) {
        logger.warn(
          `[BehaviorAnalyst] Dropped a pattern citing an unfired check: "${checkId || "none"}"`,
        );
        return null;
      }
      // One occurrence is an anecdote. The prompt says so; this enforces it.
      if (occurrences < MIN_PATTERN_OCCURRENCES) return null;
      if (confidence < MIN_PATTERN_CONFIDENCE) return null;
      if (containsJudgement(`${pattern} ${evidence} ${str(p?.possibleExplanation)}`)) {
        logger.warn(`[BehaviorAnalyst] Dropped a pattern for judgemental language`);
        return null;
      }

      const area = str(p?.area, 20);
      return {
        id: str(p?.id, 60) || `pattern-${i + 1}`,
        checkId,
        area: VALID_AREAS.has(area) ? area : "planning",
        pattern,
        evidence,
        frequency: str(p?.frequency, 120),
        occurrences: Math.round(occurrences),
        possibleExplanation: str(p?.possibleExplanation),
        impactOnGoal: str(p?.impactOnGoal),
        suggestedIntervention: str(p?.suggestedIntervention),
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    })
    .filter((p: IBehaviorPattern | null): p is IBehaviorPattern => p !== null)
    .sort((a: IBehaviorPattern, b: IBehaviorPattern) => b.confidence - a.confidence)
    .slice(0, 6);

  const d = raw?.planningDirectives ?? {};

  // Directives are only honoured where the summary agrees. A model asking to
  // simplify dinner when dinner is being eaten every day would quietly make
  // next week worse for no reason.
  const simplifySlots = strList(d.simplifySlots, 4, 20).filter((slot) => {
    if (!VALID_SLOTS.has(slot)) return false;
    const r = summary.adherence.bySlot[slot as "breakfast"];
    return r && r.value !== null && r.value < 0.8;
  });

  const flexibleSlots = strList(d.flexibleSlots, 4, 20).filter((s) => VALID_SLOTS.has(s));

  const macro = str(d.emphasiseMacro, 20);

  const maxPrep = num(d.maxPrepMinutes);

  const eatingType = str(raw?.eatingType, 20);
  const risk = str(raw?.emotionalEatingRisk, 10);

  const brief = str(raw?.planningBrief, 900);

  return {
    behavioralSummary: str(raw?.behavioralSummary, 500),
    // A brief that moralises would put that language into the meal plan, where
    // the user would meet it as a recipe note.
    planningBrief: containsJudgement(brief) ? "" : brief,
    keyPatterns: patterns,
    eatingType: VALID_EATING_TYPES.has(eatingType) ? eatingType : "mixed",
    emotionalEatingRisk: VALID_RISKS.has(risk) ? risk : "medium",
    // Tags outside the bank vocabularies select nothing, so they are noise at
    // best and a silently empty section at worst.
    patternTags: strList(raw?.patternTags, 6, 40).filter((t) => PATTERN_TAGS.includes(t)),
    suggestionTags: strList(raw?.suggestionTags, 6, 40).filter((t) =>
      SUGGESTION_TAGS.includes(t),
    ),
    feelingFoodRelationship: (Array.isArray(raw?.feelingFoodRelationship)
      ? raw.feelingFoodRelationship
      : []
    )
      .map((f: any) => ({
        observation: str(f?.observation),
        evidence: str(f?.evidence),
        confidence: Math.max(0, Math.min(1, num(f?.confidence) ?? 0)),
      }))
      .filter(
        (f: { observation: string; evidence: string; confidence: number }) =>
          f.observation && f.confidence >= MIN_PATTERN_CONFIDENCE &&
          !containsJudgement(`${f.observation} ${f.evidence}`),
      )
      .slice(0, 4),
    whatWorked: strList(raw?.whatWorked, 5),
    whatDidNotWork: strList(raw?.whatDidNotWork, 5).filter((t) => !containsJudgement(t)),
    habitOpportunities: (Array.isArray(raw?.habitOpportunities) ? raw.habitOpportunities : [])
      .map((h: any) => ({
        area: str(h?.area, 40),
        priority: ["high", "medium", "low"].includes(str(h?.priority, 10))
          ? str(h?.priority, 10)
          : "medium",
        reason: str(h?.reason),
      }))
      .filter((h: { area: string; reason: string }) => h.area && h.reason)
      .slice(0, 4),
    recommendations: (Array.isArray(raw?.recommendations) ? raw.recommendations : [])
      .map((r: any) => ({
        recommendation: str(r?.recommendation),
        rationale: str(r?.rationale),
        confidence: Math.max(0, Math.min(1, num(r?.confidence) ?? 0)),
      }))
      .filter(
        (r: { recommendation: string; confidence: number }) =>
          r.recommendation && r.confidence >= MIN_PATTERN_CONFIDENCE,
      )
      .slice(0, 5),
    planningDirectives: {
      // Never let the model raise the ceiling the user's own behaviour set —
      // it can ask for simpler, never for more ambitious.
      maxPrepMinutes:
        maxPrep !== null && maxPrep >= 10 && maxPrep <= 60 ? Math.round(maxPrep) : null,
      simplifySlots,
      flexibleSlots,
      weekendNeedsOwnShape: d.weekendNeedsOwnShape === true,
      increaseVariety: d.increaseVariety === true,
      reduceLateEating: d.reduceLateEating === true,
      emphasiseMacro: VALID_MACROS.has(macro) ? macro : null,
      notes: strList(d.notes, 3, 200).filter((n) => !containsJudgement(n)),
    },
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
export class BehaviorAnalystAgent {
  /**
   * Run the analysis. Returns null when no model is configured or the call
   * fails — the caller keeps the deterministic half of the profile, which is
   * the part the planner actually depends on.
   */
  async analyse(
    summary: BehaviorSummary,
    checks: CheckResult[],
    previous?: {
      patterns: { pattern: string }[];
      selfCheck?: { results: { id: string; outcome: string; note: string }[] } | null;
    } | null,
  ): Promise<AnalysisResult | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn("[BehaviorAnalyst] GEMINI_API_KEY not set — skipping LLM analysis");
      return null;
    }

    const prompt = this.buildPrompt(summary, checks, previous);

    try {
      // Picked at runtime: a hard-coded model was retired upstream and this
      // call failed silently for every user (utils/gemini-models.ts).
      const raw = await callGeminiWithFallback(
        apiKey,
        STRUCTURED_MODELS,
        async (model) => {
          const result = await model.generateContent([{ text: prompt }]);
          if (!result?.response) throw new Error("Empty response");
          return result.response.text();
        },
        { context: "BehaviorAnalyst" },
      );

      return this.fromRaw(raw, summary, checks);
    } catch (err) {
      logger.error(`[BehaviorAnalyst] Analysis failed: ${err}`);
      return null;
    }
  }

  /**
   * The whole prompt for one user. Separate from the call so the nightly run
   * can send everyone's in one Batch API job (half price) instead of one call
   * each.
   */
  buildPrompt(
    summary: BehaviorSummary,
    checks: CheckResult[],
    previous?: Parameters<BehaviorAnalystAgent["analyse"]>[2],
  ): string {
    const knowledge = loadKnowledge("behavior-analyst", { maxTokens: 1200 });
    return [knowledge, ANALYST_SYSTEM_INSTRUCTION, buildAnalystPrompt(summary, checks, previous)]
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  /** Read and validate the model's answer, however it arrived. */
  fromRaw(raw: string, summary: BehaviorSummary, checks: CheckResult[]): AnalysisResult | null {
    const parsed = parseJson(raw);
    if (!parsed) {
      logger.warn("[BehaviorAnalyst] Response was not parseable JSON");
      return null;
    }
    const validated = validateAnalysis(parsed, summary, checks);
    logger.info(
      `[BehaviorAnalyst] ${validated.keyPatterns.length} patterns kept of ` +
        `${Array.isArray(parsed.keyPatterns) ? parsed.keyPatterns.length : 0} proposed`,
    );
    return validated;
  }
}
