import { ShoppingService } from "../../../src/shopping/shopping.service";

/**
 * The cart groups rows by ingredient key. Before the key understood plurals,
 * a plan that said "tomato" in one meal and "tomatoes" in another produced two
 * rows the user had to buy and tick off twice.
 */
const meal = (ingredients: any[]) => ({ ingredients });

const planWith = (ingredients: any[][]) => ({
  _id: "plan-1",
  userId: "user-1",
  weeklyPlan: {
    monday: {
      meals: {
        breakfast: meal(ingredients[0] || []),
        lunch: meal(ingredients[1] || []),
        dinner: meal(ingredients[2] || []),
        snacks: [],
      },
    },
  },
});

const buildService = (plan: any, existingList: any = null) => {
  const created: any[] = [];
  const shoppingListModel: any = {
    findOne: jest.fn().mockResolvedValue(existingList),
    create: jest.fn(async (doc: any) => {
      created.push(doc);
      return doc;
    }),
    deleteOne: jest.fn().mockResolvedValue({}),
  };
  const planModel: any = { findById: jest.fn().mockResolvedValue(plan) };
  const service = new ShoppingService(shoppingListModel, planModel);
  return { service, shoppingListModel, created };
};

describe("ShoppingService ingredient merging", () => {
  it("puts a singular and a plural spelling on one row", async () => {
    const { service } = buildService(
      planWith([
        [["Tomato", "2"]],
        [["Tomatoes", "3"]],
        [["cucumber", "1"]],
      ])
    );

    const result = await service.generateShoppingList("plan-1");
    const names = result.data.ingredients.map((i: any) => i.name);

    expect(names).toHaveLength(2);
    const tomato = result.data.ingredients.find((i: any) =>
      i.name.toLowerCase().startsWith("tomato")
    );
    expect(tomato.amount).toBe("5");
  });

  it("keeps distinct non-Latin ingredients on their own rows", async () => {
    const { service } = buildService(
      planWith([[["עגבניה", "2"], ["מלפפון", "1"], ["שמן זית", "10 מל"]]])
    );

    const result = await service.generateShoppingList("plan-1");

    expect(result.data.ingredients).toHaveLength(3);
    expect(new Set(result.data.ingredients.map((i: any) => i.key)).size).toBe(3);
  });

  it("repairs a stored list that already split one product in two", async () => {
    const existingList: any = {
      ingredients: [
        { name: "Tomato", amount: "200 g", category: "produce", done: true, key: "tomato" },
        { name: "Tomatoes", amount: "300 g", done: false, key: "tomatoes" },
        { name: "Milk", amount: "1 l", done: false, key: "milk" },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = buildService(planWith([]), existingList);

    const result = await service.generateShoppingList("plan-1");

    expect(existingList.save).toHaveBeenCalled();
    expect(result.data.ingredients).toHaveLength(2);

    const tomato = result.data.ingredients[0];
    expect(tomato.amount).toBe("500 g");
    // One half was still unticked, so the merged row is still to buy.
    expect(tomato.done).toBe(false);
    expect(tomato.category).toBe("produce");
  });

  it("leaves an already-clean stored list untouched", async () => {
    const existingList: any = {
      ingredients: [
        { name: "Milk", amount: "1 l", done: false, key: "milk" },
        { name: "Egg", amount: "6", done: true, key: "egg" },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = buildService(planWith([]), existingList);

    const result = await service.generateShoppingList("plan-1");

    expect(existingList.save).not.toHaveBeenCalled();
    expect(result.data.ingredients).toHaveLength(2);
    expect(result.data.ingredients[1].done).toBe(true);
  });
});
