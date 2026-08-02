import {
  calculateMealSignature,
  ensureMealPersisted,
} from "../../../src/utils/meal-persistence";

const meal = (over: any = {}) => ({
  name: "Dill Edamame Stuffed Peppers",
  category: "lunch",
  calories: 620,
  macros: { protein: 32, carbs: 70, fat: 22 },
  ingredients: [["edamame", "150 g"], ["bell_pepper", "2 piece"]],
  prepTime: 25,
  ...over,
});

describe("calculateMealSignature", () => {
  it("is stable for the same dish", () => {
    expect(calculateMealSignature(meal())).toBe(calculateMealSignature(meal()));
  });

  it("ignores ingredient ordering", () => {
    const reordered = meal({
      ingredients: [["bell_pepper", "2 piece"], ["edamame", "150 g"]],
    });
    expect(calculateMealSignature(reordered)).toBe(calculateMealSignature(meal()));
  });

  it("differs for a different dish", () => {
    expect(calculateMealSignature(meal({ calories: 900 }))).not.toBe(
      calculateMealSignature(meal()),
    );
    expect(calculateMealSignature(meal({ category: "dinner" }))).not.toBe(
      calculateMealSignature(meal()),
    );
  });
});

describe("ensureMealPersisted", () => {
  const modelWith = (existing: any) => {
    const created: any[] = [];
    const incremented: any[] = [];
    return {
      created,
      incremented,
      model: {
        findOne: () => ({ lean: () => ({ exec: async () => existing }) }),
        findByIdAndUpdate: async (id: any, update: any) => {
          incremented.push({ id, update });
        },
        create: async (doc: any) => {
          created.push(doc);
          return { ...doc, _id: { toString: () => "new-id" } };
        },
      } as any,
    };
  };

  it("creates a row and returns its id when the dish is new", async () => {
    const { model, created } = modelWith(null);
    const result = await ensureMealPersisted(model, meal());

    expect(created).toHaveLength(1);
    expect(created[0].aiGenerated).toBe(true);
    expect(created[0].analytics.signature).toBe(calculateMealSignature(meal()));
    expect(result._id).toBe("new-id");
    expect(result.name).toBe("Dill Edamame Stuffed Peppers");
  });

  it("reuses the existing row instead of duplicating it", async () => {
    // Regenerating the same plan weekly must not grow the collection.
    const { model, created, incremented } = modelWith({
      _id: { toString: () => "existing-id" },
    });
    const result = await ensureMealPersisted(model, meal());

    expect(created).toHaveLength(0);
    expect(incremented).toHaveLength(1);
    expect(incremented[0].update.$inc["analytics.timesGenerated"]).toBe(1);
    expect(result._id).toBe("existing-id");
  });

  it("returns the meal unchanged rather than losing it when the write fails", async () => {
    const model: any = {
      findOne: () => ({ lean: () => ({ exec: async () => { throw new Error("db down"); } }) }),
    };
    const input = meal({ _id: "plan-local-id" });
    const result = await ensureMealPersisted(model, input);

    expect(result).toEqual(input);
  });

  it("passes through a meal with no name", async () => {
    const { model, created } = modelWith(null);
    expect(await ensureMealPersisted(model, undefined)).toBeUndefined();
    expect(created).toHaveLength(0);
  });
});
