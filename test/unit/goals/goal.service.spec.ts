import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { GoalService } from "../../../src/goals/goal.service";
import { Goal } from "../../../src/goals/goal.model";
import { NotFoundException } from "@nestjs/common";

describe("GoalService", () => {
  let service: GoalService;
  let mockGoalModel: any;

  const mockGoal = {
    _id: "507f1f77bcf86cd799439011",
    userId: "user123",
    goal: "Lose 5kg",
    description: "Lose 5 kilograms in 3 months",
    category: "weight-loss",
    targetDate: new Date("2025-03-07"),
    startDate: new Date("2024-12-07"),
    progress: 2,
    status: "active",
    target: 5,
  };

  const mockGoalsArray = [
    mockGoal,
    {
      ...mockGoal,
      _id: "507f1f77bcf86cd799439012",
      goal: "Run 10km",
      category: "fitness",
    },
  ];

  beforeEach(async () => {
    mockGoalModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalService,
        {
          provide: getModelToken(Goal.name),
          useValue: mockGoalModel,
        },
      ],
    }).compile();

    service = module.get<GoalService>(GoalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return all goals for a user", async () => {
      mockGoalModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockGoalsArray),
        }),
      });

      const result = await service.findAll("user123");

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(mockGoalModel.find).toHaveBeenCalledWith({ userId: "user123" });
    });
  });

  describe("findByUserId", () => {
    it("should return a goal by user ID", async () => {
      mockGoalModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockGoal),
        }),
      });

      const result = await service.findByUserId("user123");

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockGoal);
    });
  });

  describe("findById", () => {
    it("should return a goal by ID", async () => {
      mockGoalModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockGoal),
        }),
      });

      const result = await service.findById("507f1f77bcf86cd799439011");

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockGoal);
    });

    it("should throw NotFoundException if goal not found", async () => {
      mockGoalModel.findById.mockReturnValue({
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
    it("should create a new goal", async () => {
      const newGoalData = {
        goal: "New Goal",
        description: "New goal description",
        category: "fitness",
        targetDate: new Date("2025-06-01"),
        startDate: new Date(),
        target: 10,
      };

      mockGoalModel.create.mockResolvedValue({
        ...newGoalData,
        _id: "newgoalid",
        userId: "user123",
        progress: 0,
        status: "active",
      });

      const result = await service.create("user123", newGoalData);

      expect(result.success).toBe(true);
      expect(mockGoalModel.create).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update an existing goal", async () => {
      const updateData = { progress: 3 };
      const updatedGoal = { ...mockGoal, ...updateData };

      mockGoalModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedGoal),
        }),
      });

      const result = await service.update(
        "507f1f77bcf86cd799439011",
        updateData
      );

      expect(result.success).toBe(true);
      expect(result.data.progress).toBe(3);
    });

    it("should throw NotFoundException if goal not found", async () => {
      mockGoalModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.update("nonexistent", { progress: 5 })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("should delete a goal", async () => {
      mockGoalModel.findByIdAndDelete.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockGoal),
        }),
      });

      const result = await service.delete("507f1f77bcf86cd799439011");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Goal deleted successfully");
    });

    it("should throw NotFoundException if goal not found", async () => {
      mockGoalModel.findByIdAndDelete.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.delete("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
