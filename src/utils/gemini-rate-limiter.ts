import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import logger from "./logger";

/**
 * Gemini Rate Limiter - Token Bucket Algorithm for Free Tier
 *
 * Free tier limits (gemini-2.0-flash / gemini-2.5-flash-lite):
 * - 15 RPM (requests per minute)
 * - 1,000,000 TPM (tokens per minute)
 * - 1,500 RPD (requests per day)
 *
 * Token Bucket Strategy:
 * - Bucket capacity: 15 tokens (max burst)
 * - Refill rate: 1 token every 4 seconds (15 per minute)
 * - Each request consumes 1 token
 * - If no tokens available, wait for refill
 */

// Token bucket state
interface TokenBucket {
  tokens: number;
  lastRefillTime: number;
  capacity: number;
  refillRateMs: number; // Time in ms to add 1 token
}

// Free tier settings (conservative to avoid 429s)
const FREE_TIER_BUCKET: TokenBucket = {
  tokens: 3, // Start with 3 tokens (small burst allowed)
  lastRefillTime: Date.now(),
  capacity: 5, // Max 5 tokens (conservative burst limit)
  refillRateMs: 5000, // 1 token every 5 seconds = 12 RPM (under 15 RPM limit)
};

// Global request queue for serialization
let requestQueue: Promise<void> = Promise.resolve();

// Track consecutive 429 errors for adaptive backoff
let consecutive429Count = 0;
let lastSuccessTime = Date.now();

// Helper to extract error message
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return "Unknown error";
};

/**
 * Parse retry delay from Gemini rate limit error
 * Example: "Please retry in 7.029778939s"
 */
const parseRetryDelay = (errorMessage: string): number => {
  const match = errorMessage.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (match) {
    const seconds = parseFloat(match[1]);
    // Add a buffer (1s) to ensure we're past the limit
    return Math.ceil((seconds + 1) * 1000);
  }
  // Default to 10 seconds if we can't parse
  return 10000;
};

/**
 * Check if error is a rate limit error
 */
const isRateLimitError = (errorMessage: string): boolean => {
  const rateLimitPatterns = [
    "429",
    "quota",
    "rate_limit",
    "rate limit",
    "too many requests",
    "resource has been exhausted",
    "retry in",
    "quotafailure",
  ];
  const lowerMsg = errorMessage.toLowerCase();
  return rateLimitPatterns.some((pattern) => lowerMsg.includes(pattern));
};

/**
 * Check if error is retryable (temporary server errors)
 */
const isRetryableError = (errorMessage: string): boolean => {
  const retryablePatterns = [
    "503",
    "500",
    "502",
    "504",
    "overloaded",
    "timed out",
    "timeout",
    "econnreset",
    "enotfound",
    "service unavailable",
  ];
  const lowerMsg = errorMessage.toLowerCase();
  return retryablePatterns.some((pattern) => lowerMsg.includes(pattern));
};

/**
 * Refill tokens based on elapsed time
 */
const refillTokens = (bucket: TokenBucket): void => {
  const now = Date.now();
  const elapsed = now - bucket.lastRefillTime;
  const tokensToAdd = Math.floor(elapsed / bucket.refillRateMs);

  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefillTime = now;
    logger.debug(`[RateLimiter] Refilled ${tokensToAdd} tokens. Current: ${bucket.tokens}`);
  }
};

/**
 * Acquire a token from the bucket, waiting if necessary
 */
const acquireToken = async (bucket: TokenBucket): Promise<void> => {
  // First, refill based on elapsed time
  refillTokens(bucket);

  // If we have tokens, consume one immediately
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    logger.debug(`[RateLimiter] Token acquired. Remaining: ${bucket.tokens}`);
    return;
  }

  // No tokens available - calculate wait time
  const waitTime = bucket.refillRateMs - (Date.now() - bucket.lastRefillTime);
  const adjustedWait = Math.max(waitTime, 1000); // Minimum 1s wait

  // Apply adaptive backoff if we've had recent 429s
  const adaptiveMultiplier = Math.min(1 + consecutive429Count * 0.5, 3); // Max 3x slowdown
  const finalWait = Math.ceil(adjustedWait * adaptiveMultiplier);

  logger.info(
    `[RateLimiter] No tokens available. Waiting ${finalWait}ms (adaptive: ${adaptiveMultiplier}x)`
  );

  await new Promise((resolve) => setTimeout(resolve, finalWait));

  // Refill and consume
  refillTokens(bucket);
  bucket.tokens = Math.max(0, bucket.tokens - 1);
};

/**
 * Handle 429 error - update adaptive backoff and wait
 */
const handle429Error = async (errorMessage: string): Promise<void> => {
  consecutive429Count++;
  const retryDelay = parseRetryDelay(errorMessage);

  // Apply exponential backoff based on consecutive 429s
  const backoffMultiplier = Math.pow(1.5, Math.min(consecutive429Count - 1, 4));
  const finalDelay = Math.ceil(retryDelay * backoffMultiplier);

  logger.warn(
    `[RateLimiter] 429 error #${consecutive429Count}. Waiting ${finalDelay}ms (base: ${retryDelay}ms, multiplier: ${backoffMultiplier}x)`
  );

  // Also reduce bucket tokens to prevent immediate re-429
  FREE_TIER_BUCKET.tokens = 0;
  FREE_TIER_BUCKET.lastRefillTime = Date.now() + finalDelay; // Push refill time into future

  await new Promise((resolve) => setTimeout(resolve, finalDelay));
};

