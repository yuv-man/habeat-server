import {
  costOf,
  currentUsageUser,
  recordLlmUsage,
  runWithUsageUser,
  setLlmUsageSink,
} from "../../../src/utils/llm-usage";
import { featureOf, LlmUsageService, USER_MONTHLY_ALERT_USD } from "../../../src/llm-usage/llm-usage.service";

const USER = "507f1f77bcf86cd799439011";
const call = (over: any = {}) => ({
  provider: "gemini" as const,
  model: "gemini-3.6-flash",
  context: "DishTuner:gemini-3.6-flash",
  inputTokens: 1_000_000,
  outputTokens: 0,
  ...over,
});

describe("costOf", () => {
  it("prices input, output and thinking at the model's rate", () => {
    expect(costOf(call())).toBeCloseTo(0.75);
    // Thinking is billed as output.
    expect(costOf(call({ inputTokens: 0, outputTokens: 500_000, thinkingTokens: 500_000 }))).toBeCloseTo(3.75);
  });

  it("halves a batch call and charges nothing for a free model", () => {
    expect(costOf(call({ batch: true }))).toBeCloseTo(0.375);
    expect(costOf(call({ model: "openai/gpt-oss-20b:free" }))).toBe(0);
  });

  it("prices an unknown model as the dearest Flash, never as free", () => {
    expect(costOf(call({ model: "gemini-9-flash" }))).toBeCloseTo(1.5);
  });
});

describe("usage context", () => {
  afterEach(() => setLlmUsageSink(null));

  it("counts a call against the user whose request or job it runs in", async () => {
    const seen: any[] = [];
    setLlmUsageSink((r) => seen.push(r));
    await runWithUsageUser(USER, async () => {
      await Promise.resolve();
      recordLlmUsage(call());
    });
    recordLlmUsage(call());
    expect(seen.map((r) => r.userId)).toEqual([USER, undefined]);
    expect(seen[0].costUsd).toBeCloseTo(0.75);
    expect(currentUsageUser()).toBeUndefined();
  });

  it("never lets a failing sink break the call it measures", () => {
    setLlmUsageSink(() => {
      throw new Error("db down");
    });
    expect(() => recordLlmUsage(call())).not.toThrow();
  });

  it("files attempts under their feature", () => {
    expect(featureOf("DishTuner:gemini-3.6-flash")).toBe("DishTuner");
    expect(featureOf("Batch1")).toBe("Batch1");
  });
});

describe("LlmUsageService", () => {
  const model = (aggregates: any[][] = []) => {
    let i = 0;
    return {
      updateOne: jest.fn(() => ({ exec: async () => ({}) })),
      aggregate: jest.fn(() => ({ exec: async () => aggregates[i++] ?? [] })),
      distinct: jest.fn(() => ({ exec: async () => [] })),
    };
  };

  it("adds each call to the day's total for that user, feature and model", async () => {
    const m = model();
    const service = new LlmUsageService(m as any);
    await service.record({ ...call(), userId: USER, costUsd: 0.5 }, new Date(2026, 8, 24));

    const [filter, update, options] = (m.updateOne.mock.calls[0] as unknown) as any[];
    expect(filter).toMatchObject({ date: "2026-09-24", feature: "DishTuner", model: "gemini-3.6-flash" });
    expect(String(filter.userId)).toBe(USER);
    expect(update.$inc).toMatchObject({ calls: 1, inputTokens: 1_000_000, costUsd: 0.5 });
    expect(options).toEqual({ upsert: true });
  });

  it("raises an alert for a user over the monthly budget and for a costly day", async () => {
    const m = model([[{ _id: USER, costUsd: USER_MONTHLY_ALERT_USD + 0.1 }], [{ _id: null, costUsd: 999 }]]);
    const alerts = await new LlmUsageService(m as any).checkBudgets(new Date(2026, 8, 24));
    expect(alerts.map((a) => a.kind)).toEqual(["user-month", "daily-total"]);
    expect(alerts[0].userId).toBe(USER);
  });

  it("stays quiet when spend is within budget", async () => {
    const alerts = await new LlmUsageService(model([[], [{ _id: null, costUsd: 1 }]]) as any).checkBudgets();
    expect(alerts).toEqual([]);
  });
});
