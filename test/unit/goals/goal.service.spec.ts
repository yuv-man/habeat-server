import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import mongoose from "mongoose";
import { GoalService } from "../../../src/goals/goal.service";
import { Goal } from "../../../src/goals/goal.model";
import { User } from "../../../src/user/user.model";
import { NotFoundException } from "@nestjs/common";

describe("GoalService", () => {
  let service: GoalService;
  let mockGoalModel: any;

  const OWNER = "507f1f77bcf86cd799439001";
  const GOAL_ID = "507f1f77bcf86cd799439011";

  const mockGoal = {
    _id: GOAL_ID,
    userId: OWNER,
    title: "Lose 5kg",
    description: "Lose 5 kilograms in 3 months",
    current: 2,
    target: 5,
    unit: "kg",
    status: "active",
    startDate: "2024-12-07",
    milestones: [],
    progressHistory: [],
  };

  /** `model.method(...).lean().exec()` resolving to `value`. */
  const leanExec = (value: unknown) => ({
    lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
  });

  beforeEach(async () => {
    mockGoalModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findOneAndDelete: jest.fn(),
      findByIdAndUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalService,
        { provide: getModelToken(Goal.name), useValue: mockGoalModel },
        { provide: getModelToken(User.name), useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<GoalService>(GoalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("returns the user's goals", async () => {
      mockGoalModel.find.mockReturnValue(leanExec([mockGoal, { ...mockGoal, _id: "g2" }]));

      const result = await service.findAll(OWNER);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(mockGoalModel.find).toHaveBeenCalledWith({
        userId: new mongoose.Types.ObjectId(OWNER),
      });
    });
  });

  describe("findById", () => {
    it("returns the goal when the caller owns it", async () => {
      mockGoalModel.findOne.mockReturnValue(leanExec(mockGoal));

      const result = await service.findById(GOAL_ID, OWNER);

      expect(result.data).toEqual(mockGoal);
      expect(mockGoalModel.findOne).toHaveBeenCalledWith({ _id: GOAL_ID, userId: OWNER });
    });

    it("reads someone else's goal as not found", async () => {
      // Scoped by owner, so ids can't be probed for existence.
      mockGoalModel.findOne.mockReturnValue(leanExec(null));

      await expect(service.findById(GOAL_ID, "someone-else")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates the goal for the user with defaults and milestone ids", async () => {
      mockGoalModel.create.mockImplementation(async (doc: any) => doc);

      const result = await service.create(OWNER, {
        title: "Run 10km",
        description: "Build up to a 10km run",
        target: 10,
        unit: "km",
        startDate: "2025-01-01",
        milestones: [{ title: "Run 1km", targetValue: 1 }],
      });

      expect(result.success).toBe(true);
      const created = mockGoalModel.create.mock.calls[0][0];
      expect(String(created.userId)).toBe(OWNER);
      expect(created.current).toBe(0);
      expect(created.status).toBe("active");
      expect(created.milestones[0]).toMatchObject({ id: "m1", completed: false });
    });
  });

  describe("update", () => {
    it("updates only a goal the caller owns", async () => {
      mockGoalModel.findOneAndUpdate.mockReturnValue(leanExec({ ...mockGoal, current: 3 }));

      const result = await service.update(GOAL_ID, { current: 3 }, OWNER);

      expect(result.data.current).toBe(3);
      expect(mockGoalModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: GOAL_ID, userId: OWNER },
        { current: 3 },
        { new: true },
      );
    });

    it("marks the goal achieved once current reaches target", async () => {
      mockGoalModel.findOneAndUpdate.mockReturnValue(leanExec({ ...mockGoal, current: 5 }));

      const result = await service.update(GOAL_ID, { current: 5 }, OWNER);

      expect(result.data.status).toBe("achieved");
      expect(mockGoalModel.findByIdAndUpdate).toHaveBeenCalledWith(GOAL_ID, {
        status: "achieved",
      });
    });

    it("throws NotFoundException for a goal the caller doesn't own", async () => {
      mockGoalModel.findOneAndUpdate.mockReturnValue(leanExec(null));

      await expect(service.update(GOAL_ID, { current: 5 }, "someone-else")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("delete", () => {
    it("deletes a goal the caller owns", async () => {
      mockGoalModel.findOneAndDelete.mockReturnValue(leanExec(mockGoal));

      const result = await service.delete(GOAL_ID, OWNER);

      expect(result.message).toBe("Goal deleted successfully");
      expect(mockGoalModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: GOAL_ID,
        userId: OWNER,
      });
    });

    it("throws NotFoundException for a goal the caller doesn't own", async () => {
      mockGoalModel.findOneAndDelete.mockReturnValue(leanExec(null));

      await expect(service.delete(GOAL_ID, "someone-else")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("addProgressEntry", () => {
    it("records the entry and marks the goal achieved at target", async () => {
      const goalDoc = { ...mockGoal, progressHistory: [] as any[], save: jest.fn() };
      mockGoalModel.findOne.mockResolvedValue(goalDoc);

      await service.addProgressEntry(GOAL_ID, 5, OWNER, "2025-01-10");

      expect(mockGoalModel.findOne).toHaveBeenCalledWith({ _id: GOAL_ID, userId: OWNER });
      expect(goalDoc.progressHistory).toEqual([{ date: "2025-01-10", value: 5 }]);
      expect(goalDoc.current).toBe(5);
      expect(goalDoc.status).toBe("achieved");
    });
  });
});
