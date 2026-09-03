import { Injectable } from "@nestjs/common";
import { generateTextWithRateLimit } from "../utils/gemini-rate-limiter";
import { normaliseTerm } from "../utils/term-list";
import { isKnownFoodTerm, canonicaliseTerm } from "./food-dictionary";
import logger from "../utils/logger";

export type TermVerdictSource = "dictionary" | "model" | "unavailable";

export interface TermVerdict {
  term: string;
  /** False only when we are confident this is not food-related. */
  recognised: boolean;
  source: TermVerdictSource;
}

/** Terms are short; a whole onboarding batch fits in one small call. */
const MAX_TERMS_PER_REQUEST = 40;
const MODEL = process.env.FOOD_TERM_MODEL || "gemini-2.5-flash-lite";

@Injectable()
export class FoodTermsService {
  /**
   * Classify user-entered terms as food-related or not.
   *
   * Two stages, cheapest first:
   *   1. Local dictionary — instant, free, and safe from hallucination.
   *   2. One batched LLM call for whatever is left.
   *
   * FAILS OPEN. If the model errors, is rate-limited or returns nonsense, every
   * unresolved term comes back `recognised: true`. Onboarding must never break
   * because an AI provider is having a bad day, and a wrongly-rejected allergy
   * is a far worse outcome than a wrongly-accepted one.
   */
  async classify(terms: string[]): Promise<TermVerdict[]> {
    const cleaned = terms
      .map((t) => normaliseTerm(t))
      .filter(Boolean)
      .slice(0, MAX_TERMS_PER_REQUEST);

    if (!cleaned.length) return [];

    const verdicts = new Map<string, TermVerdict>();
    const unknown: string[] = [];

    for (const term of cleaned) {
      if (isKnownFoodTerm(term)) {
        verdicts.set(term, { term, recognised: true, source: "dictionary" });
      } else {
        unknown.push(term);
      }
    }

    if (unknown.length) {
      logger.info(
        `[FoodTermsService] ${cleaned.length - unknown.length}/${cleaned.length} resolved locally; asking the model about: ${unknown.join(", ")}`,
      );
      const modelVerdicts = await this.askModel(unknown);
      modelVerdicts.forEach((v) => verdicts.set(v.term, v));
    }

    return cleaned.map(
      (term) =>
        verdicts.get(term) ?? { term, recognised: true, source: "unavailable" },
    );
  }

  /** One call for the whole batch. Never throws. */
  private async askModel(terms: string[]): Promise<TermVerdict[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn("[FoodTermsService] No GEMINI_API_KEY — accepting all unknown terms");
      return terms.map((term) => ({ term, recognised: true, source: "unavailable" as const }));
    }

    try {
      const raw = await generateTextWithRateLimit(apiKey, MODEL, this.buildPrompt(terms));
      const parsed = this.parseJson(raw);
      if (!Array.isArray(parsed)) {
        logger.warn(`[FoodTermsService] Unparseable model reply: ${raw?.slice(0, 200)}`);
        return terms.map((term) => ({ term, recognised: true, source: "unavailable" as const }));
      }

      // Index the model's answers by canonical term so casing/spacing drift
      // between request and reply does not silently drop a verdict.
      const byTerm = new Map<string, boolean>();
      for (const row of parsed) {
        if (row && typeof row.term === "string" && typeof row.isFood === "boolean") {
          byTerm.set(canonicaliseTerm(row.term), row.isFood);
        }
      }

      return terms.map((term) => {
        const answer = byTerm.get(canonicaliseTerm(term));
        // No answer for this term => treat as recognised (fail open).
        return answer === undefined
          ? { term, recognised: true, source: "unavailable" as const }
          : { term, recognised: answer, source: "model" as const };
      });
    } catch (err) {
      logger.warn(
        `[FoodTermsService] Classification unavailable, accepting all: ${(err as Error).message}`,
      );
      return terms.map((term) => ({ term, recognised: true, source: "unavailable" as const }));
    }
  }

  private buildPrompt(terms: string[]): string {
    return `You are checking entries a user typed into a meal-planning app's
"allergies", "food dislikes" and "food preferences" fields.

For each entry, decide whether it is plausibly food-related — an ingredient,
a dish, a cuisine, a drink, a diet style, a food additive, or a food allergen.

BE GENEROUS. Say true whenever the entry could plausibly be food-related.
Only say false when it is clearly not — an object, a person, a place, random
characters, or a sentence that is not about food.

Say TRUE for things like: obscure or regional ingredients, brand names,
misspellings, non-English words (Hebrew, Arabic, Russian…), additives and
E-numbers, medical dietary terms, broad categories like "red meat".

Say FALSE only for things like: "white socks", "my ex boyfriend", "asdfgh",
"the color blue", "my car".

A wrongly rejected allergy could make someone ill, so when you are unsure at
all, answer true.

ENTRIES:
${terms.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return ONLY a raw JSON array, one object per entry, in the same order:
[{"term": "<the entry exactly as given>", "isFood": true|false}]
No markdown, no code fences, no commentary.`;
  }

  private parseJson(text: string): any {
    if (!text) return null;
    const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start === -1 || end <= start) return null;
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
}
