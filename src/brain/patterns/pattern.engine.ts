import { Injectable } from "@nestjs/common";
import {
  BehaviorEventType,
  IBehaviorEvent,
} from "../schemas/behavior-event.schema";
import { PatternScore, PatternWindow } from "./pattern.types";
import { patternById } from "./pattern.definitions";

/** Meals or snacks at or after this hour count as late-night eating. */
export const LATE_NIGHT_HOUR = 21;

/** A day with fewer than this many meals is an irregular day. */
export const FULL_DAY_MEALS = 3;

/** Nothing is reported below this strength — weak signal read as a finding is
 *  how a brain starts telling users things about themselves that aren't true. */
export const REPORT_THRESHOLD = 0.35;

/**
 * The part of the Brain that decides what is actually going on.
 *
 * Every detector here is deterministic and pure: same events in, same patterns
 * out, no model call. That is deliberate. A detection is a claim about the
 * user's life, so it has to be reproducible, testable, and explainable from
 * the evidence it carries — an LLM reasons *over* these findings later, but it
 * does not get to invent them.
 *
 * Three rules every detector keeps:
 *  1. Below the pattern's `minimumDataDays`, return null. Not zero — null.
 *  2. Time-of-day claims use only events with an exact timestamp.
 *  3. Evidence is a sentence a user could check against their own memory.
 */
@Injectable()
export class PatternEngine {
  analyze(events: IBehaviorEvent[], window: PatternWindow): PatternScore[] {
    if (events.length === 0) return [];

    return [
      this.detectIrregularMeals(events, window),
      this.detectAllOrNothingDays(events, window),
      this.detectLateNightEating(events, window),
      this.detectFrequentTakeaway(events, window),
    ].filter((p): p is PatternScore => p !== null);
  }

  /** P01 — days that repeatedly fall short of a full set of meals. */
  private detectIrregularMeals(
    events: IBehaviorEvent[],
    window: PatternWindow,
  ): PatternScore | null {
    if (!this.hasEnoughDays("P01", window)) return null;

    const meals = events.filter(
      (e) =>
        e.type === BehaviorEventType.MEAL_LOGGED ||
        e.type === BehaviorEventType.PLAN_MEAL_COMPLETED,
    );
    if (meals.length === 0) return null;

    // Grouped on the user's own local date key rather than a UTC slice of the
    // timestamp: near midnight those differ, and the difference silently moves
    // a meal into the wrong day.
    const mealsByDay = new Map<string, number>();
    for (const meal of meals) {
      if (!meal.dateKey) continue;
      mealsByDay.set(meal.dateKey, (mealsByDay.get(meal.dateKey) ?? 0) + 1);
    }

    const observedDays = mealsByDay.size;
    if (observedDays < 5) return null;

    const daysWithFewMeals = [...mealsByDay.values()].filter(
      (count) => count < FULL_DAY_MEALS,
    ).length;

    const frequency = daysWithFewMeals / observedDays;
    const score = Math.min(1, frequency * 1.2);
    if (score < REPORT_THRESHOLD) return null;

    return {
      patternId: "P01",
      score,
      confidence: Math.min(1, observedDays / 7),
      evidence: [
        {
          description: `${daysWithFewMeals} of ${observedDays} tracked days had fewer than ${FULL_DAY_MEALS} meals.`,
          value: frequency,
        },
      ],
    };
  }


