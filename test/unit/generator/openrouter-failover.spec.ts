import {
  isOutOfCreditError,
  outputTokenBudget,
} from "../../../src/generator/generate.service";

describe("outputTokenBudget", () => {
  it("scales with the number of days requested", () => {
    expect(outputTokenBudget(1)).toBeLessThan(outputTokenBudget(7));
  });

  it("stays large enough for a full week", () => {
    // A day of four meals with ingredient lists measures ~1.5k tokens; a week
    // that truncates mid-array gets discarded entirely.
    expect(outputTokenBudget(7)).toBeGreaterThanOrEqual(7 * 1500);
  });

  it("never asks for an absurd reservation", () => {
    // OpenRouter reserves credit against max_tokens, so over-asking gets the
    // request rejected outright on a small balance.
    expect(outputTokenBudget(7)).toBeLessThanOrEqual(32768);
    expect(outputTokenBudget(365)).toBeLessThanOrEqual(32768);
  });

  it("keeps a floor for degenerate inputs", () => {
    expect(outputTokenBudget(0)).toBeGreaterThanOrEqual(4096);
    expect(outputTokenBudget(-3)).toBeGreaterThanOrEqual(4096);
  });
});

describe("isOutOfCreditError", () => {
  const orError = (message: string, status?: number) => ({
    response: { status, data: { error: { message } } },
    message: "Request failed",
  });

  it("recognises the real OpenRouter insufficient-balance message", () => {
    // Verbatim from the live API on an uncredited account.
    expect(
      isOutOfCreditError(
        orError(
          "This request requires more credits, or fewer max_tokens. You requested up to 16500 tokens, but can only afford 4440.",
        ),
      ),
    ).toBe(true);
  });

  it("recognises a bare 402", () => {
    expect(isOutOfCreditError(orError("Payment Required", 402))).toBe(true);
  });

  it("does not treat an unrelated failure as a billing problem", () => {
    // Misclassifying these would disable the paid tier for the whole process
    // over a transient blip.
    expect(isOutOfCreditError(orError("No endpoints found for model", 404))).toBe(false);
    expect(isOutOfCreditError(orError("Provider returned error", 502))).toBe(false);
    expect(isOutOfCreditError(orError("rate limit exceeded", 429))).toBe(false);
    expect(isOutOfCreditError(new Error("socket hang up"))).toBe(false);
  });
});
