import { Test, TestingModule } from "@nestjs/testing";
import { RecipeController } from "../../../src/recipe/recipe.controller";
import { RecipeService } from "../../../src/recipe/recipe.service";
import { AuthGuard } from "../../../src/auth/auth.guard";

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
    title: "Mediterranean Grilled Chicken Salad",
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
      findByMealName: jest.fn(),
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

  describe("findByMealName", () => {
    it("should return recipe by meal name", async () => {
      const expectedResult = { success: true, data: mockRecipe };
      mockRecipeService.findByMealName.mockResolvedValue(expectedResult);

      const result = await controller.findByMealName("Grilled Chicken", "en");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.findByMealName).toHaveBeenCalledWith(
        "Grilled Chicken",
        "en"
      );
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
        title: "New Recipe Title",
        category: "dinner",
      };
      const expectedResult = {
        success: true,
        data: { ...newRecipe, _id: "newid" },
      };
      mockRecipeService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(newRecipe);

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.create).toHaveBeenCalledWith(newRecipe);
    });
  });

  describe("update", () => {
    it("should update a recipe", async () => {
      const updateData = { title: "Updated Title" };
      const expectedResult = {
        success: true,
        data: { ...mockRecipe, ...updateData },
      };
      mockRecipeService.update.mockResolvedValue(expectedResult);

      const result = await controller.update(
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

      const result = await controller.delete("507f1f77bcf86cd799439011");

      expect(result).toEqual(expectedResult);
      expect(mockRecipeService.delete).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011"
      );
    });
  });
});
