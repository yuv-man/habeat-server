import { validateAnalysis } from "../../../src/behavior/behavior-analyst.agent";
import { buildPlannerContext } from "../../../src/behavior/behavior.prompts";
import { CheckResult } from "../../../src/behavior/behavior-checks";
import { BehaviorSummary } from "../../../src/behavior/behavior-summary.types";

const rate = (value: number | null, hits = 0, of = 0) => ({ value, hits, of });

/** Only the fields validateAnalysis actually consults. */
const summary = (over: any = {}): BehaviorSummary =>
  ({
    adherence: {
      bySlot: {
        breakfast: rate(0.87, 20, 23),
        lunch: rate(0.95, 25, 26),
        dinner: rate(0.5, 12, 24),
        snacks: rate(0.8, 8, 10),
      },
    },
    ...over,
  }) as BehaviorSummary;

/** The checks the arithmetic found. A pattern may only ever explain one of
 *  these — that is the write-time half of the system's self-test. */
const checks = (ids: string[] = ["dinner-adherence-low"]): CheckResult[] =>
  ids.map((id) => ({
    id,
    area: "dinner" as const,
    label: id,
    fired: true,
    value: 0.5,
    threshold: 0.6,
    direction: "below" as const,
    basis: 24,
    minBasis: 3,
    evidence: "12 of 24 planned dinners were logged (50%)",
  }));

const pattern = (over: any = {}) => ({
  id: "p1",
  checkId: "dinner-adherence-low",
  area: "dinner",
  pattern: "Dinner is frequently not logged",
  evidence: "12 of 24 planned dinners were not logged",
  frequency: "12 of 24",
  occurrences: 12,
  possibleExplanation: "Dinners took longer to prepare than other meals",
  impactOnGoal: "Missing dinners makes the daily protein target hard to reach",
  suggestedIntervention: "Two 15-minute dinners this week",
  confidence: 0.9,
  ...over,
});

describe("validateAnalysis — what the summary can carry", () => {
  it("keeps a well-evidenced pattern intact", () => {
    const r = validateAnalysis({ keyPatterns: [pattern()] }, summary(), checks());
    expect(r.keyPatterns).toHaveLength(1);
    expect(r.keyPatterns[0].occurrences).toBe(12);
  });

  it("drops a pattern seen only once — that is an anecdote, not a habit", () => {
    const r = validateAnalysis(
      { keyPatterns: [pattern({ occurrences: 1, frequency: "1 of 24" })] },
      summary(),
      checks()
    );
    expect(r.keyPatterns).toHaveLength(0);
  });

  it("drops a pattern the model was not confident about", () => {
    const r = validateAnalysis(
      { keyPatterns: [pattern({ confidence: 0.2 })] },
      summary(),
      checks()
    );
    expect(r.keyPatterns).toHaveLength(0);
  });

  it("drops a pattern that moralises about the user", () => {
    const r = validateAnalysis(
      {
        keyPatterns: [
          pattern({
            pattern: "A bad habit of late-night junk food",
            possibleExplanation: "Low willpower in the evenings",
          }),
        ],
      },
      summary(),
      checks()
    );
    expect(r.keyPatterns).toHaveLength(0);
  });

  it("drops a pattern citing a check that never fired", () => {
    // The write-time self-test: the arithmetic decides what is true, the model
    // only decides what it means. A finding with no check behind it is refused
    // however well it is written.
    const r = validateAnalysis(
      { keyPatterns: [pattern({ checkId: "breakfast-adherence-low" })] },
      summary(),
      checks(["dinner-adherence-low"])
    );
    expect(r.keyPatterns).toHaveLength(0);
  });

  it("drops a pattern that cites no check at all", () => {
    const r = validateAnalysis(
      { keyPatterns: [pattern({ checkId: undefined })] },
      summary(),
      checks()
    );
    expect(r.keyPatterns).toHaveLength(0);
  });

  it("drops a what-did-not-work line that shames rather than describes", () => {
    const r = validateAnalysis(
      { whatDidNotWork: ["You cheated on the plan at weekends", "Dinners were too long to cook"] },
      summary(),
      checks()
    );
    expect(r.whatDidNotWork).toEqual(["Dinners were too long to cook"]);
  });

  it("returns empty lists rather than inventing content from nothing", () => {
    const r = validateAnalysis({}, summary(), checks());
    expect(r.keyPatterns).toEqual([]);
    expect(r.recommendations).toEqual([]);
    expect(r.habitOpportunities).toEqual([]);
    expect(r.behavioralSummary).toBe("");
  });
});

