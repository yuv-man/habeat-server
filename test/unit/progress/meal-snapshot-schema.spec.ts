import mongoose from "mongoose";
import { DailyProgressSchema } from "../../../src/progress/progress.model";

/**
 * The snapshot schema is strict, so any field missing from it is silently
 * dropped on save. `nameEn` was, and every localized meal on the daily tracker
 * lost its photo: the client matches photos by English name and had only the
 * Hebrew one left.
 */
describe("progress meal snapshot", () => {
  const Progress = mongoose.model("ProgressSnapshotSpec", DailyProgressSchema);

  const meal = {
    _id: new mongoose.Types.ObjectId(),
    name: "סלט טונה",
    nameEn: "Tuna Salad",
    calories: 400,
    macros: { protein: 30, carbs: 20, fat: 15 },
    category: "lunch",
    prepTime: 10,
    done: false,
  };

  it("keeps the English name on a meal", () => {
    const doc = new Progress({ meals: { lunch: meal } }) as any;
    expect(doc.toObject().meals.lunch.nameEn).toBe("Tuna Salad");
  });

  it("keeps the English name on a snack", () => {
    const doc = new Progress({
      meals: { snacks: [{ ...meal, category: "snack" }] },
    }) as any;
    expect(doc.toObject().meals.snacks[0].nameEn).toBe("Tuna Salad");
  });
});
