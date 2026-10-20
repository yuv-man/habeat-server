import { HABIT_BADGES } from "../../../src/engagement/engagement.service";
import { allProgramVersions, getProgram, listPrograms } from "../../../src/challenge-program/program.registry";

/**
 * Structural checks on every shipped program version, plus the no-guilt tone
 * rules the content spec commits to (no calorie or weight talk, no "bad food").
 */
const BANNED = [
  /\bcalorie/i,
  /\bweight\b/i,
  /\blose\b/i,
  /\bdiet\b(?! style)/i,
  /\bbad food/i,
  /\bcheat/i,
  /\bguilty?\b(?! foods aren't)/i,
  /\byou failed/i,
  /\bbinge/i,
];

describe.each(allProgramVersions().map((p) => [`${p.id} v${p.version}`, p] as const))("%s", (_name, program) => {
  it("has exactly one entry per day, in order, with no gaps in what's written", () => {
    const written = program.days.length;
    expect(written).toBeLessThanOrEqual(program.durationDays);
    expect(program.days.map((d) => d.day)).toEqual(Array.from({ length: written }, (_, i) => i + 1));
  });

  it("covers every day of the program with exactly one stage", () => {
    const sorted = [...program.stages].sort((a, b) => a.days[0] - b.days[0]);
    expect(sorted[0].days[0]).toBe(1);
    sorted.forEach((s, i) => {
      if (i > 0) expect(s.days[0]).toBe(sorted[i - 1].days[1] + 1);
    });
    expect(sorted[sorted.length - 1].days[1]).toBe(program.durationDays);
  });

  it("puts every day in the stage that covers it", () => {
    for (const d of program.days) {
      const stage = program.stages.find((s) => s.id === d.stageId)!;
      expect(stage).toBeDefined();
      expect(d.day).toBeGreaterThanOrEqual(stage.days[0]);
      expect(d.day).toBeLessThanOrEqual(stage.days[1]);
    }
  });

  it("only reuses answers that an earlier day saves", () => {
    const savedBy = new Map<string, number>();
    for (const d of program.days) {
      for (const key of d.action.usesAnswer ?? []) {
        expect(savedBy.get(key)).toBeLessThan(d.day);
      }
      const text = JSON.stringify(d);
      for (const [, key] of text.matchAll(/\{\{\s*(\w+)/g)) {
        expect([key, savedBy.get(key) !== undefined || d.action.answerKey === key]).toEqual([key, true]);
      }
      if (d.action.answerKey) {
        expect(savedBy.has(d.action.answerKey)).toBe(false); // keys are unique
        savedBy.set(d.action.answerKey, d.day);
      }
    }
  });

  it("awards only badges that exist", () => {
    for (const m of program.milestones) {
      if (m.badgeId) expect(HABIT_BADGES[m.badgeId]).toBeDefined();
    }
  });

  it("keeps lessons, actions and tips free of guilt, weight and calorie language", () => {
    const copy = [
      ...program.days.flatMap((d) => [
        d.focus ?? "",
        d.lesson.title,
        d.lesson.body,
        d.action.prompt,
        d.next,
        d.communityPrompt ?? "",
        ...(d.action.fields ?? []).flatMap((f) => [f.prompt, ...f.options.map((o) => o.label)]),
        ...(d.action.options ?? []).map((o) => o.label),
      ]),
      ...program.guides.flatMap((g) => [g.title, g.body]),
    ];
    for (const text of copy) {
      for (const re of BANNED) expect([text, re.test(text)]).toEqual([text, false]);
    }
  });

  it("gives every chip question unique option ids", () => {
    for (const d of program.days) {
      for (const opts of [d.action.options, ...(d.action.fields ?? []).map((f) => f.options)]) {
        const ids = opts?.map((o) => o.id) ?? [];
        expect(new Set(ids).size).toBe(ids.length);
      }
      const keys = d.action.fields?.map((f) => f.key) ?? [];
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("registry", () => {
  it("lists the pilot and resolves pinned versions", () => {
    expect(listPrograms().map((p) => p.id)).toContain("food-a-little-better");
    expect(getProgram("food-a-little-better", 1)?.version).toBe(1);
    expect(getProgram("food-a-little-better")?.version).toBe(2);
    expect(getProgram("food-a-little-better")?.durationDays).toBe(84);
    expect(getProgram("food-a-little-better", 99)).toBeUndefined();
    expect(getProgram("nope")).toBeUndefined();
  });
});
