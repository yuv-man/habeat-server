import { StageEngine } from "../../../src/brain/behavior/stage.engine";
import { BehaviorStage } from "../../../src/brain/behavior/behavior.types";
import {
  interventionFor,
  INTERVENTIONS,
} from "../../../src/brain/behavior/intervention.definitions";
import { PATTERN_DEFINITIONS } from "../../../src/brain/patterns/pattern.definitions";

const engine = new StageEngine();

describe("StageEngine", () => {
  it("advances when the intervention is working and the user agrees", () => {
    expect(
      engine.decide({
        currentStage: BehaviorStage.AWARENESS,
        successRate: 0.8,
        difficulty: 0.1,
        userFeedback: 0.7,
      }),
    ).toBe(BehaviorStage.PREPARATION);
  });

  it("does not advance on results alone when the user is not on board", () => {
    // Hitting the metric while hating the plan is not progress worth
    // compounding — the next stage asks more, and it will break.
    expect(
      engine.decide({
        currentStage: BehaviorStage.AWARENESS,
        successRate: 0.9,
        difficulty: 0.1,
        userFeedback: 0.2,
      }),
    ).toBe(BehaviorStage.AWARENESS);
  });

  it("steps back when a hard intervention is failing", () => {
    expect(
      engine.decide({
        currentStage: BehaviorStage.REPLACEMENT,
        successRate: 0.2,
        difficulty: 0.6,
      }),
    ).toBe(BehaviorStage.PREPARATION);
  });

  it("holds rather than retreating when an easy intervention is failing", () => {
    // Nothing is gained by demoting someone below awareness; the intervention
    // is the thing to change, not the stage.
    expect(
      engine.decide({
        currentStage: BehaviorStage.PREPARATION,
        successRate: 0.2,
        difficulty: 0.3,
      }),
    ).toBe(BehaviorStage.PREPARATION);
  });

  it("holds on moderate success — the default answer", () => {
    expect(
      engine.decide({
        currentStage: BehaviorStage.PREPARATION,
        successRate: 0.5,
        difficulty: 0.3,
        userFeedback: 0.5,
      }),
    ).toBe(BehaviorStage.PREPARATION);
  });

  it("cannot climb past maintenance or fall below awareness", () => {
    expect(
      engine.decide({
        currentStage: BehaviorStage.MAINTENANCE,
        successRate: 1,
        difficulty: 0.1,
        userFeedback: 1,
      }),
    ).toBe(BehaviorStage.MAINTENANCE);

    expect(
      engine.decide({
        currentStage: BehaviorStage.AWARENESS,
        successRate: 0,
        difficulty: 0.9,
      }),
    ).toBe(BehaviorStage.AWARENESS);
  });
});

describe("intervention catalogue", () => {
  it("gives every pattern an intervention at every stage on the ladder", () => {
    // A user who reaches reinforcement must not find the Brain has nothing to
    // say — that is exactly when a change unravels.
    for (const pattern of PATTERN_DEFINITIONS) {
      for (const stage of pattern.stages) {
        expect(interventionFor(pattern.id, stage)).not.toBeNull();
      }
    }
  });

  it("only references patterns that exist", () => {
    const ids = new Set(PATTERN_DEFINITIONS.map((p) => p.id));
    for (const intervention of INTERVENTIONS) {
      expect(ids.has(intervention.patternId)).toBe(true);
    }
  });

  it("gives every intervention a meal strategy the generator can act on", () => {
    for (const intervention of INTERVENTIONS) {
      expect(intervention.mealStrategy.length).toBeGreaterThan(10);
      expect(intervention.successMetric.length).toBeGreaterThan(5);
    }
  });

  it("gives every intervention wording a person can read", () => {
    // The planner phrasing is written at a model. Shipping it to a screen
    // reads like being handed someone else's memo, so both must exist.
    for (const intervention of INTERVENTIONS) {
      expect(intervention.userFacing.whatWeAreDoing.length).toBeGreaterThan(20);
      expect(intervention.userFacing.goingWellIf.length).toBeGreaterThan(10);
    }
  });

  it("does not leak planner phrasing into the user-facing copy", () => {
    for (const intervention of INTERVENTIONS) {
      const said = `${intervention.userFacing.whatWeAreDoing} ${intervention.userFacing.goingWellIf}`;
      expect(said).not.toMatch(/prioriti[sz]e|generate|the user\b/i);
    }
  });

  it("lists the interventions each pattern definition claims", () => {
    for (const pattern of PATTERN_DEFINITIONS) {
      for (const id of pattern.interventions) {
        expect(INTERVENTIONS.find((i) => i.id === id)).toBeDefined();
      }
    }
  });
});
