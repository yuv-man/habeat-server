import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { ProgressService } from "../../../src/progress/progress.service";
import { DailyProgress } from "../../../src/progress/progress.model";
import { Plan } from "../../../src/plan/plan.model";
import { Meal } from "../../../src/meal/meal.model";
import { NotFoundException } from "@nestjs/common";

describe("ProgressService", () => {
  let service: ProgressService;
  let mockProgressModel: any;
  let mockPlanModel: any;
  let mockMealModel: any;

  // Mock plan with dailyMacros - this is what we should use for goals
  const mockPlanWithMacros = {
    _id: "plan123",
    userId: "user123",
    userMetrics: {
      tdee: 2000,
      dailyMacros: {
        protein: 150,
        carbs: 250,
        fat: 70,
      },
    },
    weeklyPlan: {
      "2024-12-13": {
        meals: {
          breakfast: {
            name: "Oatmeal",
            calories: 300,
            macros: { protein: 10, carbs: 50, fat: 8 },
          },
          lunch: {
            name: "Salad",
            calories: 400,
            macros: { protein: 20, carbs: 30, fat: 15 },
          },
          dinner: {
            name: "Chicken",
            calories: 500,
            macros: { protein: 40, carbs: 20, fat: 20 },
          },
          snacks: [],
        },
        workouts: [
          {
            name: "Running",
            category: "cardio",
            duration: 30,
            caloriesBurned: 300,
          },
        ],
        waterIntake: 8,
      },
    },
    weeklyMacros: {
      calories: { consumed: 0, total: 14000 },
      protein: { consumed: 0, total: 700 },
      carbs: { consumed: 0, total: 1400 },
      fat: { consumed: 0, total: 490 },
    },
    save: jest.fn().mockResolvedValue(true),
  };

  const mockProgress = {
    _id: "progress123",
    userId: "user123",
    planId: "plan123",
    date: new Date(),
    caloriesConsumed: 0,
    caloriesGoal: 2000,
    water: { consumed: 5, goal: 8 },
    meals: {
      breakfast: {
        _id: "meal1",
        name: "Oatmeal",
        calories: 300,
        macros: { protein: 10, carbs: 50, fat: 8 },
        done: false,
      },
      lunch: {
        _id: "meal2",
        name: "Salad",
        calories: 400,
        macros: { protein: 20, carbs: 30, fat: 15 },
        done: false,
      },
      dinner: {
        _id: "meal3",
        name: "Chicken",
        calories: 500,
        macros: { protein: 40, carbs: 20, fat: 20 },
        done: false,
      },
      snacks: [
        {
          _id: { toString: () => "snack1" },
          name: "Apple",
          calories: 100,
          macros: { protein: 1, carbs: 25, fat: 0 },
          done: false,
        },
      ],
    },
    workouts: [
      {
        name: "Running",
        category: "cardio",
        duration: 30,
        caloriesBurned: 300,
        done: false,
      },
    ],
    protein: { consumed: 0, goal: 150 },
    carbs: { consumed: 0, goal: 250 },
    fat: { consumed: 0, goal: 70 },
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    mockProgressModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };

    mockPlanModel = {
      findOne: jest.fn(),
    };

    mockMealModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
      findByIdAndUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => ({
        _id: "newMealId",
        ...data,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressService,
        {
          provide: getModelToken(DailyProgress.name),
          useValue: mockProgressModel,
        },
        {
          provide: getModelToken(Plan.name),
          useValue: mockPlanModel,
        },
        {
          provide: getModelToken(Meal.name),
          useValue: mockMealModel,
        },
      ],
    }).compile();

    service = module.get<ProgressService>(ProgressService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTodayProgress", () => {
    it("should return existing progress for today", async () => {
      mockProgressModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockProgress),
      });
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.getTodayProgress("user123");

      expect(result.success).toBe(true);
      expect(result.data.progress).toBeDefined();
      expect(result.data.stats).toBeDefined();
    });

    it("should create new progress with nutrition goals from plan if none exists", async () => {
      mockProgressModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);
      mockProgressModel.create.mockResolvedValue(mockProgress);

      const result = await service.getTodayProgress("user123");

      expect(result.success).toBe(true);
      expect(mockProgressModel.create).toHaveBeenCalled();

      // CRITICAL: Verify nutrition goals are set from plan's dailyMacros
      const createCall = mockProgressModel.create.mock.calls[0][0];
      expect(createCall.protein.goal).toBe(150); // from dailyMacros.protein
      expect(createCall.carbs.goal).toBe(250); // from dailyMacros.carbs
      expect(createCall.fat.goal).toBe(70); // from dailyMacros.fat
      expect(createCall.caloriesGoal).toBe(2000); // from tdee
    });

    it("should set nutrition goals to 0 if plan has no dailyMacros", async () => {
      const planWithoutMacros = {
        ...mockPlanWithMacros,
        userMetrics: { tdee: 2000 }, // no dailyMacros
      };
      mockProgressModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });
      mockPlanModel.findOne.mockResolvedValue(planWithoutMacros);
      mockProgressModel.create.mockResolvedValue(mockProgress);

      await service.getTodayProgress("user123");

      const createCall = mockProgressModel.create.mock.calls[0][0];
      expect(createCall.protein.goal).toBe(0);
      expect(createCall.carbs.goal).toBe(0);
      expect(createCall.fat.goal).toBe(0);
    });
  });

  describe("getProgressByDate", () => {
    it("should return progress for specific date", async () => {
      mockProgressModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockProgress),
        }),
      });

      const result = await service.getProgressByDate("user123", "2024-12-07");

      expect(result.success).toBe(true);
      expect(result.data.progress).toBeDefined();
    });

    it("should throw NotFoundException if no progress for date", async () => {
      mockProgressModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.getProgressByDate("user123", "2024-01-01")
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getProgressByDateRange", () => {
    it("should return progress for date range", async () => {
      mockProgressModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            sort: jest.fn().mockResolvedValue([mockProgress]),
          }),
        }),
      });

      const result = await service.getProgressByDateRange(
        "user123",
        "2024-12-01",
        "2024-12-07"
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe("markMealCompleted - Toggle behavior", () => {
    it("should mark meal as completed and ADD calories when done=false->true", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 0,
        protein: { consumed: 0, goal: 150 },
        carbs: { consumed: 0, goal: 250 },
        fat: { consumed: 0, goal: 70 },
        meals: {
          ...mockProgress.meals,
          breakfast: { ...mockProgress.meals.breakfast, done: false },
        },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.markMealCompleted(
        "user123",
        "meal1",
        "breakfast"
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("breakfast marked as completed");
      // Verify calories were added
      expect(progressWithSave.caloriesConsumed).toBe(300);
      expect(progressWithSave.protein.consumed).toBe(10);
      expect(progressWithSave.carbs.consumed).toBe(50);
      expect(progressWithSave.fat.consumed).toBe(8);
    });

    it("should mark meal as incomplete and SUBTRACT calories when done=true->false", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 300,
        protein: { consumed: 10, goal: 150 },
        carbs: { consumed: 50, goal: 250 },
        fat: { consumed: 8, goal: 70 },
        meals: {
          ...mockProgress.meals,
          breakfast: { ...mockProgress.meals.breakfast, done: true },
        },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.markMealCompleted(
        "user123",
        "meal1",
        "breakfast"
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("breakfast marked as incomplete");
      // Verify calories were subtracted
      expect(progressWithSave.caloriesConsumed).toBe(0);
      expect(progressWithSave.protein.consumed).toBe(0);
      expect(progressWithSave.carbs.consumed).toBe(0);
      expect(progressWithSave.fat.consumed).toBe(0);
    });

    it("should not go below 0 when subtracting calories", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 100, // Less than meal calories
        protein: { consumed: 5, goal: 150 },
        carbs: { consumed: 10, goal: 250 },
        fat: { consumed: 2, goal: 70 },
        meals: {
          ...mockProgress.meals,
          breakfast: { ...mockProgress.meals.breakfast, done: true },
        },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      await service.markMealCompleted("user123", "meal1", "breakfast");

      // Should not go negative
      expect(progressWithSave.caloriesConsumed).toBe(0);
      expect(progressWithSave.protein.consumed).toBe(0);
      expect(progressWithSave.carbs.consumed).toBe(0);
      expect(progressWithSave.fat.consumed).toBe(0);
    });

    it("should throw NotFoundException if progress not found", async () => {
      mockProgressModel.findOne.mockResolvedValue(null);

      await expect(
        service.markMealCompleted("user123", "meal1", "breakfast")
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if meal not found", async () => {
      const progressWithSave = {
        ...mockProgress,
        meals: {
          breakfast: null,
          lunch: null,
          dinner: null,
          snacks: [],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);

      await expect(
        service.markMealCompleted("user123", "meal1", "breakfast")
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle snacks toggle correctly", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 0,
        protein: { consumed: 0, goal: 150 },
        carbs: { consumed: 0, goal: 250 },
        fat: { consumed: 0, goal: 70 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.markMealCompleted(
        "user123",
        "snack1",
        "snacks"
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("snacks marked as completed");
      expect(progressWithSave.caloriesConsumed).toBe(100);
    });
  });

  describe("addWaterGlass", () => {
    it("should add a water glass", async () => {
      const progressWithSave = {
        ...mockProgress,
        water: { consumed: 5, goal: 8 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);

      const result = await service.addWaterGlass("user123");

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("Water glass added");
      expect(progressWithSave.water.consumed).toBe(6);
    });

    it("should create progress with nutrition goals if none exists", async () => {
      mockProgressModel.findOne.mockResolvedValue(null);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);
      const createdProgress = {
        ...mockProgress,
        water: { consumed: 0, goal: 8 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.create.mockResolvedValue(createdProgress);

      await service.addWaterGlass("user123");

      expect(mockProgressModel.create).toHaveBeenCalled();
      const createCall = mockProgressModel.create.mock.calls[0][0];
      // CRITICAL: Verify nutrition goals are set from plan
      expect(createCall.protein.goal).toBe(150);
      expect(createCall.carbs.goal).toBe(250);
      expect(createCall.fat.goal).toBe(70);
    });
  });

  describe("updateWaterIntake", () => {
    it("should update water intake", async () => {
      const progressWithSave = {
        ...mockProgress,
        water: { consumed: 5, goal: 8 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);

      const result = await service.updateWaterIntake("user123", 7);

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("Water intake updated to 7 glasses");
      expect(progressWithSave.water.consumed).toBe(7);
    });

    it("should create progress with nutrition goals if none exists", async () => {
      mockProgressModel.findOne.mockResolvedValue(null);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);
      const createdProgress = {
        ...mockProgress,
        water: { consumed: 0, goal: 8 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.create.mockResolvedValue(createdProgress);

      await service.updateWaterIntake("user123", 5);

      const createCall = mockProgressModel.create.mock.calls[0][0];
      expect(createCall.protein.goal).toBe(150);
      expect(createCall.carbs.goal).toBe(250);
      expect(createCall.fat.goal).toBe(70);
    });
  });

  describe("markWorkoutCompleted - Toggle behavior", () => {
    it("should mark workout as completed when done=false->true", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 1000,
        workouts: [
          {
            name: "Running",
            category: "cardio",
            duration: 30,
            caloriesBurned: 300,
            done: false,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.markWorkoutCompleted(
        "user123",
        "Running",
        30,
        300,
        "cardio"
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("Workout marked as completed");
      expect(progressWithSave.workouts[0].done).toBe(true);
      // Calories burned should be subtracted from consumed
      expect(progressWithSave.caloriesConsumed).toBe(700);
    });

    it("should mark workout as incomplete and ADD back calories when done=true->false", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 700, // After burning 300
        workouts: [
          {
            name: "Running",
            category: "cardio",
            duration: 30,
            caloriesBurned: 300,
            done: true,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.markWorkoutCompleted(
        "user123",
        "Running",
        30,
        300,
        "cardio"
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("Workout marked as incomplete");
      expect(progressWithSave.workouts[0].done).toBe(false);
      // Calories should be added back
      expect(progressWithSave.caloriesConsumed).toBe(1000);
    });

    it("should throw NotFoundException if progress not found", async () => {
      mockProgressModel.findOne.mockResolvedValue(null);

      await expect(
        service.markWorkoutCompleted("user123", "Running", 30, 300, "cardio")
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if workout not found", async () => {
      const progressWithSave = {
        ...mockProgress,
        workouts: [],
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);

      await expect(
        service.markWorkoutCompleted("user123", "Yoga", 30, 100, "flexibility")
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("addCustomCalories", () => {
    it("should add custom calories", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 500,
        protein: { consumed: 20, goal: 150 },
        carbs: { consumed: 50, goal: 250 },
        fat: { consumed: 10, goal: 70 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);

      const result = await service.addCustomCalories("user123", 200, "Snack", {
        protein: 10,
        carbs: 20,
        fat: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data.message).toBe("Added 200 calories from Snack");
      expect(progressWithSave.caloriesConsumed).toBe(700);
      expect(progressWithSave.protein.consumed).toBe(30);
      expect(progressWithSave.carbs.consumed).toBe(70);
      expect(progressWithSave.fat.consumed).toBe(15);
    });

    it("should create progress with nutrition goals if none exists", async () => {
      mockProgressModel.findOne.mockResolvedValue(null);
      mockPlanModel.findOne.mockResolvedValue(mockPlanWithMacros);
      const createdProgress = {
        ...mockProgress,
        caloriesConsumed: 0,
        protein: { consumed: 0, goal: 150 },
        carbs: { consumed: 0, goal: 250 },
        fat: { consumed: 0, goal: 70 },
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.create.mockResolvedValue(createdProgress);

      await service.addCustomCalories("user123", 200, "Snack");

      const createCall = mockProgressModel.create.mock.calls[0][0];
      expect(createCall.protein.goal).toBe(150);
      expect(createCall.carbs.goal).toBe(250);
      expect(createCall.fat.goal).toBe(70);
    });
  });

  describe("getWeeklySummary", () => {
    it("should return weekly summary", async () => {
      mockProgressModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([mockProgress]),
        }),
      });

      const result = await service.getWeeklySummary("user123");

      expect(result.success).toBe(true);
      expect(result.data.summary).toBeDefined();
      expect(result.data.summary.daysTracked).toBe(1);
    });
  });

  describe("resetTodayProgress", () => {
    it("should reset today progress", async () => {
      const progressWithSave = {
        ...mockProgress,
        caloriesConsumed: 1000,
        protein: { consumed: 50, goal: 150 },
        carbs: { consumed: 100, goal: 250 },
        fat: { consumed: 30, goal: 70 },
        meals: {
          breakfast: { done: true },
          lunch: { done: true },
          dinner: { done: false },
          snacks: [{ done: true }],
        },
        workouts: [{ done: true }],
        save: jest.fn().mockResolvedValue(true),
      };
      mockProgressModel.findOne.mockResolvedValue(progressWithSave);

      const result = await service.resetTodayProgress("user123");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Today's progress has been reset");
      // Verify all done flags are reset
      expect(progressWithSave.meals.breakfast.done).toBe(false);
      expect(progressWithSave.meals.lunch.done).toBe(false);
      expect(progressWithSave.workouts[0].done).toBe(false);
    });

    it("should throw NotFoundException if no progress for today", async () => {
      mockProgressModel.findOne.mockResolvedValue(null);

      await expect(service.resetTodayProgress("user123")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("Nutrition goals initialization", () => {
    it("should round nutrition goals when creating progress", async () => {
      const planWithDecimalMacros = {
        ...mockPlanWithMacros,
        userMetrics: {
          tdee: 2000,
          dailyMacros: {
            protein: 150.7,
            carbs: 249.3,
            fat: 69.8,
          },
        },
      };
      mockProgressModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });
      mockPlanModel.findOne.mockResolvedValue(planWithDecimalMacros);
      mockProgressModel.create.mockResolvedValue(mockProgress);

      await service.getTodayProgress("user123");

      const createCall = mockProgressModel.create.mock.calls[0][0];
      expect(createCall.protein.goal).toBe(151); // Rounded
      expect(createCall.carbs.goal).toBe(249); // Rounded
      expect(createCall.fat.goal).toBe(70); // Rounded
    });
  });
});
