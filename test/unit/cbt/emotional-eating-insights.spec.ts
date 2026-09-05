import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { CBTService } from "../../../src/cbt/cbt.service";
import {
  MoodEntry,
  ThoughtEntry,
  CBTExerciseCompletion,
  MealMoodCorrelation,
} from "../../../src/cbt/cbt.model";
import { User } from "../../../src/user/user.model";
import { DailyProgress } from "../../../src/progress/progress.model";
import { ChallengeService } from "../../../src/challenge/challenge.service";
import { EngagementService } from "../../../src/engagement/engagement.service";
import { BehaviorService } from "../../../src/behavior/behavior.service";

const USER_ID = "507f1f77bcf86cd799439011";

/** A model stub whose find() answers from `rows`, chained the way the service
 *  chains it. `countDocuments` answers the pattern-map guard. */
const modelStub = (rows: any[] = []) => ({
  find: jest.fn((query: any = {}) => {
    // The service asks the mood collection twice: once for everything, once for
    // the entries a user deliberately attached to a meal. Honour the filter so
    // the stub can't hand the same row back as both.
    const matched = query?.linkedMealId?.$exists
      ? rows.filter((r) => r.linkedMealId)
      : rows;
    return {
      lean: () => ({ exec: async () => matched }),
      sort: () => ({ limit: () => ({ lean: () => ({ exec: async () => matched }) }) }),
    };
  }),
  findById: jest.fn(() => ({ lean: () => ({ exec: async () => null }) })),
  countDocuments: jest.fn(async () => rows.length),
});

