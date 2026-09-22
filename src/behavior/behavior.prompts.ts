/**
 * The two prompts of the behaviour pipeline.
 *
 *   summary → ANALYST (LLM #1)  → "what is happening with this user?"
 *   profile → PLANNER (LLM #2)  → "given that, what should next week be?"
 *
 * They are split on purpose. One enormous prompt asked a model to count, judge
 * and cook in a single pass; separating them lets the first answer be inspected,
 * stored and corrected before anything is planned on top of it.
 *
 * The framing rule that matters most: the analyst is never asked to find bad
 * habits. It is asked to find patterns that make the user's *own stated goal*
 * harder, show the evidence, and propose something small. A model told to look
 * for faults will always find them, and will tell the user about them.
 */

import { BehaviorSummary } from "./behavior-summary.types";
import { CheckResult } from "./behavior-checks";
import { PATTERN_TAGS, SUGGESTION_TAGS } from "./banks/tags";

/** A pattern must be seen at least this many times before it can be reported.
 *  Enforced in code as well as in the prompt — one bad Tuesday is not a habit. */
export const MIN_PATTERN_OCCURRENCES = 2;

/** Below this, a pattern is noise the user shouldn't be shown. */
export const MIN_PATTERN_CONFIDENCE = 0.5;

export const ANALYST_SYSTEM_INSTRUCTION = `You are Habeat's Personal Nutrition & Habit Coach.

Your role is to analyse a user's historical behaviour and help create a more personalised and sustainable weekly meal plan.

You are given a pre-aggregated behavioural summary: counts, averages and rates already computed from the user's logs. Reason over those numbers. Do not invent figures that are not in the summary, and do not re-count anything.

Your job is NOT simply to count calories.

Your job is to understand the relationship between:
WHAT the user eats, WHEN they eat, HOW consistently they follow their plan, HOW they feel, and WHAT they are trying to achieve.

WHAT TO LOOK FOR

Recurring patterns such as:
- Frequently skipping meals, or skipping one particular meal
- Repeatedly eating very late
- Repeatedly choosing meals that conflict with the user's stated goal
- A very narrow rotation of dishes (repeating a normal rotation of familiar dishes is healthy, not a problem)
- Frequent replacement of planned meals
- Repeated high-calorie or low-nutrition choices alongside particular feelings or situations
- Eating patterns associated with low energy or poor reported wellbeing
- Inconsistent water intake
- Large differences between weekdays and weekends
- Patterns following exercise
- Meals that appear difficult for the user to prepare or follow
- Plans that repeatedly fail to match the user's lifestyle
- Days the user reports being stressed, tired, busy or unmotivated, and how their eating changes

HOW TO REPORT A PATTERN

You are given a list of CHECKS THAT FIRED: named tests the backend already ran against this user's data, each with its own threshold and evidence. **Every pattern you report must cite one of them by its exact id in "checkId".** A pattern citing a check that is not in that list will be discarded, as will a pattern with no checkId at all.

This is deliberate. The arithmetic decides what is true; you decide what it means and what to do about it. If the fired list is short, report few patterns. If it is empty, return an empty array — that is a valid and honest answer, not a failure.

Never call a behaviour a "bad habit" on the strength of a single occurrence. A pattern needs at least ${MIN_PATTERN_OCCURRENCES} observations across different days.

You are also writing the brief the meal planner works from. It does not see the user's history, the checks, or this analysis — it sees only what you put in "planningBrief". That brief is the mechanism by which everything you understood about this user actually changes what they eat next week, so write it as instructions to a colleague who is about to cook for them: what to do differently, and what would happen if they didn't.

For every pattern give:
1. checkId — the exact id of the fired check this pattern is about
2. pattern — what recurs, in neutral language
3. evidence — the specific figures, taken from that check and the summary
4. frequency — how often, with the denominator ("12 of 30 planned dinners")
5. possibleExplanation — a plausible reading, offered as a possibility, not a verdict
6. confidence — 0.0–1.0, honestly reflecting how much data stands behind it
7. impactOnGoal — how this makes the user's own stated goal harder
8. suggestedIntervention — one small, realistic change

LANGUAGE

Do not diagnose medical or psychological conditions.
Do not make claims about the user's health that the data does not support.
Do not shame, criticise or moralise about food. No food is "bad", "junk", "clean" or "cheating".
Use neutral words: "pattern", "challenge", "friction", "opportunity".
Write about the behaviour, never about the person's character.
Address the user as "you".

PERSONALISATION

The next weekly plan should be based on how the user actually behaved, not only on what they said they wanted. Prioritise meals that fit their lifestyle and preparation time, match their preferences, support their goal, and are realistic given their previous adherence.

If a previous plan repeatedly failed, do not recommend the same shape of plan again — say what should change and why:
- Repeatedly skipping a complicated breakfast → simpler breakfasts.
- Repeatedly replacing planned dinners → more flexible dinner options.
- Consistently different weekends → a weekend plan that reflects that reality.
- Stressed or tired days with changed eating → simpler, more flexible options on those days.

The goal is not perfect adherence. The goal is a plan the user can realistically follow, that moves them gradually towards better habits.

OUTPUT

Return ONLY valid JSON, no markdown fence and no commentary, matching exactly:

{
  "behavioralSummary": string,
  "keyPatterns": [{
    "id": string,
    "checkId": string,
    "area": "breakfast"|"lunch"|"dinner"|"snacks"|"timing"|"variety"|"hydration"|"exercise"|"wellbeing"|"planning"|"nutrition",
    "pattern": string,
    "evidence": string,
    "frequency": string,
    "occurrences": number,
    "possibleExplanation": string,
    "impactOnGoal": string,
    "suggestedIntervention": string,
    "confidence": number
  }],
  "feelingFoodRelationship": [{
    "observation": string,
    "evidence": string,
    "confidence": number
  }],
  "whatWorked": [string],
  "whatDidNotWork": [string],
  "habitOpportunities": [{
    "area": string,
    "priority": "high"|"medium"|"low",
    "reason": string
  }],
  "recommendations": [{
    "recommendation": string,
    "rationale": string,
    "confidence": number
  }],
  "eatingType": "mindful"|"emotional"|"habitual"|"social"|"mixed",
  "emotionalEatingRisk": "low"|"medium"|"high",
  "patternTags": [string],
  "suggestionTags": [string],
  "planningBrief": string,
  "planningDirectives": {
    "maxPrepMinutes": number|null,
    "simplifySlots": ["breakfast"|"lunch"|"dinner"|"snacks"],
    "flexibleSlots": ["breakfast"|"lunch"|"dinner"|"snacks"],
    "weekendNeedsOwnShape": boolean,
    "increaseVariety": boolean,
    "reduceLateEating": boolean,
    "emphasiseMacro": "protein"|"carbs"|"fat"|null,
    "notes": [string]
  }
}

"eatingType" and "emotionalEatingRisk" characterise the user overall; when the data does not support a call, use "mixed" and "medium".

"patternTags" must come only from: ${PATTERN_TAGS.join(", ")}
"suggestionTags" must come only from: ${SUGGESTION_TAGS.join(", ")}
Anything outside those vocabularies is dropped.

"planningBrief" is 2–5 sentences addressed to the meal planner, in the imperative ("Keep breakfast to something assembled, not cooked — a 40-minute breakfast has not been made once in three weeks"). Name the meals and days that must change and say what each change is for. Do not restate the whole analysis, do not address the user, and do not include figures the planner cannot act on.

"behavioralSummary" is at most 60 words, addressed to the user. Every string is plain prose with no markdown.`;

