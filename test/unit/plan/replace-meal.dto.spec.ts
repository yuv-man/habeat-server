import { ValidationPipe } from "@nestjs/common";
import { ReplaceMealDto } from "../../../src/plan/dto/replace-meal.dto";

/** The app's own global pipe settings (main.ts). */
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const run = (body: unknown) =>
  pipe.transform(body, { type: "body", metatype: ReplaceMealDto }) as Promise<ReplaceMealDto>;

const meal = {
  name: "Chicken and rice",
  calories: 595,
  macros: { protein: 42, carbs: 60, fat: 19 },
  ingredients: [["chicken breast", "150 g"]],
  prepTime: 25,
};

describe("ReplaceMealDto", () => {
  it("keeps the swap reason, origin and undo flag", async () => {
    const dto = await run({ date: "2026-10-11", mealType: "dinner", newMeal: meal, reason: "no_time", via: "my_meals", undo: true });
    expect(dto).toMatchObject({ reason: "no_time", via: "my_meals", undo: true });
  });

  it("keeps the own-dish marker and English name on the meal", async () => {
    // Undeclared fields are stripped by the whitelist pipe; this is how a
    // swapped-in own dish used to lose its "Your dish" label.
    const dto = await run({
      date: "2026-10-11",
      mealType: "dinner",
      newMeal: { ...meal, fromRepertoire: "dish_1", nameEn: "Chicken and rice" },
    });
    expect(dto.newMeal).toMatchObject({ fromRepertoire: "dish_1", nameEn: "Chicken and rice" });
  });

  it("rejects an unknown reason", async () => {
    await expect(run({ date: "2026-10-11", mealType: "dinner", newMeal: meal, reason: "bored" })).rejects.toThrow();
  });

  it("still accepts a swap with no reason at all", async () => {
    const dto = await run({ date: "2026-10-11", mealType: "dinner", newMeal: meal });
    expect(dto.reason).toBeUndefined();
  });
});
