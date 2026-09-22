import { ANALYSIS_MODELS, pickGeminiModels, preferLastGood } from "../../../src/utils/gemini-models";

describe("pickGeminiModels", () => {
  it("never offers a model the key cannot reach", () => {
    // gemini-2.0-flash was retired upstream; the analyst kept calling it.
    const available = ["gemini-2.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite"];
    expect(pickGeminiModels(["gemini-2.0-flash", ...ANALYSIS_MODELS], available)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash-lite",
    ]);
  });

  it("keeps priority order", () => {
    expect(pickGeminiModels(["b", "a"], ["a", "b"])).toEqual(["b", "a"]);
  });

  it("falls back to anything available when nothing in the list is", () => {
    expect(pickGeminiModels(["gemini-2.0-flash"], ["gemini-9-flash"])).toEqual(["gemini-9-flash"]);
  });

  it("tries the list as given when the model list could not be fetched", () => {
    expect(pickGeminiModels(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("does not reference a retired model", () => {
    expect(ANALYSIS_MODELS).not.toContain("gemini-2.0-flash");
  });

  it("tries what worked last time first", () => {
    // Otherwise every background call pays for rediscovering the same two
    // dead models before reaching the one that answers.
    expect(preferLastGood(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(preferLastGood(["a", "b"], "gone")).toEqual(["a", "b"]);
    expect(preferLastGood(["a", "b"], undefined)).toEqual(["a", "b"]);
  });
});
