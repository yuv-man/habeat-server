/**
 * Which Gemini model to call, decided at runtime rather than hard-coded.
 *
 * The behaviour analyst was pinned to "gemini-2.0-flash". Google retired it
 * (404: "no longer available"), and since the analyst fails soft, every
 * analysis silently produced nothing — no coach's brief, no link between how
 * someone feels and how they eat — while the rest of the pipeline carried on
 * looking healthy. The meal generator never broke because it already picks
 * from the models the key can actually reach; this does the same for
 * everything else.
 */

import axios from "axios";
import { GenerativeModel } from "@google/generative-ai";
import {
  callGeminiWithRateLimit,
  GeminiCallOptions,
  isModelExhausted,
} from "./gemini-rate-limiter";
import logger from "./logger";

/** Reasoning over a person's data: quality first, speed second. */
export const ANALYSIS_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
];

const LIST_TTL_MS = 60 * 60 * 1000;
let cache: { at: number; models: string[] } | null = null;

/** Models this key can call generateContent on. Empty when listing failed. */
export const listGeminiModels = async (apiKey: string): Promise<string[]> => {
  if (cache && Date.now() - cache.at < LIST_TTL_MS) return cache.models;
  try {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
      { timeout: 5000 },
    );
    const models = (response.data?.models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => String(m.name ?? "").split("/")[1])
      .filter((n: string) => n?.includes("gemini"));
    cache = { at: Date.now(), models };
    return models;
  } catch (err) {
    logger.warn(`[GeminiModels] Could not list models: ${(err as Error)?.message ?? err}`);
    return [];
  }
};

/** The priority list, narrowed to models that exist — or unchanged if listing failed. */
export const pickGeminiModels = (priority: string[], available: string[]): string[] => {
  if (!available.length) return [...priority];
  const reachable = priority.filter((m) => available.includes(m));
  return reachable.length ? reachable : [available[0]];
};

/**
 * The model that answered last, per caller. A retired or overloaded model
 * fails the same way every time, and paying ~25s to rediscover that before
 * every background dish tune is waste the user eventually feels.
 */
const lastGood = new Map<string, string>();

/** Exposed for tests. */
export const resetGeminiModelCache = (): void => {
  cache = null;
  lastGood.clear();
};

/** The priority list with a known-good model moved to the front. */
export const preferLastGood = (candidates: string[], good?: string): string[] =>
  good && candidates.includes(good) ? [good, ...candidates.filter((m) => m !== good)] : candidates;

/**
 * Call the first model that answers, moving down the list on failure — a
 * retired or over-quota model costs one attempt, not the whole feature.
 */
export const callGeminiWithFallback = async <T>(
  apiKey: string,
  priority: string[],
  generateFn: (model: GenerativeModel) => Promise<T>,
  options: GeminiCallOptions & { maxModels?: number } = {},
): Promise<T> => {
  const { maxModels = 4, ...callOptions } = options;
  const context = callOptions.context ?? "Gemini";
  const reachable = pickGeminiModels(priority, await listGeminiModels(apiKey));

  // A model that is out of daily quota answers nothing but a 429; trying it
  // costs the caller a slot in the fail-over list for nothing. The rate
  // limiter already remembers which, until the Pacific-midnight reset.
  const live = reachable.filter((m) => !isModelExhausted(m));
  const candidates = preferLastGood(live.length ? live : reachable, lastGood.get(context)).slice(
    0,
    maxModels,
  );

  let lastError: unknown;
  for (const modelName of candidates) {
    try {
      const result = await callGeminiWithRateLimit(apiKey, modelName, generateFn, {
        maxRetries: 1,
        ...callOptions,
        context: `${context}:${modelName}`,
      });
      lastGood.set(context, modelName);
      return result;
    } catch (err) {
      lastError = err;
      logger.warn(
        `[${context}] ${modelName} failed, trying the next model: ${(err as Error)?.message?.slice(0, 160) ?? err}`,
      );
    }
  }
  throw lastError ?? new Error("No Gemini model available");
};
