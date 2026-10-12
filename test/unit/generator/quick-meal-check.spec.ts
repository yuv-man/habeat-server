jest.mock("../../../src/generator/generate.service", () => ({
  __esModule: true,
  default: { generateRescueMeal: jest.fn() },
  resolvePlanTargets: jest.fn(),
}));

import aiService from "../../../src/generator/generate.service";
import { GeneratorService } from "../../../src/generator/generator.service";

const generate = (aiService as any).generateRescueMeal as jest.Mock;
// The method uses no injected dependencies, so no Nest module is needed.
const service = Object.create(GeneratorService.prototype) as GeneratorService;
const target = { protein: 30, carbs: 40, fat: 15 };

const meal = (name: string, ingredients: string[]) => ({
  name,
  calories: 500,
  ingredients: ingredients.map((i) => [i, "100 g"]),
});

describe("generateCheckedQuickMeal", () => {
  beforeEach(() => generate.mockReset());

  it("returns a meal that fits", async () => {
    generate.mockResolvedValueOnce(meal("Tuna Pasta", ["pasta", "tuna"]));
    const result = await service.generateCheckedQuickMeal({ dislikes: ["Mushrooms"] }, "dinner", 500, target);
    expect(result.name).toBe("Tuna Pasta");
  });

  it("retries once when the first meal has a disliked ingredient", async () => {
    generate
      .mockResolvedValueOnce(meal("Mushroom Toast", ["mushroom", "bread"]))
      .mockResolvedValueOnce(meal("Egg Toast", ["egg", "bread"]));
    const result = await service.generateCheckedQuickMeal({ dislikes: ["Mushrooms"] }, "lunch", 400, target);
    expect(result.name).toBe("Egg Toast");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("serves the second meal when its only shortfall is a dislike", async () => {
    generate.mockResolvedValue(meal("Mushroom Toast", ["mushroom", "bread"]));
    const result = await service.generateCheckedQuickMeal({ dislikes: ["Mushrooms"] }, "lunch", 400, target);
    expect(result.name).toBe("Mushroom Toast");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("refuses rather than serve an allergen", async () => {
    generate.mockResolvedValue(meal("Peanut Noodles", ["peanut", "noodles"]));
    await expect(
      service.generateCheckedQuickMeal({ allergies: ["Peanuts"] }, "dinner", 500, target),
    ).rejects.toThrow(/fits your preferences/);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