/**
 * The per-request analyst prompt. Only the summary travels — the instruction
 * above is invariant and belongs in the system slot where a provider can cache
 * it.
 */
export const buildAnalystPrompt = (
  summary: BehaviorSummary,
  checks: CheckResult[],
  previous?: {
    patterns: { pattern: string }[];
    selfCheck?: { results: { id: string; outcome: string; note: string }[] } | null;
  } | null,
): string => {
  const fired = checks.filter((c) => c.fired);

  const sections = [
    `BEHAVIOURAL SUMMARY (last ${summary.period.days} days, ${summary.period.start} to ${summary.period.end}):`,
    JSON.stringify(summary),
    fired.length
      ? `CHECKS THAT FIRED — the only findings you may write patterns about. Cite one by id in "checkId":\n${fired
          .map((c) => `- ${c.id} (${c.area}): ${c.label}. ${c.evidence}.`)
          .join("\n")}`
      : `CHECKS THAT FIRED: none. Return an empty "keyPatterns" array — there is nothing here that meets the evidence bar, and inventing something would be worse than saying so.`,
  ];

  if (previous?.patterns?.length) {
    sections.push(
      `PATTERNS YOU REPORTED LAST TIME:\n${previous.patterns
        .slice(0, 8)
        .map((p) => `- ${p.pattern}`)
        .join("\n")}`,
    );
  }

  // The system's own verdict on its previous claims. Handing this back closes
  // the loop: a claim that has eased should be reported as progress, and one
  // that has resolved should not be repeated as though nothing happened.
  if (previous?.selfCheck?.results?.length) {
    sections.push(
      `HOW THOSE CLAIMS HELD UP, measured since:\n${previous.selfCheck.results
        .map((r) => `- ${r.id}: ${r.outcome} — ${r.note}`)
        .join("\n")}\nAcknowledge what eased or resolved in "whatWorked" rather than repeating it as a new problem.`,
    );
  }

  sections.push(
    `A rate written as null means the question was never answered — treat it as unknown, never as zero.`,
  );

  return sections.join("\n\n");
};

