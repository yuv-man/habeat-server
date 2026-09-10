import { Test } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { BrainService } from "../../../src/brain/brain.service";
import { PatternEngine } from "../../../src/brain/patterns/pattern.engine";
import { StageEngine } from "../../../src/brain/behavior/stage.engine";
import { DecisionEngine } from "../../../src/brain/decision/decision.engine";
import { BehaviorService } from "../../../src/behavior/behavior.service";

const model = () => ({
  find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => [] }), select: () => ({ lean: () => ({ exec: async () => [] }) }), lean: () => [] }),
  findOne: jest.fn().mockReturnValue({ lean: async () => null }),
  updateOne: jest.fn().mockReturnValue({ exec: async () => ({}) }),
  updateMany: jest.fn().mockResolvedValue({}),
  bulkWrite: jest.fn().mockResolvedValue({}),
  distinct: jest.fn().mockReturnValue({ exec: async () => [] }),
});

describe("BrainModule wiring", () => {
  it("constructs BrainService with all its collaborators", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BrainService,
        PatternEngine,
        StageEngine,
        DecisionEngine,
        { provide: BehaviorService, useValue: { getProfile: async () => null, effectiveMaxPrepMinutes: async () => null } },
        { provide: getModelToken("BehaviorEvent"), useValue: model() },
        { provide: getModelToken("BehaviorPattern"), useValue: model() },
        { provide: getModelToken("BrainStateDoc"), useValue: model() },
        { provide: getModelToken("DailyProgress"), useValue: model() },
        { provide: getModelToken("MoodEntry"), useValue: model() },
        { provide: getModelToken("MealMoodCorrelation"), useValue: model() },
      ],
    }).compile();

    expect(moduleRef.get(BrainService)).toBeInstanceOf(BrainService);
  });
});
