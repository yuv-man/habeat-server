import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { UserService } from "../../../src/user/user.service";
import { User } from "../../../src/user/user.model";
import { Meal } from "../../../src/meal/meal.model";
import { NotFoundException } from "@nestjs/common";

describe("UserService", () => {
  let service: UserService;
  let mockUserModel: any;
  let mockMealModel: any;

  const mockUser = {
    _id: "507f1f77bcf86cd799439011",
    name: "Test User",
    email: "test@example.com",
    age: 30,
    gender: "male",
    height: 175,
    weight: 75,
    path: "healthy",
    allergies: [],
    dietaryRestrictions: [],
    foodPreferences: ["Italian", "Seafood"],
    favoriteMeals: ["meal1", "meal2"],
    save: jest.fn(),
  };

  const mockMeal = {
    _id: "meal1",
    name: "Test Meal",
    category: "breakfast",
    calories: 400,
  };

  beforeEach(async () => {
    mockUserModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      create: jest.fn(),
    };

    mockMealModel = {
      find: jest.fn(),
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Meal.name),
          useValue: mockMealModel,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return all users", async () => {
      mockUserModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockUser]),
        }),
      });

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe("test@example.com");
    });
  });

  describe("findById", () => {
    it("should return a user by ID", async () => {
      mockUserModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUser),
        }),
      });

      const result = await service.findById("507f1f77bcf86cd799439011");

      expect(result.email).toBe("test@example.com");
    });

    it("should throw NotFoundException if user not found", async () => {
      mockUserModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.findById("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("create", () => {
    it("should create a new user", async () => {
      const newUserData = {
        name: "New User",
        email: "new@example.com",
        age: 25,
        gender: "female",
      };

      mockUserModel.create.mockResolvedValue({
        ...newUserData,
        _id: "newuserid",
      });

      const result = await service.create(newUserData);

      expect(result.email).toBe("new@example.com");
      expect(mockUserModel.create).toHaveBeenCalledWith(newUserData);
    });
  });

  describe("update", () => {
    it("should update an existing user", async () => {
      const updateData = { name: "Updated Name" };
      const updatedUser = { ...mockUser, ...updateData };

      mockUserModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedUser),
        }),
      });

      const result = await service.update(
        "507f1f77bcf86cd799439011",
        updateData
      );

      expect(result.name).toBe("Updated Name");
    });

    it("should throw NotFoundException if user not found", async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.update("nonexistent", { name: "Test" })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("should delete a user", async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUser),
        }),
      });

      const result = await service.delete("507f1f77bcf86cd799439011");

      expect(result.id).toBe("507f1f77bcf86cd799439011");
    });

    it("should throw NotFoundException if user not found", async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.delete("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("getUserFavoriteMeals", () => {
    it("should return user favorite meals", async () => {
      mockUserModel.findById.mockResolvedValue(mockUser);
      mockMealModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockMeal]),
        }),
      });

      const result = await service.getUserFavoriteMeals(
        "507f1f77bcf86cd799439011"
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it("should throw NotFoundException if user not found", async () => {
      mockUserModel.findById.mockResolvedValue(null);

      await expect(service.getUserFavoriteMeals("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("updateUserFavoriteMeals", () => {
    it("should add meal to favorites", async () => {
      const userWithSave = {
        ...mockUser,
        favoriteMeals: [],
        save: jest.fn().mockResolvedValue(true),
      };

      mockUserModel.findById.mockResolvedValue(userWithSave);
      mockMealModel.findById.mockResolvedValue(mockMeal);

      const result = await service.updateUserFavoriteMeals(
        "507f1f77bcf86cd799439011",
        true,
        "meal1"
      );

      expect(result.success).toBe(true);
      expect(userWithSave.save).toHaveBeenCalled();
    });

    it("should remove meal from favorites", async () => {
      const userWithSave = {
        ...mockUser,
        favoriteMeals: ["meal1"],
        save: jest.fn().mockResolvedValue(true),
      };

      mockUserModel.findById.mockResolvedValue(userWithSave);
      mockMealModel.findById.mockResolvedValue(mockMeal);

      const result = await service.updateUserFavoriteMeals(
        "507f1f77bcf86cd799439011",
        false,
        "meal1"
      );

      expect(result.success).toBe(true);
      expect(userWithSave.save).toHaveBeenCalled();
    });

    it("should throw NotFoundException if meal not found", async () => {
      mockMealModel.findById.mockResolvedValue(null);

      await expect(
        service.updateUserFavoriteMeals(
          "507f1f77bcf86cd799439011",
          true,
          "nonexistent"
        )
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if user not found", async () => {
      mockMealModel.findById.mockResolvedValue(mockMeal);
      mockUserModel.findById.mockResolvedValue(null);

      await expect(
        service.updateUserFavoriteMeals("nonexistent", true, "meal1")
      ).rejects.toThrow(NotFoundException);
    });
  });
});
