import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { BehaviorService } from "../../../src/behavior/behavior.service";
import { BehaviorAnalystAgent } from "../../../src/behavior/behavior-analyst.agent";
import { BehaviorProfile } from "../../../src/behavior/behavior-profile.model";
import { DailyProgress } from "../../../src/progress/progress.model";
import { MoodEntry, MealMoodCorrelation } from "../../../src/cbt/cbt.model";
import { User } from "../../../src/user/user.model";
import { Goal } from "../../../src/goals/goal.model";
import { Plan } from "../../../src/plan/plan.model";

const USER_ID = "507f1f77bcf86cd799439011";

const dateKey = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const at = (daysAgo: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const findStub = (rows: any[] = []) => ({
  find: jest.fn(() => ({
    lean: () => ({ exec: async () => rows }),
    sort: () => ({
      limit: () => ({
        select: () => ({ lean: () => ({ exec: async () => rows }) }),
      }),
    }),
  })),
  findById: jest.fn(() => ({
    lean: () => ({ exec: async () => rows[0] ?? null }),
  })),
});

/** Records what the analyst was handed, so a test can assert it was never
 *  called at all — which is the point of keeping models off request paths. */
const analystStub = (result: any) => ({
  analyse: jest.fn(async () => result),
});

let saved: any = null;
let analyst: any = null;

const build = async (opts: {
  progress?: any[];
  moods?: any[];
  user?: any;
  analysis?: any;
  existingProfile?: any;
  due?: any[];
  agingPlans?: any[];
}) => {
  saved = null;
  analyst = analystStub(opts.analysis ?? null);

  const profileModel = {
    findOne: jest.fn(() => ({
      lean: () => ({ exec: async () => opts.existingProfile ?? null }),
    })),
    find: jest.fn(() => ({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: () => ({ exec: async () => opts.due ?? [] }),
          }),
        }),
      }),
    })),
    findOneAndUpdate: jest.fn((_q: any, update: any) => {
      saved = update.$set;
      return { lean: () => ({ exec: async () => ({ ...update.$set }) }) };
    }),
    updateOne: jest.fn(() => ({ exec: async () => ({}) })),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BehaviorService,
      { provide: getModelToken(BehaviorProfile.name), useValue: profileModel },
      {
        provide: getModelToken(DailyProgress.name),
        useValue: findStub(opts.progress ?? []),
      },
      {
        provide: getModelToken(MoodEntry.name),
        useValue: findStub(opts.moods ?? []),
      },
      {
        provide: getModelToken(MealMoodCorrelation.name),
        useValue: findStub([]),
      },
      {
        provide: getModelToken(User.name),
        useValue: findStub(opts.user ? [opts.user] : []),
      },
      { provide: getModelToken(Goal.name), useValue: findStub([]) },
      {
        // Read only to spot a plan old enough that a new week is imminent.
        provide: getModelToken(Plan.name),
        useValue: {
          find: jest.fn(() => ({
            select: () => ({ lean: () => ({ exec: async () => opts.agingPlans ?? [] }) }),
          })),
        },
      },
      {
        provide: BehaviorAnalystAgent,
        useValue: analyst,
      },
    ],
  }).compile();

  return module.get<BehaviorService>(BehaviorService);
};

/** Three weeks where breakfast is planned daily and almost never eaten. */
const skippedBreakfastHistory = () =>
  Array.from({ length: 21 }, (_, i) => ({
    dateKey: dateKey(i + 1),
    caloriesConsumed: 1600,
    caloriesGoal: 2000,
    protein: { consumed: 70, goal: 140 },
    carbs: { consumed: 180, goal: 200 },
    fat: { consumed: 55, goal: 60 },
    water: { consumed: 4, goal: 8 },
    workouts: [],
    meals: {
      breakfast: { _id: `b${i}`, name: "Shakshuka", prepTime: 40, done: false },
      lunch: {
        _id: `l${i}`,
        name: "Chicken Bowl",
        prepTime: 12,
        done: true,
        completedAt: at(i + 1, 13),
      },
      dinner: {
        _id: `d${i}`,
        name: "Rice and Beans",
        prepTime: 15,
        done: true,
        completedAt: at(i + 1, 19),
      },
      snacks: [],
    },
  }));