describe("validateAnalysis — directives", () => {
  it("honours a simplify request for a slot the user genuinely struggles with", () => {
    const r = validateAnalysis(
      { planningDirectives: { simplifySlots: ["dinner"] } },
      summary(),
      checks()
    );
    expect(r.planningDirectives.simplifySlots).toEqual(["dinner"]);
  });

  it("refuses to simplify a meal the user already eats almost every day", () => {
    // Lunch runs at 95% — making it simpler would change a working week for
    // no reason the data supports.
    const r = validateAnalysis(
      { planningDirectives: { simplifySlots: ["lunch", "dinner"] } },
      summary(),
      checks()
    );
    expect(r.planningDirectives.simplifySlots).toEqual(["dinner"]);
  });

  it("ignores a prep ceiling outside anything a real meal takes", () => {
    expect(
      validateAnalysis({ planningDirectives: { maxPrepMinutes: 240 } }, summary(), checks())
        .planningDirectives.maxPrepMinutes
    ).toBeNull();
    expect(
      validateAnalysis({ planningDirectives: { maxPrepMinutes: 20 } }, summary(), checks())
        .planningDirectives.maxPrepMinutes
    ).toBe(20);
  });

  it("ignores a macro it made up", () => {
    const r = validateAnalysis(
      { planningDirectives: { emphasiseMacro: "vitamins" } },
      summary(),
      checks()
    );
    expect(r.planningDirectives.emphasiseMacro).toBeNull();
  });
});

describe("validateAnalysis — the absorbed characterisation", () => {
  it("keeps an eating type and bank tags the vocabularies recognise", () => {
    const r = validateAnalysis(
      {
        eatingType: "emotional",
        emotionalEatingRisk: "high",
        patternTags: ["stress-eater", "late-night-snacker"],
        suggestionTags: ["needs-breathing"],
      },
      summary(),
      checks()
    );

    expect(r.eatingType).toBe("emotional");
    expect(r.emotionalEatingRisk).toBe("high");
    expect(r.patternTags).toEqual(["stress-eater", "late-night-snacker"]);
    expect(r.suggestionTags).toEqual(["needs-breathing"]);
  });

  it("falls back to the neutral characterisation rather than an invented one", () => {
    const r = validateAnalysis(
      { eatingType: "chaotic", emotionalEatingRisk: "extreme" },
      summary(),
      checks()
    );

    expect(r.eatingType).toBe("mixed");
    expect(r.emotionalEatingRisk).toBe("medium");
  });

  it("drops tags outside the bank vocabularies, which would select nothing", () => {
    const r = validateAnalysis(
      { patternTags: ["stress-eater", "invented-tag"], suggestionTags: ["nonsense"] },
      summary(),
      checks()
    );

    expect(r.patternTags).toEqual(["stress-eater"]);
    expect(r.suggestionTags).toEqual([]);
  });
});

