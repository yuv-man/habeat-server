import { DecisionEngine } from "../../../src/brain/decision/decision.engine";
import { StageEngine } from "../../../src/brain/behavior/stage.engine";
import { BehaviorStage } from "../../../src/brain/behavior/behavior.types";
import { PatternStatus } from "../../../src/brain/schemas/behavior-pattern.schema";
import { BrainPatternView } from "../../../src/brain/decision/brain-state.types";

const engine = new DecisionEngine(new StageEngine());

const pattern = (over: Partial<BrainPatternView>): BrainPatternView => ({
  patternId: "P04",
  name: "Late-night eating",
  category: "timing",
  score: 0.7,
  confidence: 0.8,
  status: PatternStatus.CONFIRMED,
  evidence: [{ description: "5 meals after 21:00.", value: 5 }],
  ...over,
});

const base = {
  userId: "u1",
  windowDays: 30,
  observedDays: 21,
  events: 90,
  mealsLogged: 60,
};

describe("DecisionEngine", () => {
  it("commits to one pattern rather than handing over a list", () => {
    const state = engine.decide({
      ...base,
      patterns: [
        pattern({ patternId: "P04", score: 0.9, confidence: 0.9 }),
        pattern({ patternId: "P01", name: "Irregular meals", score: 0.6 }),
        pattern({ patternId: "P08", name: "Frequent takeaway", score: 0.5 }),
      ],
    });

    expect(state.decision.patternId).toBe("P04");
    expect(state.patterns).toHaveLength(3);
  });

  it("ranks by score weighted by confidence, not score alone", () => {
    // A stronger reading on thinner data must not outrank a solid one.
    const state = engine.decide({
      ...base,
      patterns: [
        pattern({ patternId: "P01", name: "Irregular", score: 0.9, confidence: 0.3 }),
        pattern({ patternId: "P04", score: 0.7, confidence: 0.9 }),
      ],
    });

    expect(state.decision.patternId).toBe("P04");
  });

  it("starts a newly chosen pattern at awareness, never mid-ladder", () => {
    const state = engine.decide({ ...base, patterns: [pattern({})] });

    expect(state.decision.stage).toBe(BehaviorStage.AWARENESS);
    expect(state.decision.interventionId).toBe("I04");
    expect(state.decision.mealStrategy).toMatch(/Do not aggressively restrict/);
  });

  it("keeps working on the current pattern even when another edges ahead", () => {
    // Switching target every week is how a plan stops feeling like it is
    // about the person using it.
    const state = engine.decide({
      ...base,
      patterns: [
        pattern({ patternId: "P01", name: "Irregular", score: 0.95, confidence: 0.95 }),
        pattern({ patternId: "P04", score: 0.6, confidence: 0.7 }),
      ],
      currentPatternId: "P04",
      currentStage: BehaviorStage.PREPARATION,
      successRate: 0.5,
    });

    expect(state.decision.patternId).toBe("P04");
  });

  it("does not act on a pattern seen only once", () => {
    // One sighting is as likely a bad week as a habit. This used to commit to
    // it anyway, because only RESOLVED was filtered out.
    const state = engine.decide({
      ...base,
      patterns: [pattern({ patternId: "P04", status: PatternStatus.DISCOVERED })],
    });

    expect(state.decision.patternId).toBeNull();
    expect(state.decision.rationale).toMatch(/Watching P04 \(Late-night eating\) — seen once/);
  });

  it("acts on the confirmed pattern even when a stronger one is only discovered", () => {
    const state = engine.decide({
      ...base,
      patterns: [
        pattern({ patternId: "P08", name: "Frequent takeaway", score: 0.95, status: PatternStatus.DISCOVERED }),
        pattern({ patternId: "P04", score: 0.5, status: PatternStatus.CONFIRMED }),
      ],
    });

    expect(state.decision.patternId).toBe("P04");
  });

  it("abandons a pattern once it has resolved", () => {
    const state = engine.decide({
      ...base,
      patterns: [
        pattern({ patternId: "P04", status: PatternStatus.RESOLVED }),
        pattern({ patternId: "P01", name: "Irregular", score: 0.6 }),
      ],
      currentPatternId: "P04",
      currentStage: BehaviorStage.REPLACEMENT,
    });

    expect(state.decision.patternId).toBe("P01");
  });

  it("holds the stage when there is no success rate to judge", () => {
    const state = engine.decide({
      ...base,
      patterns: [pattern({})],
      currentPatternId: "P04",
      currentStage: BehaviorStage.PREPARATION,
      successRate: null,
    });

    expect(state.decision.stage).toBe(BehaviorStage.PREPARATION);
    expect(state.decision.rationale).toMatch(/No completed success metric/);
  });

  it("advances the stage on a good week", () => {
    const state = engine.decide({
      ...base,
      patterns: [pattern({})],
      currentPatternId: "P04",
      currentStage: BehaviorStage.PREPARATION,
      successRate: 0.85,
      userFeedback: 0.8,
    });

    expect(state.decision.stage).toBe(BehaviorStage.REPLACEMENT);
    expect(state.decision.interventionId).toBe("I06");
  });

  it("can commit to all-or-nothing days and picks its awareness intervention", () => {
    const state = engine.decide({
      ...base,
      patterns: [
        pattern({
          patternId: "P02",
          name: "All-or-nothing days",
          category: "planning",
          score: 0.8,
          confidence: 0.8,
        }),
      ],
    });

    expect(state.decision.patternId).toBe("P02");
    expect(state.decision.interventionId).toBe("I10");
    // Awareness for this pattern explicitly means "change nothing yet" — the
    // response to a written-off day is not a stricter plan.
    expect(state.decision.mealStrategy).toMatch(/unchanged and familiar/);
    expect(state.decision.whatWeAreDoing).toMatch(/Nothing in your plan changes yet/);
  });

  it("carries user-facing wording for whatever it commits to", () => {
    const state = engine.decide({ ...base, patterns: [pattern({})] });

    expect(state.decision.whatWeAreDoing).toBeTruthy();
    expect(state.decision.goingWellIf).toBeTruthy();
    expect(state.decision.stageIndex).toBe(1);
    expect(state.decision.stageCount).toBe(5);
  });

  it("makes no claim when nothing was detected", () => {
    const state = engine.decide({ ...base, patterns: [] });

    expect(state.decision.patternId).toBeNull();
    expect(state.decision.mealStrategy).toBeNull();
    expect(state.decision.rationale).toMatch(/nothing to claim/i);
  });

  it("grades a thin window as insufficient however strong the reading", () => {
    const state = engine.decide({
      ...base,
      observedDays: 3,
      patterns: [pattern({ score: 1, confidence: 1 })],
    });

    expect(state.confidence).toBe("insufficient");
  });

  it("carries a rationale for every decision it makes", () => {
    const state = engine.decide({ ...base, patterns: [pattern({})] });
    expect(state.decision.rationale.length).toBeGreaterThan(20);
  });

  describe("reconciling the analyst against the staged decision", () => {
    const analysis = {
      plannerBrief: "They skip breakfast on weekdays.",
      directives: {
        maxPrepMinutes: 25,
        simplifySlots: ["breakfast"],
        flexibleSlots: [],
        weekendNeedsOwnShape: false,
        increaseVariety: false,
        reduceLateEating: true,
        emphasiseMacro: null,
        notes: [] as string[],
      },
    };

    it("overrides the analyst when it contradicts an early-stage intervention", () => {
      // The analyst says restrict evening food; the Brain has the user at
      // awareness for that very pattern, where restriction is the wrong move.
      // Two systems, one answer — this is the arbitration.
      const state = engine.decide({
        ...base,
        patterns: [pattern({ patternId: "P04" })],
        analysis,
      });

      expect(state.decision.stage).toBe(BehaviorStage.AWARENESS);
      expect(state.analysis.directives!.reduceLateEating).toBe(false);
      expect(state.analysis.directives!.notes.join(" ")).toMatch(
        /rather than restricting/,
      );
    });

    it("lets the directive stand once the user reaches replacement", () => {
      const state = engine.decide({
        ...base,
        patterns: [pattern({ patternId: "P04" })],
        currentPatternId: "P04",
        currentStage: BehaviorStage.REPLACEMENT,
        successRate: 0.5,
        analysis,
      });

      expect(state.analysis.directives!.reduceLateEating).toBe(true);
    });

    it("leaves directives alone when they concern a different pattern", () => {
      const state = engine.decide({
        ...base,
        patterns: [pattern({ patternId: "P01", name: "Irregular meals" })],
        analysis,
      });

      expect(state.analysis.directives!.reduceLateEating).toBe(true);
    });

    it("passes the analyst's brief through untouched", () => {
      const state = engine.decide({ ...base, patterns: [pattern({})], analysis });
      expect(state.analysis.plannerBrief).toBe("They skip breakfast on weekdays.");
    });
  });
});
