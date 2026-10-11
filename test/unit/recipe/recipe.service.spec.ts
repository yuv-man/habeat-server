import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { RecipeService } from "../../../src/recipe/recipe.service";
import { Recipe } from "../../../src/recipe/recipe.model";
import { Meal } from "../../../src/meal/meal.model";
import { User } from "../../../src/user/user.model";
import { Plan } from "../../../src/plan/plan.model";
import { NotFoundException } from "@nestjs/common";

describe("RecipeService", () => {
  let service: RecipeService;
  let mockRecipeModel: any;
  let mockMealModel: any;
  let mockPlanModel: any;

  /** `model.method(...).lean().exec()` resolving to `value`. */
  const leanExec = (value: unknown) => ({
    lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
  });

  const mockRecipe = {
    _id: "507f1f77bcf86cd799439011",
    mealName: "Grilled Chicken Salad",
    description: "A healthy Mediterranean-style salad",
    category: "lunch",
    servings: 2,
    prepTime: 15,
    cookTime: 20,
    difficulty: "easy",
    nutrition: {
      calories: 450,
      protein: 35,
      carbs: 20,
      fat: 25,
      fiber: 5,
    },
    ingredients: [
      { name: "chicken breast", amount: "200", unit: "g" },
      { name: "mixed greens", amount: "100", unit: "g" },
    ],
    instructions: [
      { step: 1, instruction: "Season chicken", time: 5 },
      { step: 2, instruction: "Grill chicken", time: 15 },
    ],
    equipment: ["grill pan", "knife"],
    tags: ["healthy", "high-protein"],
    dietaryInfo: {
      isVegetarian: false,
      isVegan: false,
      isGlutenFree: true,
      isDairyFree: false,
      isKeto: true,
      isLowCarb: true,
    },
    language: "en",
    usageCount: 5,
    lastUsed: new Date(),
  };

  const mockRecipeArray = [
    mockRecipe,
    {
      ...mockRecipe,
      _id: "507f1f77bcf86cd799439012",
      mealName: "Avocado Toast",
      category: "breakfast",
    },
  ];

  beforeEach(async () => {
    mockRecipeModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    mockMealModel = { findById: jest.fn().mockReturnValue(leanExec(null)) };
    mockPlanModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(leanExec(null)),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipeService,
        {
          provide: getModelToken(Recipe.name),
          useValue: mockRecipeModel,
        },
        { provide: getModelToken(Meal.name), useValue: mockMealModel },
        { provide: getModelToken(User.name), useValue: { findById: jest.fn() } },
        { provide: getModelToken(Plan.name), useValue: mockPlanModel },
      ],
    }).compile();

    service = module.get<RecipeService>(RecipeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return all recipes", async () => {
      mockRecipeModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockRecipeArray),
          }),
        }),
      });

      const result = await service.findAll();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRecipeArray);
      expect(mockRecipeModel.find).toHaveBeenCalledWith({});
    });

    it("should filter recipes by category", async () => {
      mockRecipeModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([mockRecipe]),
          }),
        }),
      });

      const result = await service.findAll({ category: "lunch" });

      expect(result.success).toBe(true);
      expect(mockRecipeModel.find).toHaveBeenCalledWith({ category: "lunch" });
    });

    it("should filter recipes by language", async () => {
      mockRecipeModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([mockRecipe]),
          }),
        }),
      });

      const result = await service.findAll({ language: "en" });

      expect(result.success).toBe(true);
      expect(mockRecipeModel.find).toHaveBeenCalledWith({ language: "en" });
    });
  });

  describe("findById", () => {
    it("should return a recipe by ID", async () => {
      mockRecipeModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockRecipe),
        }),
      });
      mockRecipeModel.findByIdAndUpdate.mockResolvedValue(mockRecipe);

      const result = await service.findById("507f1f77bcf86cd799439011");

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRecipe);
    });

    it("should throw NotFoundException if recipe not found", async () => {
      mockRecipeModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.findById("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("findByMealId", () => {
    const LIBRARY_MEAL_ID = "507f1f77bcf86cd799439099";

    it("returns the stored recipe for the meal and counts the use", async () => {
      mockRecipeModel.findOne.mockReturnValue(leanExec(mockRecipe));

      const result = await service.findByMealId(LIBRARY_MEAL_ID, "user123", "en");

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRecipe);
      expect(mockRecipeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { mealId: LIBRARY_MEAL_ID },
        expect.objectContaining({ $inc: { usageCount: 1 } }),
      );
    });

    it("throws NotFoundException when the meal is in neither the library nor the plan", async () => {
      mockRecipeModel.findOne.mockReturnValue(leanExec(null));

      await expect(
        service.findByMealId("plan-meal-that-does-not-exist", "user123", "en"),
      ).rejects.toThrow(NotFoundException);
      // Only looked in the caller's plan.
      expect(mockPlanModel.findOne).toHaveBeenCalledWith({ userId: "user123" });
    });

    it("reuses another meal's recipe for the same dish instead of generating", async () => {
      const meal = {
        _id: LIBRARY_MEAL_ID,
        name: "Grilled Chicken Salad",
        category: "lunch",
        calories: 450,
        ingredients: [["chicken breast", "200g"]],
      };
      mockRecipeModel.findOne
        .mockReturnValueOnce(leanExec(null)) // nothing under this meal id yet
        .mockReturnValueOnce(leanExec({ ...mockRecipe, mealId: "other-meal" }));
      mockMealModel.findById.mockReturnValue(leanExec(meal));
      mockRecipeModel.create.mockImplementation(async (doc: any) => doc);

      const result = await service.findByMealId(LIBRARY_MEAL_ID, "user123", "en");

      expect(result.data.mealId).toBe(LIBRARY_MEAL_ID);
      expect(result.data.mealName).toBe(mockRecipe.mealName);
    });
  });

  describe("create", () => {
    it("should create a new recipe", async () => {
      const newRecipeData = {
        mealName: "New Recipe",
        category: "dinner",
        servings: 4,
        prepTime: 20,
        cookTime: 30,
        nutrition: { calories: 500, protein: 40, carbs: 30, fat: 20 },
        ingredients: [],
        instructions: [],
      };

      mockRecipeModel.create.mockResolvedValue({
        ...newRecipeData,
        _id: "507f1f77bcf86cd799439013",
        usageCount: 1,
        lastUsed: expect.any(Date),
      });

      const result = await service.create(newRecipeData as any);

      expect(result.success).toBe(true);
      expect(mockRecipeModel.create).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update an existing recipe", async () => {
      const updateData = { description: "Updated description" };
      const updatedRecipe = { ...mockRecipe, ...updateData };

      mockRecipeModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedRecipe),
        }),
      });

      const result = await service.update(
        "507f1f77bcf86cd799439011",
        updateData
      );

      expect(result.success).toBe(true);
      expect(result.data.description).toBe("Updated description");
    });

    it("should throw NotFoundException if recipe not found", async () => {
      mockRecipeModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.update("nonexistent", { description: "Test" })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("should delete a recipe", async () => {
      mockRecipeModel.findByIdAndDelete.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockRecipe),
        }),
      });

      const result = await service.delete("507f1f77bcf86cd799439011");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Recipe deleted successfully");
    });

    it("should throw NotFoundException if recipe not found", async () => {
      mockRecipeModel.findByIdAndDelete.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.delete("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("search", () => {
    it("should search recipes by query", async () => {
      mockRecipeModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([mockRecipe]),
            }),
          }),
        }),
      });

      const result = await service.search("chicken");

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe("getPopular", () => {
    it("should return popular recipes", async () => {
      mockRecipeModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockRecipeArray),
            }),
          }),
        }),
      });

      const result = await service.getPopular(10);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRecipeArray);
    });

    it("should filter popular recipes by category", async () => {
      mockRecipeModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([mockRecipe]),
            }),
          }),
        }),
      });

      const result = await service.getPopular(5, "lunch");

      expect(result.success).toBe(true);
      expect(mockRecipeModel.find).toHaveBeenCalledWith({ category: "lunch" });
    });
  });
});