describe("buildPlannerContext — the analysis reaches the plan", () => {
  const analysed = {
    plannerBrief:
      "Keep breakfast to something assembled, not cooked. A 40-minute breakfast has not been made once in three weeks.",
    patterns: [
      {
        pattern: "Breakfast is planned every day and logged twice in three weeks",
        suggestedIntervention: "Two no-cook breakfasts to start, nothing over 10 minutes",
        impactOnGoal: "Missing breakfast makes the protein target hard to reach",
        confidence: 0.9,
      },
      {
        pattern: "A low-confidence hunch that should not reach the planner",
        suggestedIntervention: "Do something speculative",
        impactOnGoal: "",
        confidence: 0.2,
      },
    ],
    feelingFoodRelationship: [
      { observation: "On days reported as stressed, dinner lands after 9pm", confidence: 0.8 },
    ],
    narrative: {
      whatWorked: ["Lunch was logged nearly every weekday"],
      whatDidNotWork: ["Elaborate weekend cooking was never attempted"],
    },
    selfCheck: { eased: 2, resolved: 1, holds: 1 },
    behavior: { breakfastAdherence: 0.1 },
    context: {},
    planningDirectives: {
      maxPrepMinutes: 20, simplifySlots: ["breakfast"], flexibleSlots: [],
      weekendNeedsOwnShape: false, increaseVariety: false,
      reduceLateEating: false, emphasiseMacro: null, notes: [],
    },
    habitOpportunities: [],
    preferences: { favoriteMeals: ["chicken bowl"] },
  };

  it("leads with the analyst's brief — the planner sees no history of its own", () => {
    const context = buildPlannerContext(analysed)!;

    // Without this, everything the model understood stays in the database and
    // the plan is shaped only by thresholds.
    expect(context.startsWith(analysed.plannerBrief)).toBe(true);
  });

  it("carries each finding together with what to do about it", () => {
    const context = buildPlannerContext(analysed)!;

    expect(context).toContain("logged twice in three weeks");
    expect(context).toContain("Do this about it: Two no-cook breakfasts");
  });

  it("passes on how feelings moved the eating", () => {
    expect(buildPlannerContext(analysed)).toContain("dinner lands after 9pm");
  });

  it("tells the planner what worked and what not to repeat", () => {
    const context = buildPlannerContext(analysed)!;

    expect(context).toContain("Keep what is working: Lunch was logged");
    expect(context).toContain("do not repeat it: Elaborate weekend cooking");
    expect(context).toContain("3 of the things we changed last time are working");
  });

  it("withholds a finding the analyst was not confident about", () => {
    expect(buildPlannerContext(analysed)).not.toContain("speculative");
  });

  it("keeps reliable meals in the plan as the same dish, tuned rather than replaced", () => {
    const context = buildPlannerContext(analysed)!;

    expect(context).toContain("chicken bowl");
    expect(context).toContain("include them in the plan as the same dish");
    expect(context).not.toContain("rather than repeating them exactly");
  });

  it("still produces constraints when the analyst has not run", () => {
    // No brief, no patterns — the arithmetic alone must keep the plan adapting.
    const context = buildPlannerContext({
      behavior: { breakfastAdherence: 0.2 },
      context: {},
      planningDirectives: {
        maxPrepMinutes: 20, simplifySlots: ["breakfast"], flexibleSlots: [],
        weekendNeedsOwnShape: false, increaseVariety: false,
        reduceLateEating: false, emphasiseMacro: null, notes: [],
      },
      habitOpportunities: [],
      preferences: {},
    });

    expect(context).toContain("breakfast (20%)");
    expect(context).toContain("20 minutes");
  });

  it("turns the profile into instructions the planner can act on", () => {
    const context = buildPlannerContext({
      behavior: { dinnerAdherence: 0.5, breakfastAdherence: 0.9, weekendAdherence: 0.45 },
      context: { busyDays: [0], lowMotivationDays: [5], lateEatingRate: 0.5 },
      planningDirectives: {
        maxPrepMinutes: 25,
        simplifySlots: ["dinner"],
        flexibleSlots: [],
        weekendNeedsOwnShape: true,
        increaseVariety: true,
        reduceLateEating: true,
        emphasiseMacro: "protein",
        notes: [],
      },
      habitOpportunities: [{ area: "dinner", priority: "high", reason: "dinners are often skipped" }],
      preferences: { avoidMeals: ["tofu curry"] },
    });

    expect(context).toContain("dinner (50%)");
    expect(context).toContain("25 minutes");
    expect(context).toContain("Saturday and Sunday");
    expect(context).toContain("Sunday and Friday");
    expect(context).toContain("Protein");
    expect(context).toContain("tofu curry");
  });

  it("stays silent when there is nothing to say", () => {
    expect(
      buildPlannerContext({
        behavior: { dinnerAdherence: 0.95, breakfastAdherence: 0.95, weekendAdherence: 0.9 },
        context: { busyDays: [], lowMotivationDays: [], lateEatingRate: 0.1 },
        planningDirectives: {
          maxPrepMinutes: null,
          simplifySlots: [],
          flexibleSlots: [],
          weekendNeedsOwnShape: false,
          increaseVariety: false,
          reduceLateEating: false,
          emphasiseMacro: null,
          notes: [],
        },
        habitOpportunities: [],
        preferences: {},
      })
    ).toBeNull();
  });

  it("says nothing at all without a profile", () => {
    expect(buildPlannerContext(null)).toBeNull();
  });
});
