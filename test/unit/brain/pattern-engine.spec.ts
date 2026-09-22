import { PatternEngine, LATE_NIGHT_HOUR } from "../../../src/brain/patterns/pattern.engine";
import {
  BehaviorEventType,
  IBehaviorEvent,
} from "../../../src/brain/schemas/behavior-event.schema";

const engine = new PatternEngine();

/** 2026-09-07 is a Monday. */
const dayKey = (offset: number) => {
  const d = new Date(2026, 8, 7 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const event = (
  over: Partial<IBehaviorEvent> & { dayOffset?: number; hour?: number },
): IBehaviorEvent => {
  const { dayOffset = 0, hour = 12, ...rest } = over;
  const key = dayKey(dayOffset);
  const [y, m, d] = key.split("-").map(Number);
  return {
    userId: "u" as any,
    type: BehaviorEventType.MEAL_LOGGED,
    timestamp: new Date(y, m - 1, d, hour, 0, 0),
    timestampIsExact: true,
    dateKey: key,
    source: "test",
    fingerprint: `${key}-${hour}-${Math.random()}`,
    ...rest,
  } as IBehaviorEvent;
};

const window = (days = 30, observedDays = 14) => ({ days, observedDays });

describe("PatternEngine", () => {
  it("says nothing at all when there are no events", () => {
    expect(engine.analyze([], window())).toEqual([]);
  });

  describe("P01 · irregular meals", () => {
    it("stays silent below the pattern's minimum window", () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        event({ dayOffset: i % 6 }),
      );
      const found = engine.analyze(events, window(5, 5));
      expect(found.find((p) => p.patternId === "P01")).toBeUndefined();
    });

    it("fires when most tracked days fall short of a full set of meals", () => {
      // 7 days, one meal each — every day is short.
      const events = Array.from({ length: 7 }, (_, i) => event({ dayOffset: i }));
      const p01 = engine.analyze(events, window())!.find((p) => p.patternId === "P01");

      expect(p01).toBeDefined();
      expect(p01!.score).toBeGreaterThan(0.35);
      expect(p01!.evidence[0].description).toMatch(/7 of 7 tracked days/);
    });

    it("does not fire for someone eating three meals a day", () => {
      const events = Array.from({ length: 7 }).flatMap((_, day) =>
        [8, 13, 19].map((hour) => event({ dayOffset: day, hour })),
      );
      const found = engine.analyze(events, window());
      expect(found.find((p) => p.patternId === "P01")).toBeUndefined();
    });

    it("groups by the user's local date key, not a UTC slice", () => {
      // A 23:00 meal is the same local day as an 08:00 one. Slicing the ISO
      // string would push it to tomorrow for anyone behind UTC and split one
      // full day into two short ones.
      const events = Array.from({ length: 7 }).flatMap((_, day) =>
        [8, 13, 23].map((hour) => event({ dayOffset: day, hour })),
      );
      const found = engine.analyze(events, window());
      expect(found.find((p) => p.patternId === "P01")).toBeUndefined();
    });
  });

  describe("P02 · all-or-nothing days", () => {
    /** A day's three main slots, as logged / skipped / not planned. */
    const day = (
      offset: number,
      slots: Partial<Record<"breakfast" | "lunch" | "dinner", "logged" | "skipped">>,
    ): IBehaviorEvent[] =>
      Object.entries(slots).map(([slot, status]) =>
        event({
          dayOffset: offset,
          mealType: slot,
          type:
            status === "logged"
              ? BehaviorEventType.MEAL_LOGGED
              : BehaviorEventType.MEAL_SKIPPED,
        }),
      );

    const collapsedDay = (i: number) =>
      day(i, { breakfast: "skipped", lunch: "skipped", dinner: "skipped" });

    const recoveredDay = (i: number) =>
      day(i, { breakfast: "skipped", lunch: "logged", dinner: "logged" });

    it("fires when a missed meal usually takes the rest of the day", () => {
      const events = [0, 1, 2, 3].flatMap(collapsedDay);
      const p02 = engine.analyze(events, window()).find((p) => p.patternId === "P02");

      expect(p02).toBeDefined();
      expect(p02!.evidence[0].description).toMatch(
        /On 4 of 4 days where a meal was missed/,
      );
    });

    it("stays quiet when the day carries on after a miss", () => {
      // Missing breakfast and eating normally afterwards is a bad morning,
      // not an all-or-nothing day. P01 is the pattern for the missing itself.
      const events = [0, 1, 2, 3, 4].flatMap(recoveredDay);
      expect(
        engine.analyze(events, window()).find((p) => p.patternId === "P02"),
      ).toBeUndefined();
    });

    it("ignores days that gave no chance to recover", () => {
      // A skipped dinner has nothing after it. Counting it would let the
      // detector claim a tendency it never observed.
      const events = [0, 1, 2, 3, 4].flatMap((i) =>
        day(i, { breakfast: "logged", lunch: "logged", dinner: "skipped" }),
      );
      expect(
        engine.analyze(events, window()).find((p) => p.patternId === "P02"),
      ).toBeUndefined();
    });

    it("does not count unplanned slots as meals the user failed to eat", () => {
      // Breakfast skipped, no lunch on the plan at all, dinner eaten.
      const events = [0, 1, 2, 3, 4].flatMap((i) =>
        day(i, { breakfast: "skipped", dinner: "logged" }),
      );
      expect(
        engine.analyze(events, window()).find((p) => p.patternId === "P02"),
      ).toBeUndefined();
    });

    it("needs more than one written-off day before it will claim anything", () => {
      // One collapse among several recoveries is a bad day, not a pattern.
      const events = [
        ...collapsedDay(0),
        ...recoveredDay(1),
        ...recoveredDay(2),
        ...recoveredDay(3),
      ];
      expect(
        engine.analyze(events, window()).find((p) => p.patternId === "P02"),
      ).toBeUndefined();
    });

    it("reports the days that went fine alongside the ones that did not", () => {
      const events = [
        ...collapsedDay(0),
        ...collapsedDay(1),
        ...collapsedDay(2),
        ...recoveredDay(3),
      ];
      const p02 = engine.analyze(events, window()).find((p) => p.patternId === "P02");

      expect(p02).toBeDefined();
      expect(p02!.score).toBeCloseTo(3 / 4);
      expect(p02!.evidence[1].description).toMatch(
        /1 of those days carried on as normal/,
      );
    });

    it("lets a logged meal outrank a stale skip record for the same slot", () => {
      const events = [0, 1, 2].flatMap((i) => [
        ...day(i, { breakfast: "skipped", lunch: "skipped", dinner: "skipped" }),
        // The user came back and ticked lunch off after all.
        event({
          dayOffset: i,
          mealType: "lunch",
          type: BehaviorEventType.MEAL_LOGGED,
        }),
      ]);

      expect(
        engine.analyze(events, window()).find((p) => p.patternId === "P02"),
      ).toBeUndefined();
    });

    it("stays silent below the pattern's minimum window", () => {
      const events = [0, 1, 2, 3].flatMap(collapsedDay);
      expect(
        engine.analyze(events, window(5, 4)).find((p) => p.patternId === "P02"),
      ).toBeUndefined();
    });

    it("separates a collapsing day from simply eating little", () => {
      // Three one-meal days trip P01 but say nothing about recovery, because
      // nothing was planned and missed.
      const events = [0, 1, 2, 3, 4, 5, 6].flatMap((i) =>
        day(i, { lunch: "logged" }),
      );
      const found = engine.analyze(events, window());

      expect(found.find((p) => p.patternId === "P01")).toBeDefined();
      expect(found.find((p) => p.patternId === "P02")).toBeUndefined();
    });
  });

  describe("P04 · late-night eating", () => {
    it("ignores meals whose time was never actually recorded", () => {
      // Inexact timestamps are slot defaults the projector invented. Counting
      // them would let the detector "observe" its own placeholder.
      const events = Array.from({ length: 10 }, (_, i) =>
        event({
          dayOffset: i % 7,
          hour: LATE_NIGHT_HOUR + 1,
          timestampIsExact: false,
        }),
      );
      const found = engine.analyze(events, window());
      expect(found.find((p) => p.patternId === "P04")).toBeUndefined();
    });

    it("fires when timed meals cluster after 21:00", () => {
      const late = Array.from({ length: 6 }, (_, i) =>
        event({ dayOffset: i, hour: 22 }),
      );
      const early = Array.from({ length: 4 }, (_, i) =>
        event({ dayOffset: i, hour: 13 }),
      );
      const p04 = engine
        .analyze([...late, ...early], window())
        .find((p) => p.patternId === "P04");

      expect(p04).toBeDefined();
      expect(p04!.evidence[0].description).toMatch(/6 meals or snacks/);
      expect(p04!.evidence[0].description).toMatch(/6 nights/);
    });

    it("sees late nights in someone who logs every meal", () => {
      // Chloe: 14 days, breakfast, lunch, dinner and a snack most days, dinner
      // after 21:00 on four stressful evenings. As a share of all her meals that
      // was 8/46 and never fired; as a share of nights it is 4/14.
      const days = Array.from({ length: 14 }, (_, d) => d);
      const lateNights = new Set([1, 3, 8, 10]);
      const events = days.flatMap((d) => [
        event({ dayOffset: d, hour: 8 }),
        event({ dayOffset: d, hour: 13 }),
        event({ dayOffset: d, hour: lateNights.has(d) ? 22 : 19 }),
        event({ dayOffset: d, hour: lateNights.has(d) ? 22 : 16, type: BehaviorEventType.SNACK_LOGGED }),
      ]);
      const p04 = engine.analyze(events, window(30, 14)).find((p) => p.patternId === "P04");

      expect(p04).toBeDefined();
      expect(p04!.evidence[1].description).toMatch(/4 of 14 days/);
    });

    it("stays quiet on the odd late dinner", () => {
      const events = Array.from({ length: 14 }, (_, d) => [
        event({ dayOffset: d, hour: 13 }),
        event({ dayOffset: d, hour: d === 5 || d === 12 || d === 13 ? 22 : 19 }),
      ]).flat();
      // 3 late nights in 14 (a bit over one a week) is below the line.
      expect(engine.analyze(events, window(30, 14)).find((p) => p.patternId === "P04")).toBeUndefined();
    });

    it("needs more than a couple of late meals before it will claim anything", () => {
      const events = [
        event({ dayOffset: 0, hour: 22 }),
        event({ dayOffset: 1, hour: 22 }),
        ...Array.from({ length: 5 }, (_, i) => event({ dayOffset: i, hour: 13 })),
      ];
      const found = engine.analyze(events, window());
      expect(found.find((p) => p.patternId === "P04")).toBeUndefined();
    });
  });

  describe("minimum data", () => {
    it("judges the minimum on days observed, not on the window's length", () => {
      // Three days of heavy late eating inside a 30-day window: plenty of
      // events, far too little life to call it a habit.
      const events = [0, 1, 2].flatMap((d) => [event({ dayOffset: d, hour: 22 }), event({ dayOffset: d, hour: 23 })]);
      expect(engine.analyze(events, window(30, 3)).find((p) => p.patternId === "P04")).toBeUndefined();
    });
  });

  describe("P08 · frequent takeaway", () => {
    it("measures the rate over the days actually observed", () => {
      // 6 takeaways in the 14 days someone has used the app is 3 a week, not
      // 1.4 a week spread over a 30-day window they mostly weren't here for.
      const events = Array.from({ length: 6 }, (_, i) =>
        event({ dayOffset: i * 2, type: BehaviorEventType.TAKEAWAY_LOGGED }),
      );
      const p08 = engine.analyze(events, window(30, 14)).find((p) => p.patternId === "P08");
      expect(p08).toBeDefined();
    });

    it("fires on repeated takeaway across the window", () => {
      const events = Array.from({ length: 8 }, (_, i) =>
        event({ dayOffset: i, type: BehaviorEventType.TAKEAWAY_LOGGED }),
      );
      const p08 = engine
        .analyze(events, window(14, 8))
        .find((p) => p.patternId === "P08");

      expect(p08).toBeDefined();
      expect(p08!.evidence[1].description).toMatch(/per week/);
    });

    it("stays quiet when takeaway is occasional", () => {
      const events = [
        ...Array.from({ length: 3 }, (_, i) =>
          event({ dayOffset: i, type: BehaviorEventType.TAKEAWAY_LOGGED }),
        ),
        ...Array.from({ length: 20 }, (_, i) => event({ dayOffset: i % 20 })),
      ];
      const found = engine.analyze(events, window(30, 20));
      expect(found.find((p) => p.patternId === "P08")).toBeUndefined();
    });
  });

  it("returns every score between 0 and 1 with evidence attached", () => {
    const events = [
      ...Array.from({ length: 6 }, (_, i) => event({ dayOffset: i, hour: 22 })),
      ...Array.from({ length: 8 }, (_, i) =>
        event({ dayOffset: i, type: BehaviorEventType.TAKEAWAY_LOGGED }),
      ),
    ];
    for (const pattern of engine.analyze(events, window(14, 8))) {
      expect(pattern.score).toBeGreaterThanOrEqual(0);
      expect(pattern.score).toBeLessThanOrEqual(1);
      expect(pattern.confidence).toBeGreaterThanOrEqual(0);
      expect(pattern.confidence).toBeLessThanOrEqual(1);
      expect(pattern.evidence.length).toBeGreaterThan(0);
    }
  });
});
