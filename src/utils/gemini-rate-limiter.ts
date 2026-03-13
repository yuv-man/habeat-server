import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import logger from "./logger";

/**
 * Gemini Rate Limiter - Handles rate limiting across all Gemini API calls
 *
 * Free tier limits (gemini-2.0-flash):
 * - 15 RPM (requests per minute)
 * - 1,000,000 TPM (tokens per minute)
 * - 1,500 RPD (requests per day)
 */

// Global state for rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 4500; // ~13 RPM to stay under 15 RPM limit
let requestQueue: Promise<void> = Promise.resolve();

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
    // Add a small buffer (500ms) to ensure we're past the limit
    return Math.ceil((seconds + 0.5) * 1000);
  }
  // Default to 8 seconds if we can't parse
  return 8000;
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
 * Wait for minimum interval between requests (simple throttling)
 */
const waitForThrottle = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
    logger.info(`[GeminiRateLimiter] Throttling: waiting ${waitTime}ms before next request`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
};

/**
 * Queue requests to prevent concurrent bursts
 */
const queueRequest = async <T>(fn: () => Promise<T>): Promise<T> => {
  // Chain this request after all previous ones
  const previousQueue = requestQueue;
  let resolve: () => void;
  requestQueue = new Promise<void>((r) => { resolve = r; });

  // Wait for previous request to complete
  await previousQueue;

  try {
    // Apply throttling
    await waitForThrottle();
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
 * Call Gemini with automatic rate limit handling, retry logic, and throttling
 */
export const callGeminiWithRateLimit = async <T>(
  apiKey: string,
  modelName: string,
  generateFn: (model: GenerativeModel) => Promise<T>,
  options: GeminiCallOptions = {}
): Promise<T> => {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    timeoutMs = 30000,
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

      logger.info(`[${context}] Success on attempt ${attempt + 1}`);
      return result;
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      // Check if it's a rate limit error
      if (isRateLimitError(errorMsg)) {
        const retryDelay = parseRetryDelay(errorMsg);

        if (attempt < maxRetries - 1) {
          logger.warn(
            `[${context}] Rate limited on attempt ${attempt + 1}. Waiting ${retryDelay}ms before retry...`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          return executeWithRetry(attempt + 1);
        }

        throw new Error(`[${context}] Rate limit exceeded after ${maxRetries} attempts: ${errorMsg}`);
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

        throw new Error(`[${context}] Server error after ${maxRetries} attempts: ${errorMsg}`);
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

// Export utility functions for use in other modules
export { getErrorMessage, isRateLimitError, isRetryableError, parseRetryDelay };