// ─── LLM #2: what the planner is told ───────────────────────────────────────

const SLOT_LABEL: Record<string, string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
  snacks: "snacks",
};

/**
 * Turn the stored profile into the paragraph the weekly-plan prompt carries.
 *
 * Deliberately short and imperative. The planner does not need the evidence —
 * it needs the conclusions, phrased as constraints on the week it is about to
 * write. Returns null when the profile has nothing worth saying, so the plan
 * prompt stays clean rather than gaining an empty heading.
 */
export interface PlannerProfileView {
  behavior?: Record<string, number | null>;
  context?: {
    busyDays?: number[];
    lowMotivationDays?: number[];
    lateEatingRate?: number | null;
  };
  planningDirectives?: {
    maxPrepMinutes?: number | null;
    simplifySlots?: string[];
    flexibleSlots?: string[];
    weekendNeedsOwnShape?: boolean;
    increaseVariety?: boolean;
    reduceLateEating?: boolean;
    emphasiseMacro?: string | null;
    notes?: string[];
  };
  habitOpportunities?: { area: string; priority: string; reason: string }[];
  preferences?: { avoidMeals?: string[]; favoriteMeals?: string[] };
  /** The analyst's brief — the whole reason a model reads this user's history.
   *  Leads the context, because it is the part that explains the rest. */
  plannerBrief?: string;
  /** What the analyst found, with the change it proposed for each. */
  patterns?: {
    pattern: string;
    suggestedIntervention: string;
    impactOnGoal: string;
    confidence: number;
  }[];
  /** How eating actually moved with how the user felt. */
  feelingFoodRelationship?: { observation: string; confidence: number }[];
  narrative?: { whatWorked?: string[]; whatDidNotWork?: string[] };
  /** The system's verdict on its own previous claims, so the planner can be
   *  told what to keep doing rather than only what to fix. */
  selfCheck?: { eased: number; resolved: number; holds: number } | null;
}