describe("BehaviorService — the pipeline end to end", () => {
  it("builds a summary from progress documents without touching an LLM", async () => {
    const service = await build({ progress: skippedBreakfastHistory() });
    const summary = await service.buildSummary(USER_ID);

    expect(summary.adherence.bySlot.breakfast.value).toBe(0);
    expect(summary.adherence.bySlot.lunch.value).toBe(1);
    expect(summary.prepTime.avgSkipped).toBe(40);
    expect(summary.variety.repeatRate).toBeGreaterThan(0.5);
  });

  it("still produces an actionable profile when the analyst is unavailable", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      analysis: null,
    });
    await service.refreshProfile(USER_ID);

    // The half that matters to the planner is arithmetic, so a missing model
    // key costs the prose and nothing else.
    expect(saved.confidence).toBe("high");
    expect(saved.planningDirectives.simplifySlots).toContain("breakfast");
    expect(saved.planningDirectives.increaseVariety).toBe(true);
    expect(saved.patterns).toBeUndefined();
  });

  it("merges the analyst's directives with the computed ones", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      analysis: {
        behavioralSummary:
          "Breakfast rarely happens; the rest of the day is steady.",
        keyPatterns: [],
        feelingFoodRelationship: [],
        whatWorked: ["Lunch and dinner were logged nearly every day"],
        whatDidNotWork: ["A 40-minute breakfast never fitted the morning"],
        habitOpportunities: [],
        recommendations: [],
        planningDirectives: { simplifySlots: ["dinner"], maxPrepMinutes: 15 },
      },
    });

    await service.refreshProfile(USER_ID);

    // Union of both sides — the model may add, never subtract.
    expect(saved.planningDirectives.simplifySlots).toEqual(
      expect.arrayContaining(["breakfast", "dinner"]),
    );
    // And it may only lower the ceiling the user's own behaviour set.
    expect(saved.planningDirectives.maxPrepMinutes).toBe(15);
    expect(saved.narrative.whatWorked).toHaveLength(1);
  });

  it("never lets the analyst raise the prep ceiling the user established", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      analysis: {
        behavioralSummary: "",
        keyPatterns: [],
        feelingFoodRelationship: [],
        whatWorked: [],
        whatDidNotWork: [],
        habitOpportunities: [],
        recommendations: [],
        planningDirectives: { maxPrepMinutes: 60, simplifySlots: [] },
      },
    });

    await service.refreshProfile(USER_ID);
    expect(saved.planningDirectives.maxPrepMinutes).toBeLessThanOrEqual(25);
  });

  it("gives the planner nothing when the history is too thin to claim anything", async () => {
    const service = await build({
      progress: [
        {
          dateKey: dateKey(1),
          meals: {
            lunch: { _id: "l1", name: "Soup", prepTime: 10, done: true },
            snacks: [],
          },
        },
      ],
    });

    expect(await service.buildPlannerContext(USER_ID)).toBeNull();
  });

  it("hands the planner the instructions already stored on the profile", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      existingProfile: {
        version: 3,
        generatedAt: new Date(),
        confidence: "high",
        behavior: { breakfastAdherence: 0.1, dinnerAdherence: 0.9 },
        context: { busyDays: [], lowMotivationDays: [], lateEatingRate: 0.1 },
        planningDirectives: {
          maxPrepMinutes: 20,
          simplifySlots: ["breakfast"],
          flexibleSlots: [],
          weekendNeedsOwnShape: false,
          increaseVariety: false,
          reduceLateEating: false,
          emphasiseMacro: null,
          notes: [],
        },
        habitOpportunities: [],
        preferences: {},
        checks: [],
      },
    });

    const context = await service.buildPlannerContext(USER_ID);

    expect(context).toContain("breakfast");
    expect(context).toContain("20 minutes");
  });
});

describe("BehaviorService — models stay off the request path", () => {
  it("never calls the analyst while building planner context", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      existingProfile: {
        version: 2,
        // Fresh, so not even a background refresh is due.
        generatedAt: new Date(),
        confidence: "high",
        behavior: { breakfastAdherence: 0.2 },
        context: {},
        planningDirectives: {
          maxPrepMinutes: 20,
          simplifySlots: ["breakfast"],
          flexibleSlots: [],
          weekendNeedsOwnShape: false,
          increaseVariety: false,
          reduceLateEating: false,
          emphasiseMacro: null,
          notes: [],
        },
        habitOpportunities: [],
        preferences: {},
        checks: [],
      },
    });

    await service.buildPlannerContext(USER_ID);

    // The whole point of the split: generating a plan must never wait on an
    // analysis the user would feel as latency.
    expect(analyst.analyse).not.toHaveBeenCalled();
  });

  it("treats a profile older than the refresh window as due", async () => {
    const service = await build({});
    const old = new Date();
    old.setDate(old.getDate() - 10);

    expect(service.isDue(null as any)).toBe(true);
    expect(service.isDue({ generatedAt: old } as any)).toBe(true);
    expect(service.isDue({ generatedAt: new Date() } as any)).toBe(false);
  });

  it("refreshes a profile whose plan is about to be regenerated, before it is stale", async () => {
    // The trigger that makes the feature land: Monday's plan must be generated
    // against a profile refreshed the night before, not one from last week.
    let queried: any = null;
    const service = await build({
      progress: skippedBreakfastHistory(),
      agingPlans: [{ userId: { toString: () => USER_ID } }],
    });

    (service as any).profileModel.find = jest.fn((q: any) => {
      queried = q;
      return {
        sort: () => ({
          limit: () => ({
            select: () => ({
              lean: () => ({ exec: async () => [{ userId: { toString: () => USER_ID } }] }),
            }),
          }),
        }),
      };
    });

    const ids = await service.findDueUserIds();

    expect(ids).toEqual([USER_ID]);
    // Two ways onto the list: gone stale, or a new week is imminent.
    expect(queried.$or).toHaveLength(2);
    expect(queried.$or[1].userId.$in).toHaveLength(1);
  });

  it("looks for stale profiles alone when no plan is near its end", async () => {
    let queried: any = null;
    const service = await build({ agingPlans: [] });

    (service as any).profileModel.find = jest.fn((q: any) => {
      queried = q;
      return {
        sort: () => ({
          limit: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }),
        }),
      };
    });

    await service.findDueUserIds();
    expect(queried.$or).toHaveLength(1);
  });

  it("refreshes due profiles on the schedule, not on a request", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      due: [{ userId: { toString: () => USER_ID } }],
    });

    const result = await service.runScheduledAnalysis();
    expect(result).toEqual({ refreshed: 1, failed: 0 });
    expect(saved).not.toBeNull();
  });
});

