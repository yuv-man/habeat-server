import {
  estimateSnackFallback,
  GENERIC_SNACK,
  SNACK_PORTION,
} from "../../../src/plan/snack-fallback";

const usda = (calories: number) => ({
  ingredient: "x",
  amount: SNACK_PORTION,
  calories,
  macros: { protein: 3, carbs: 28, fat: 15 },
  source: "USDA" as const,
});

describe("estimateSnackFallback", () => {
  it("uses the USDA match at a snack portion", async () => {
    const lookup = jest.fn().mockResolvedValue(usda(267));
    const result = await estimateSnackFallback("Chocolate bar", lookup);

    expect(lookup).toHaveBeenCalledWith("Chocolate bar", SNACK_PORTION);
    expect(result).toMatchObject({ calories: 267, source: "usda" });
    expect(result.macros).toEqual({ protein: 3, carbs: 28, fat: 15 });
  });

  it("falls back to a generic snack when USDA has nothing", async () => {
    const result = await estimateSnackFallback("Something odd", async () => null);
    expect(result).toMatchObject({ ...GENERIC_SNACK, source: "generic" });
  });

  it("ignores implausible USDA matches", async () => {
    expect((await estimateSnackFallback("tea", async () => usda(2))).source).toBe("generic");
    expect((await estimateSnackFallback("oil", async () => usda(900))).source).toBe("generic");
  });

  it("never throws when the lookup does", async () => {
    const result = await estimateSnackFallback("Chips", async () => {
      throw new Error("network down");
    });
    expect(result.source).toBe("generic");
  });
});
