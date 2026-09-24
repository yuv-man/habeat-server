/**
 * One record per LLM call: which feature, which model, which user, and what it
 * cost. Nothing recorded usage before, so what a user's week costs could only
 * be guessed.
 *
 * Every call is logged (`grep "[LLMUsage]"`) and handed to a sink — the
 * LlmUsageService, which keeps daily totals per user and raises the budget
 * alert. The user is taken from the request (or job) the call happens in, via
 * AsyncLocalStorage, so no caller has to pass it along.
 */
import { AsyncLocalStorage } from "async_hooks";
import logger from "./logger";

export interface LlmUsage {
  provider: "gemini" | "openrouter";
  model: string;
  /** The feature that made the call — the caller's log context. */
  context: string;
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens, billed as output by both providers. */
  thinkingTokens?: number;
  /** Input tokens served from the provider's cache (billed at a discount). */
  cachedTokens?: number;
  /** Sent through the Batch API, which bills half. */
  batch?: boolean;
}

/**
 * Standard paid-tier prices, USD per million tokens (input, output incl.
 * thinking). Source: ai.google.dev/gemini-api/docs/pricing, September 2026.
 */
export const LLM_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3-flash-preview": { input: 0.5, output: 3.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "google/gemini-3-flash-preview": { input: 0.5, output: 3.0 },
};

/** What a call cost in USD. Unknown models are priced as the dearest Flash, so
 *  a new model shows up as expensive rather than free. */
export const costOf = (u: LlmUsage): number => {
  if (u.model.endsWith(":free")) return 0;
  const price = LLM_PRICES[u.model] ?? LLM_PRICES["gemini-3.5-flash"];
  const billed =
    (u.inputTokens * price.input + (u.outputTokens + (u.thinkingTokens ?? 0)) * price.output) / 1e6;
  return u.batch ? billed / 2 : billed;
};

// ── Who the call is for ────────────────────────────────────────────────────

const usageContext = new AsyncLocalStorage<{ userId?: string }>();

/** Run `fn` with LLM calls inside it counted against `userId`. */
export const runWithUsageUser = <T>(userId: string | undefined, fn: () => T): T =>
  usageContext.run({ userId }, fn);

export const currentUsageUser = (): string | undefined => usageContext.getStore()?.userId;

// ── Where records go ───────────────────────────────────────────────────────

export type LlmUsageRecord = LlmUsage & { userId?: string; costUsd: number };
export type LlmUsageSink = (record: LlmUsageRecord) => void;
let sink: LlmUsageSink | null = null;

/** Set by LlmUsageService once the database is up. */
export const setLlmUsageSink = (next: LlmUsageSink | null): void => {
  sink = next;
};

export const recordLlmUsage = (usage: LlmUsage, userId: string | undefined = currentUsageUser()): void => {
  const costUsd = costOf(usage);
  logger.info(
    `[LLMUsage] ${JSON.stringify({ ...usage, userId, costUsd: Number(costUsd.toFixed(6)) })}`,
  );
  try {
    sink?.({ ...usage, userId, costUsd });
  } catch (err) {
    // Metering must never break the call it measures.
    logger.warn(`[LLMUsage] Could not record usage: ${(err as Error)?.message ?? err}`);
  }
};

/** Gemini's usageMetadata, as the SDK (or a batch result) returns it. */
export const fromGeminiUsage = (
  model: string,
  context: string,
  meta: any,
): LlmUsage | null =>
  meta
    ? {
        provider: "gemini",
        model,
        context,
        inputTokens: Number(meta.promptTokenCount) || 0,
        outputTokens: Number(meta.candidatesTokenCount) || 0,
        thinkingTokens: Number(meta.thoughtsTokenCount) || 0,
        cachedTokens: Number(meta.cachedContentTokenCount) || 0,
      }
    : null;

/** OpenRouter's OpenAI-style `usage` block. */
export const fromOpenRouterUsage = (
  model: string,
  context: string,
  usage: any,
): LlmUsage | null =>
  usage
    ? {
        provider: "openrouter",
        model,
        context,
        inputTokens: Number(usage.prompt_tokens) || 0,
        outputTokens: Number(usage.completion_tokens) || 0,
        thinkingTokens: Number(usage.completion_tokens_details?.reasoning_tokens) || 0,
        cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens) || 0,
      }
    : null;