describe("BehaviorService — the self-test", () => {
  const storedCheck = (over: any = {}) => ({
    id: "breakfast-adherence-low",
    fired: true,
    value: 0.1,
    threshold: 0.6,
    direction: "below",
    basis: 21,
    evidence: "2 of 21 planned breakfasts were logged (10%)",
    ...over,
  });

  const now = (id: string, over: any = {}) => ({
    id,
    area: "breakfast" as const,
    label: id,
    fired: true,
    value: 0.1,
    threshold: 0.6,
    direction: "below" as const,
    basis: 21,
    minBasis: 3,
    evidence: "unchanged",
    ...over,
  });

  it("says a claim still holds when the number has not moved", async () => {
    const service = await build({});
    const result = service.verifyAgainst(
      { version: 4, checks: [storedCheck()] } as any,
      [now("breakfast-adherence-low")],
    );

    expect(result?.results[0].outcome).toBe("holds");
    expect(result?.testedVersion).toBe(4);
    expect(result?.holds).toBe(1);
  });

  it("says a claim eased when it moved meaningfully towards its threshold", async () => {
    const service = await build({});
    const result = service.verifyAgainst(
      { version: 4, checks: [storedCheck()] } as any,
      [
        now("breakfast-adherence-low", {
          value: 0.45,
          evidence: "9 of 21 (45%)",
        }),
      ],
    );

    expect(result?.results[0].outcome).toBe("eased");
    expect(result?.results[0].before).toBe(0.1);
    expect(result?.results[0].after).toBe(0.45);
  });

  it("says a claim resolved once the check stops firing", async () => {
    const service = await build({});
    const result = service.verifyAgainst(
      { version: 4, checks: [storedCheck()] } as any,
      [now("breakfast-adherence-low", { value: 0.8, fired: false })],
    );

    expect(result?.results[0].outcome).toBe("resolved");
    expect(result?.resolved).toBe(1);
  });

  it("admits when a claim can no longer be measured", async () => {
    const service = await build({});
    const result = service.verifyAgainst(
      { version: 4, checks: [storedCheck()] } as any,
      [],
    );

    expect(result?.results[0].outcome).toBe("unverifiable");
  });

  it("has nothing to verify when nothing was ever claimed", async () => {
    const service = await build({});
    expect(service.verifyAgainst(null, [])).toBeNull();
    expect(
      service.verifyAgainst(
        { version: 1, checks: [storedCheck({ fired: false })] } as any,
        [],
      ),
    ).toBeNull();
  });

  it("grades the previous run and hands the result to the analyst", async () => {
    const service = await build({
      progress: skippedBreakfastHistory(),
      existingProfile: {
        version: 4,
        generatedAt: new Date(0),
        patterns: [
          {
            pattern: "Breakfast rarely happens",
            checkId: "breakfast-adherence-low",
          },
        ],
        checks: [storedCheck()],
      },
      analysis: {
        behavioralSummary: "",
        keyPatterns: [],
        eatingType: "mixed",
        emotionalEatingRisk: "medium",
        patternTags: [],
        suggestionTags: [],
        feelingFoodRelationship: [],
        whatWorked: [],
        whatDidNotWork: [],
        habitOpportunities: [],
        recommendations: [],
        planningDirectives: {},
      },
    });

    await service.refreshProfile(USER_ID);

    // The verification is stored with the new profile and fed back into the
    // next analysis, so a claim that eased is reported as progress rather than
    // repeated as a fresh problem.
    expect(saved.selfCheck).toBeTruthy();
    expect(saved.selfCheck.testedVersion).toBe(4);
    const handedBack = analyst.analyse.mock.calls[0][2];
    expect(handedBack.selfCheck.results[0].id).toBe("breakfast-adherence-low");
  });

  it("snapshots the checks with the profile so the next run can grade them", async () => {
    const service = await build({ progress: skippedBreakfastHistory() });
    await service.refreshProfile(USER_ID);

    const fired = saved.checks
      .filter((c: any) => c.fired)
      .map((c: any) => c.id);
    expect(fired).toContain("breakfast-adherence-low");
    expect(
      saved.checks.every((c: any) => "threshold" in c && "evidence" in c),
    ).toBe(true);
  });
});
