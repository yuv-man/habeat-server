import { Test, TestingModule } from "@nestjs/testing";
import { RecipeController } from "../../../src/recipe/recipe.controller";
import { RecipeService } from "../../../src/recipe/recipe.service";
import { AuthGuard } from "../../../src/auth/auth.guard";
import { ForbiddenException } from "@nestjs/common";

const asUser = (id: string, role = "user") => ({ user: { _id: id, role } });
const user = asUser("user123");
const admin = asUser("admin1", "admin");

// Mock AuthGuard to bypass authentication in tests
const mockAuthGuard = {
  canActivate: jest.fn().mockReturnValue(true),
};

describe("RecipeController", () => {
  let controller: RecipeController;
  let mockRecipeService: any;

  const mockRecipe = {
    _id: "507f1f77bcf86cd799439011",
    mealName: "Grilled Chicken Salad",
    category: "lunch",
    servings: 2,
    prepTime: 15,
    cookTime: 20,
    nutrition: {
      calories: 450,
      protein: 35,
      carbs: 20,
      fat: 25,
    },
    ingredients: [{ name: "chicken", amount: "200", unit: "g" }],
    instructions: [{ step: 1, instruction: "Cook chicken" }],
    language: "en",
  };

  beforeEach(async () => {
    mockRecipeService = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByMealId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      search: jest.fn(),
      getPopular: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecipeController],
      providers: [
        {
          provide: RecipeService,
          useValue: mockRecipeService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = module.get<RecipeController>(RecipeController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return all recipes", async () => {
      const expectedResult = { success: true, data: [mockRecipe] };
      mockRecipeService.findAll.mockResolvedValue(expectedResult);

      const result = await controller.findAll();

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.findAll).toHaveBeenCalledWith({
        category: undefined,
        language: undefined,
      });
    });

    it("should return filtered recipes", async () => {
      const expectedResult = { success: true, data: [mockRecipe] };
      mockRecipeService.findAll.mockResolvedValue(expectedResult);

      const result = await controller.findAll("lunch", "en");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.findAll).toHaveBeenCalledWith({
        category: "lunch",
        language: "en",
      });
    });
  });

  describe("getPopular", () => {
    it("should return popular recipes", async () => {
      const expectedResult = { success: true, data: [mockRecipe] };
      mockRecipeService.getPopular.mockResolvedValue(expectedResult);

      const result = await controller.getPopular(10);

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.getPopular).toHaveBeenCalledWith(10, undefined);
    });

    it("should return popular recipes by category", async () => {
      const expectedResult = { success: true, data: [mockRecipe] };
      mockRecipeService.getPopular.mockResolvedValue(expectedResult);

      const result = await controller.getPopular(5, "lunch");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.getPopular).toHaveBeenCalledWith(5, "lunch");
    });
  });

  describe("search", () => {
    it("should search recipes", async () => {
      const expectedResult = { success: true, data: [mockRecipe] };
      mockRecipeService.search.mockResolvedValue(expectedResult);

      const result = await controller.search("chicken", "lunch", "en");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.search).toHaveBeenCalledWith("chicken", {
        category: "lunch",
        language: "en",
      });
    });
  });

  describe("findByMealId", () => {
    it("returns the recipe for a meal in the caller's own plan", async () => {
      const expectedResult = { success: true, data: mockRecipe };
      mockRecipeService.findByMealId.mockResolvedValue(expectedResult);

      const result = await controller.findByMealId(user, "user123", "meal1", "en");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.findByMealId).toHaveBeenCalledWith("meal1", "user123", "en");
    });

    it("refuses to look inside another user's plan", () => {
      expect(() =>
        controller.findByMealId(user, "someone-else", "meal1", "en"),
      ).toThrow(ForbiddenException);
      expect(mockRecipeService.findByMealId).not.toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should return recipe by ID", async () => {
      const expectedResult = { success: true, data: mockRecipe };
      mockRecipeService.findById.mockResolvedValue(expectedResult);

      const result = await controller.findById("507f1f77bcf86cd799439011");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.findById).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011"
      );
    });
  });

  describe("create", () => {
    it("should create a new recipe", async () => {
      const newRecipe = {
        mealName: "New Recipe",
        category: "dinner",
      };
      const expectedResult = {
        success: true,
        data: { ...newRecipe, _id: "newid" },
      };
      mockRecipeService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(admin, newRecipe);

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.create).toHaveBeenCalledWith(newRecipe);
    });
  });

  describe("update", () => {
    it("should update a recipe", async () => {
      const updateData = { description: "Updated" };
      const expectedResult = {
        success: true,
        data: { ...mockRecipe, ...updateData },
      };
      mockRecipeService.update.mockResolvedValue(expectedResult);

      const result = await controller.update(
        admin,
        "507f1f77bcf86cd799439011",
        updateData
      );

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.update).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        updateData
      );
    });
  });

  describe("delete", () => {
    it("should delete a recipe", async () => {
      const expectedResult = {
        success: true,
        message: "Recipe deleted successfully",
      };
      mockRecipeService.delete.mockResolvedValue(expectedResult);

      const result = await controller.delete(admin, "507f1f77bcf86cd799439011");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.delete).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011"
      );
    });
  });

  describe("shared recipes are admin-only to change", () => {
    // A recipe is reused by every user with the same dish; one user editing
    // or deleting it changes it for all of them.
    it("refuses create, update and delete from a regular user", () => {
      expect(() => controller.create(user, {})).toThrow(ForbiddenException);
      expect(() => controller.update(user, "r1", {})).toThrow(ForbiddenException);
      expect(() => controller.delete(user, "r1")).toThrow(ForbiddenException);

      expect(mockRecipeService.create).not.toHaveBeenCalled();
      expect(mockRecipeService.update).not.toHaveBeenCalled();
      expect(mockRecipeService.delete).not.toHaveBeenCalled();
    });
  });
});
