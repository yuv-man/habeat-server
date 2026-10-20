import { FOOD_A_LITTLE_BETTER_V2 as PROGRAM } from "../../../src/challenge-program/content/food-a-little-better.v2";
import { journeyAnswerLines, journeyCoachSection } from "../../../src/challenge-program/coach-context";
import { EnrollmentState, newEnrollmentState } from "../../../src/challenge-program/enrollment.rules";

const TODAY = "2026-10-19";

function stateOn(day: number, overrides: Partial<EnrollmentState> = {}): EnrollmentState {
  return { ...newEnrollmentState(PROGRAM, TODAY, new Date()), currentDay: day, ...overrides };
}

describe("journeyCoachSection", () => {
  it("tells the coach where the user is and what today's activity is", () => {
    const text = journeyCoachSection(PROGRAM, stateOn(8), TODAY);
    expect(text).toContain("Week 2 of 12, day 8");
    expect(text).toContain('stage 1 of 6 "Understand your routine"');
    expect(text).toContain('Today\'s activity: "Notice what shapes your food choices" (not started yet)');
    expect(text).toContain("Guidance for this day: Day 8.");
  });

  it("says when today's activity is done and what opens next", () => {
    const text = journeyCoachSection(PROGRAM, stateOn(9, { dayUnlockedOn: "2026-10-20" }), TODAY);
    expect(text).toContain('Today\'s activity is done. Next up (opens tomorrow): "Notice what makes busy days harder"');
    expect(text).not.toContain("Guidance for this day");
  });

  it("passes the user's own answers in words, and never their private notes", () => {
    const state = stateOn(13, {
      answers: {
        everydayMeals: ["Shakshuka", "Lentil soup"],
        trickyMoment: "busy_evenings",
        situation1: { situation: ["work"], ease: ["hard"], why: "No lunch packed" },
      },
      days: [{ day: 8, actionStatus: "done", note: "private: rough week at home" }],
    });
    const text = journeyCoachSection(PROGRAM, state, TODAY);
    expect(text).toContain('"Pick 3 meals you eat most weeks." → Shakshuka, Lentil soup');
    expect(text).toContain("→ Busy evenings");
    expect(text).toContain("Where were you, and what was going on? At work or school");
    expect(text).toContain("Did choosing feel easy or difficult? Difficult");
    expect(text).toContain("What made it that way? No lunch packed");
    expect(text).not.toContain("rough week");
  });

  it("keeps the coach honest and guilt-free", () => {
    const text = journeyCoachSection(PROGRAM, stateOn(3), TODAY);
    expect(text).toContain("Never invent earlier conversations or answers");
    expect(text).toContain("Never mention missed or skipped days");
    expect(text).toContain("never diagnose");
  });

  it("respects a pause and a finished journey", () => {
    expect(journeyCoachSection(PROGRAM, stateOn(5, { status: "paused" }), TODAY)).toContain("Don't push them to resume");
    expect(journeyCoachSection(PROGRAM, stateOn(84, { status: "completed" }), TODAY)).toContain("completed the journey");
  });

  it("skips empty answers and keeps the list short", () => {
    expect(journeyAnswerLines(PROGRAM, {})).toEqual([]);
    expect(journeyAnswerLines(PROGRAM, { busyDayBarrier: null })).toEqual([]);
  });
});