  /**
   * P02 — a missed meal takes the rest of the day with it.
   *
   * The behaviour this looks for is not "meals get missed" (that is P01) but
   * what happens *after* one. Someone who misses breakfast and eats a normal
   * lunch has had a bad morning; someone whose lunch and dinner also stop has
   * written the day off, and those two need opposite responses — the second
   * wants the next meal made easier, not the day made stricter.
   *
   * Only days that gave the user a chance to recover are counted. A skipped
   * dinner has nothing after it, so it is evidence of nothing here.
   */
  private detectAllOrNothingDays(
    events: IBehaviorEvent[],
    window: PatternWindow,
  ): PatternScore | null {
    if (!this.hasEnoughDays("P02", window)) return null;

    // Only the three main slots, in the order they happen. Snacks have no
    // fixed place in a day and cannot say whether it recovered.
    const ORDER = ["breakfast", "lunch", "dinner"] as const;
    type Status = "logged" | "skipped";

    const byDay = new Map<string, Map<string, Status>>();

    const mark = (event: IBehaviorEvent, status: Status) => {
      if (!event.dateKey || !event.mealType) return;
      if (!ORDER.includes(event.mealType as (typeof ORDER)[number])) return;

      const day = byDay.get(event.dateKey) ?? new Map<string, Status>();
      // A slot logged anywhere in the day beats a skip record for it.
      if (!(status === "skipped" && day.get(event.mealType) === "logged")) {
        day.set(event.mealType, status);
      }
      byDay.set(event.dateKey, day);
    };

    for (const event of events) {
      if (
        event.type === BehaviorEventType.MEAL_LOGGED ||
        event.type === BehaviorEventType.PLAN_MEAL_COMPLETED
      ) {
        mark(event, "logged");
      } else if (event.type === BehaviorEventType.MEAL_SKIPPED) {
        mark(event, "skipped");
      }
    }

    let slipDays = 0;
    let collapsedDays = 0;

    for (const day of byDay.values()) {
      const statuses = ORDER.map((slot) => day.get(slot));
      const firstMiss = statuses.findIndex((s) => s === "skipped");
      if (firstMiss === -1) continue;

      // Slots after the first miss that were actually planned. An unplanned
      // slot is not a meal the user failed to eat.
      const later = statuses.slice(firstMiss + 1).filter(Boolean) as Status[];
      if (later.length === 0) continue;

      slipDays++;
      if (later.every((s) => s === "skipped")) collapsedDays++;
    }

    // Three slip days with a chance to recover, and at least two that did not:
    // one written-off day is a bad day, not a way of responding to them.
    if (slipDays < 3 || collapsedDays < 2) return null;

    // No multiplier here, unlike P01 and P04. The share of slip days that
    // collapse is already the thing being claimed, and scaling it would
    // report a tendency the user does not have.
    const score = collapsedDays / slipDays;
    if (score < REPORT_THRESHOLD) return null;

    return {
      patternId: "P02",
      score,
      confidence: Math.min(1, slipDays / 5),
      evidence: [
        {
          description: `On ${collapsedDays} of ${slipDays} days where a meal was missed, the rest of the day was missed too.`,
          value: score,
        },
        {
          description: `${slipDays - collapsedDays} of those days carried on as normal after the missed meal.`,
          value: slipDays - collapsedDays,
        },
      ],
    };
  }

  /** P04 — eating that clusters after 21:00. */
  private detectLateNightEating(
    events: IBehaviorEvent[],
    window: PatternWindow,
  ): PatternScore | null {
    if (!this.hasEnoughDays("P04", window)) return null;

    // This claim is entirely about the clock, so a meal placed at its slot's
    // typical hour cannot support it. Using inexact events here would let the
    // detector "observe" a 19:00 default it invented itself.
    const meals = events.filter(
      (e) =>
        (e.type === BehaviorEventType.MEAL_LOGGED ||
          e.type === BehaviorEventType.SNACK_LOGGED ||
          e.type === BehaviorEventType.PLAN_MEAL_COMPLETED) &&
        e.timestampIsExact,
    );
    if (meals.length === 0) return null;

    const lateMeals = meals.filter(
      (e) => e.timestamp.getHours() >= LATE_NIGHT_HOUR,
    );
    if (lateMeals.length < 3) return null;

    const frequency = lateMeals.length / meals.length;
    const score = Math.min(1, frequency * 1.5);
    if (score < REPORT_THRESHOLD) return null;

    const lateNights = new Set(lateMeals.map((e) => e.dateKey)).size;

    return {
      patternId: "P04",
      score,
      // Confidence rests on how many late meals were seen, capped so a single
      // heavy week cannot present itself as certainty.
      confidence: Math.min(1, lateMeals.length / 5),
      evidence: [
        {
          description: `${lateMeals.length} meals or snacks were logged after ${LATE_NIGHT_HOUR}:00, across ${lateNights} night${lateNights === 1 ? "" : "s"}.`,
          value: lateMeals.length,
        },
        {
          description: `Late-night eating represented ${Math.round(frequency * 100)}% of meals with a recorded time.`,
          value: frequency,
        },
      ],
    };
  }

  /** P08 — reliance on takeaway rather than planned cooking. */
  private detectFrequentTakeaway(
    events: IBehaviorEvent[],
    window: PatternWindow,
  ): PatternScore | null {
    if (!this.hasEnoughDays("P08", window)) return null;

    const takeaway = events.filter(
      (e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED,
    );
    if (takeaway.length < 3) return null;

    const weeks = Math.max(window.days / 7, 1);
    const weeklyFrequency = takeaway.length / weeks;

    // Seven takeaways a week is the ceiling: at that point it is not a pattern
    // within the user's eating, it *is* their eating.
    const score = Math.min(1, weeklyFrequency / 7);
    if (score < REPORT_THRESHOLD) return null;

    return {
      patternId: "P08",
      score,
      confidence: Math.min(1, takeaway.length / 5),
      evidence: [
        {
          description: `${takeaway.length} takeaway or eaten-out meals were logged during the analysis period.`,
          value: takeaway.length,
        },
        {
          description: `Estimated ${weeklyFrequency.toFixed(1)} takeaway meals per week.`,
          value: weeklyFrequency,
        },
      ],
    };
  }

  /** A detector may not speak before its pattern's minimum window is met. */
  private hasEnoughDays(patternId: string, window: PatternWindow): boolean {
    const definition = patternById(patternId);
    if (!definition) return false;
    return window.days >= definition.minimumDataDays;
  }
}