/**
 * Mark successful request - reset consecutive 429 counter
 */
const markSuccess = (): void => {
  if (consecutive429Count > 0) {
    logger.info(`[RateLimiter] Success after ${consecutive429Count} consecutive 429s. Resetting counter.`);
  }
  consecutive429Count = 0;
  lastSuccessTime = Date.now();
};

/**
 * Queue requests to prevent concurrent bursts
 */
const queueRequest = async <T>(fn: () => Promise<T>): Promise<T> => {
  // Chain this request after all previous ones
  const previousQueue = requestQueue;
  let resolve: () => void;
  requestQueue = new Promise<void>((r) => {
    resolve = r;
  });

  // Wait for previous request to complete
  await previousQueue;

  try {
    // Acquire token before making request
    await acquireToken(FREE_TIER_BUCKET);
    return await fn();
  } finally {
    resolve!();
  }
};

export interface GeminiCallOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  context?: string;
}

/**
 * Call Gemini with token bucket rate limiting and automatic retry
 */
export const callGeminiWithRateLimit = async <T>(
  apiKey: string,
  modelName: string,
  generateFn: (model: GenerativeModel) => Promise<T>,
  options: GeminiCallOptions = {}
): Promise<T> => {
  const {
    maxRetries = 4, // Increased retries for better resilience
    baseDelayMs = 2000,
    timeoutMs = 45000, // Increased timeout for larger batch requests
    context = "Gemini",
  } = options;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const executeWithRetry = async (attempt: number): Promise<T> => {
    try {
      logger.info(`[${context}] Attempt ${attempt + 1}/${maxRetries} using ${modelName}...`);

      // Create timeout promise
      let timeoutHandle: NodeJS.Timeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      // Execute the actual call
      const resultPromise = generateFn(model);

      // Race between result and timeout
      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timeoutHandle!);

      // Mark success and return
      markSuccess();
      logger.info(`[${context}] Success on attempt ${attempt + 1}`);
      return result;
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      // Check if it's a rate limit error
      if (isRateLimitError(errorMsg)) {
        if (attempt < maxRetries - 1) {
          await handle429Error(errorMsg);
          return executeWithRetry(attempt + 1);
        }

        throw new Error(
          `[${context}] Rate limit exceeded after ${maxRetries} attempts: ${errorMsg}`
        );
      }

      // Check if it's a retryable server error
      if (isRetryableError(errorMsg)) {
        if (attempt < maxRetries - 1) {
          // Exponential backoff for server errors
          const delay = baseDelayMs * Math.pow(2, attempt);
          logger.warn(
            `[${context}] Server error on attempt ${attempt + 1}. Waiting ${delay}ms before retry...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return executeWithRetry(attempt + 1);
        }

        throw new Error(
          `[${context}] Server error after ${maxRetries} attempts: ${errorMsg}`
        );
      }

      // Non-retryable error (auth, invalid request, etc.)
      throw error;
    }
  };

  // Queue the request to prevent concurrent bursts
  return queueRequest(() => executeWithRetry(0));
};

/**
 * Simple wrapper for basic text generation with rate limiting
 */
export const generateTextWithRateLimit = async (
  apiKey: string,
  modelName: string,
  prompt: string,
  options: GeminiCallOptions = {}
): Promise<string> => {
  return callGeminiWithRateLimit(
    apiKey,
    modelName,
    async (model) => {
      const result = await model.generateContent([{ text: prompt }]);
      if (!result?.response) {
        throw new Error("Empty response from Gemini");
      }
      return result.response.text();
    },
    options
  );
};

/**
 * Wrapper for vision/multimodal calls with rate limiting
 */
export const generateVisionWithRateLimit = async (
  apiKey: string,
  modelName: string,
  prompt: string,
  imageBase64: string,
  mimeType: string = "image/jpeg",
  options: GeminiCallOptions = {}
): Promise<string> => {
  return callGeminiWithRateLimit(
    apiKey,
    modelName,
    async (model) => {
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType,
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      if (!result?.response) {
        throw new Error("Empty response from Gemini");
      }
      return result.response.text();
    },
    options
  );
};

/**
 * Get current rate limiter status (for debugging/monitoring)
 */
export const getRateLimiterStatus = (): {
  availableTokens: number;
  consecutive429s: number;
  lastSuccessAgo: number;
} => {
  refillTokens(FREE_TIER_BUCKET);
  return {
    availableTokens: FREE_TIER_BUCKET.tokens,
    consecutive429s: consecutive429Count,
    lastSuccessAgo: Date.now() - lastSuccessTime,
  };
};

/**
 * Reset rate limiter state (useful for testing or after long idle periods)
 */
export const resetRateLimiter = (): void => {
  FREE_TIER_BUCKET.tokens = FREE_TIER_BUCKET.capacity;
  FREE_TIER_BUCKET.lastRefillTime = Date.now();
  consecutive429Count = 0;
  lastSuccessTime = Date.now();
  logger.info("[RateLimiter] State reset");
};

// Export utility functions for use in other modules
export { getErrorMessage, isRateLimitError, isRetryableError, parseRetryDelay };