export const buildPlannerContext = (profile: PlannerProfileView | null): string | null => {
  if (!profile) return null;

  const d = profile.planningDirectives ?? {};
  const lines: string[] = [];

  // ── the analyst's reading, first ─────────────────────────────────────────
  // The numbers below are constraints; this is the understanding. A planner
  // given only thresholds writes a technically compliant week that misses the
  // point, which is what happens when the analysis is computed and then left
  // sitting in the database.
  if (profile.plannerBrief) lines.push(profile.plannerBrief);

  (profile.patterns ?? [])
    .filter((p) => p.confidence >= MIN_PATTERN_CONFIDENCE)
    .slice(0, 3)
    .forEach((p) => {
      const intervention = p.suggestedIntervention
        ? ` Do this about it: ${p.suggestedIntervention}`
        : "";
      lines.push(`${p.pattern}.${intervention}`);
    });

  (profile.feelingFoodRelationship ?? [])
    .filter((f) => f.confidence >= MIN_PATTERN_CONFIDENCE)
    .slice(0, 2)
    .forEach((f) => lines.push(f.observation));

  const worked = profile.narrative?.whatWorked ?? [];
  if (worked.length) {
    lines.push(`Keep what is working: ${worked.slice(0, 2).join("; ")}.`);
  }

  const didNot = profile.narrative?.whatDidNotWork ?? [];
  if (didNot.length) {
    lines.push(
      `Last week's plan fell down here, so do not repeat it: ${didNot.slice(0, 2).join("; ")}.`,
    );
  }

  if (profile.selfCheck && (profile.selfCheck.eased || profile.selfCheck.resolved)) {
    lines.push(
      `${profile.selfCheck.eased + profile.selfCheck.resolved} of the things we changed last time are working — do not undo them.`,
    );
  }

  const pct = (v: number | null | undefined) =>
    v == null ? null : `${Math.round(v * 100)}%`;

  // Adherence is the single most useful thing the planner can know: it says how
  // ambitious the week is allowed to be.
  const adherence = profile.behavior ?? {};
  const weak = (["breakfast", "lunch", "dinner"] as const)
    .map((slot) => ({ slot, rate: adherence[`${slot}Adherence`] }))
    .filter((x) => typeof x.rate === "number" && (x.rate as number) < 0.6);

  if (weak.length) {
    lines.push(
      `The user follows ${weak
        .map((w) => `${SLOT_LABEL[w.slot]} (${pct(w.rate as number)})`)
        .join(" and ")} far less often than the rest of the day. Make ${
        weak.length === 1 ? "that meal" : "those meals"
      } the easiest thing on the plan — fewer ingredients, less cooking, nothing that needs planning ahead.`,
    );
  }

  if (d.simplifySlots?.length) {
    lines.push(
      `Keep ${d.simplifySlots.map((s) => SLOT_LABEL[s] ?? s).join(" and ")} genuinely simple: assembled rather than cooked wherever that still makes a real meal.`,
    );
  }

  if (d.flexibleSlots?.length) {
    lines.push(
      `${d.flexibleSlots.map((s) => SLOT_LABEL[s] ?? s).join(" and ")} get swapped often, so favour forgiving dishes whose ingredients also work as something else.`,
    );
  }

  if (d.maxPrepMinutes) {
    lines.push(
      `Nothing over ${d.maxPrepMinutes} minutes — meals above that are the ones this user stops making.`,
    );
  }

  if (d.weekendNeedsOwnShape || (profile.behavior?.weekendAdherence ?? 1) < 0.5) {
    lines.push(
      `Weekends run differently for this user. Give Saturday and Sunday their own shape — later, looser, fewer separate cooking sessions — instead of repeating the weekday pattern.`,
    );
  }

  if (d.reduceLateEating || (profile.context?.lateEatingRate ?? 0) > 0.4) {
    lines.push(
      `Evening meals often land late. Keep dinners quick and light enough to work at 9pm, rather than assuming a 7pm sit-down.`,
    );
  }

  if (d.increaseVariety) {
    lines.push(
      `The user rotates through very few dishes. Keep the ones they eat, and add one or two new dishes alongside them — do not replace the rotation.`,
    );
  }

  if (d.emphasiseMacro) {
    lines.push(
      `${d.emphasiseMacro[0].toUpperCase()}${d.emphasiseMacro.slice(1)} has been consistently short of target — build it into the meals rather than adding a supplement-style extra.`,
    );
  }

  const busy = (profile.context?.busyDays ?? []).concat(
    profile.context?.lowMotivationDays ?? [],
  );
  if (busy.length) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const unique = [...new Set(busy)].map((d) => names[d]).filter(Boolean);
    if (unique.length) {
      lines.push(
        `${unique.join(" and ")} ${unique.length === 1 ? "is" : "are"} consistently the hardest ${unique.length === 1 ? "day" : "days"} of the week for this user — put the least demanding meals there.`,
      );
    }
  }

  const top = (profile.habitOpportunities ?? []).filter((h) => h.priority === "high");
  if (top.length) {
    lines.push(
      `Highest-value change this week: ${top
        .slice(0, 2)
        .map((h) => h.reason)
        .join("; ")}.`,
    );
  }

  if (profile.preferences?.avoidMeals?.length) {
    lines.push(
      `Repeatedly swapped away from, so do not plan again: ${profile.preferences.avoidMeals.slice(0, 8).join(", ")}.`,
    );
  }

  // Meals this user actually eats again and again. These are the strongest
  // adherence signal we have: plan them as they are, and improve them by
  // portion and composition rather than steering away from them
  // (docs/the-repertoire.md §2).
  if (profile.preferences?.favoriteMeals?.length) {
    lines.push(
      `Dishes this user reliably eats — include them in the plan as the same dish, adjusting portion or adding a side where the targets need it, rather than replacing them: ${profile.preferences.favoriteMeals.slice(0, 5).join(", ")}.`,
    );
  }

  (d.notes ?? []).slice(0, 3).forEach((n) => lines.push(n));

  if (lines.length === 0) return null;

  return lines.join("\n");
};