const dateKey = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const at = (daysAgo: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const hhmm = (hour: number, minute = 0) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

describe("CBTService — emotional eating insights over real logged meals", () => {
  const build = async (opts: {
    progress?: any[];
    moods?: any[];
    correlations?: any[];
  }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CBTService,
        { provide: getModelToken(MoodEntry.name), useValue: modelStub(opts.moods ?? []) },
        { provide: getModelToken(ThoughtEntry.name), useValue: modelStub() },
        { provide: getModelToken(CBTExerciseCompletion.name), useValue: modelStub() },
        {
          provide: getModelToken(MealMoodCorrelation.name),
          useValue: modelStub(opts.correlations ?? []),
        },
        { provide: getModelToken(User.name), useValue: modelStub() },
        {
          provide: getModelToken(DailyProgress.name),
          useValue: modelStub(opts.progress ?? []),
        },
        { provide: ChallengeService, useValue: {} },
        { provide: EngagementService, useValue: {} },
        { provide: BehaviorService, useValue: {} },
      ],
    }).compile();

    const service = module.get<CBTService>(CBTService);
    const result: any = await service.getEmotionalEatingInsights(USER_ID, "week");
    return result.data.insight;
  };

  it("counts meals ticked off on the tracker even when no mood was linked", async () => {
    const insight = await build({
      progress: [
        {
          dateKey: dateKey(1),
          meals: {
            breakfast: { _id: "b1", name: "Oats", done: true, completedAt: at(1, 8) },
            dinner: { _id: "d1", name: "Pasta", done: true, completedAt: at(1, 19) },
            snacks: [],
          },
        },
      ],
    });

    // The regression this guards: meals existed, the page said there were none.
    expect(insight.mealsLogged).toBe(2);
    expect(insight.unscoredMeals).toBe(2);
    const day = insight.dailyBreakdown.find((d: any) => d.date === dateKey(1));
    expect(day.mealsLogged).toBe(2);
    expect(day.mindfulScore).toBeNull();
  });

  it("scores a logged meal against a mood check-in logged near it", async () => {
    const insight = await build({
      progress: [
        {
          dateKey: dateKey(1),
          meals: {
            dinner: { _id: "d1", name: "Pasta", done: true, completedAt: at(1, 19) },
            snacks: [],
          },
        },
      ],
      moods: [
        {
          date: dateKey(1),
          time: hhmm(19, 20),
          moodLevel: 4,
          moodCategory: "stressed",
        },
      ],
    });

    expect(insight.inferredMeals).toBe(1);
    expect(insight.totalMeals).toBe(1);
    const day = insight.dailyBreakdown.find((d: any) => d.date === dateKey(1));
    expect(day.mindfulScore).not.toBeNull();
    expect(day.moodAvg).toBe(4);
    // The mood beside the meal becomes a named trigger, not a generic label.
    expect(insight.commonEmotions).toContainEqual({ emotion: "stressed", count: 1 });
  });

  it("leaves a meal unscored when the nearest mood is hours away", async () => {
    const insight = await build({
      progress: [
        {
          dateKey: dateKey(1),
          meals: {
            dinner: { _id: "d1", name: "Pasta", done: true, completedAt: at(1, 19) },
            snacks: [],
          },
        },
      ],
      moods: [
        { date: dateKey(1), time: hhmm(8), moodLevel: 4, moodCategory: "calm" },
      ],
    });

    expect(insight.mealsLogged).toBe(1);
    expect(insight.inferredMeals).toBe(0);
    expect(insight.unscoredMeals).toBe(1);
  });

  it("does not count a meal twice when the user linked a mood to it", async () => {
    const insight = await build({
      progress: [
        {
          dateKey: dateKey(1),
          meals: {
            dinner: { _id: "d1", name: "Pasta", done: true, completedAt: at(1, 19) },
            snacks: [],
          },
        },
      ],
      correlations: [
        {
          mealId: { toString: () => "d1" },
          mealName: "Pasta",
          mealType: "dinner",
          date: dateKey(1),
          wasEmotionalEating: false,
          hungerLevelBefore: 4,
          moodBefore: { moodLevel: 3, moodCategory: "calm" },
          createdAt: at(1, 19),
        },
      ],
      moods: [
        { date: dateKey(1), time: hhmm(19, 5), moodLevel: 3, moodCategory: "calm" },
      ],
    });

    expect(insight.linkedMeals).toBe(1);
    expect(insight.inferredMeals).toBe(0);
    expect(insight.totalMeals).toBe(1);
    // Hunger was asked once, and that one meal is the whole basis.
    expect(insight.satietyBasis).toBe(1);
    expect(insight.satietyRate).toBe(100);
  });

  it("reports satiety as unasked rather than zero when no meal carries a hunger rating", async () => {
    const insight = await build({
      progress: [
        {
          dateKey: dateKey(1),
          meals: {
            dinner: { _id: "d1", name: "Pasta", done: true, completedAt: at(1, 19) },
            snacks: [],
          },
        },
      ],
      moods: [
        { date: dateKey(1), time: hhmm(19, 10), moodLevel: 2, moodCategory: "sad" },
      ],
    });

    expect(insight.satietyBasis).toBe(0);
    expect(insight.satietyRate).toBe(0);
  });

  it("builds real pattern rows from logged meals instead of leaving the table on examples", async () => {
    const progress = [0, 1, 2, 3, 4].map((n) => ({
      dateKey: dateKey(n + 1),
      meals: {
        breakfast: { _id: `b${n}`, name: "Oats", done: true, completedAt: at(n + 1, 8) },
        lunch: { _id: `l${n}`, name: "Salad", done: false },
        snacks: [
          { _id: `s${n}`, name: "Crisps", done: true, completedAt: at(n + 1, 22) },
        ],
      },
    }));

    const insight = await build({ progress });
    const keys = insight.patterns.map((p: any) => p.key);

    expect(insight.patterns.length).toBeGreaterThan(0);
    expect(keys).toContain("late-night");
    expect(keys).toContain("consistency-breakfast");
    expect(keys).toContain("skipped-lunch");
  });

  it("never invents a pattern when nothing has been logged", async () => {
    const insight = await build({});
    expect(insight.patterns).toEqual([]);
    expect(insight.mealsLogged).toBe(0);
  });
});
