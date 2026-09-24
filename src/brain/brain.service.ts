import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import mongoose, { Model } from "mongoose";

import {
  BehaviorEvent,
  BehaviorEventType,
  IBehaviorEvent,
} from "./schemas/behavior-event.schema";
import {
  BehaviorPattern,
  IBehaviorPatternDoc,
  PatternStatus,
} from "./schemas/behavior-pattern.schema";
import { BrainStateDoc, IBrainStateDoc } from "./schemas/brain-state.model";
import { PatternEngine } from "./patterns/pattern.engine";
import { patternById } from "./patterns/pattern.definitions";
import { interventionById } from "./behavior/intervention.definitions";
import { DecisionEngine } from "./decision/decision.engine";
import { BrainState, BrainPatternView } from "./decision/brain-state.types";
import { BehaviorStage, STAGE_LADDER } from "./behavior/behavior.types";
import { projectBehaviorEvents, observedDaysIn } from "./events/event.projector";
import { renderPlannerContext } from "./brain.prompt";
import {
  BrainFocus,
  PATTERN_EMOJI,
  PATTERN_TIPS,
  PatternProgress,
  STAGE_LABELS,
  TREND_LABELS,
} from "./brain.view";

import { DailyProgress } from "../progress/progress.model";
import { MoodEntry, MealMoodCorrelation } from "../cbt/cbt.model";
import { IDailyProgress } from "../types/interfaces";
import { IMoodEntry, IMealMoodCorrelation } from "../cbt/cbt.model";
import { BehaviorService } from "../behavior/behavior.service";
import { toLocalDateKey } from "../utils/eating-episodes";
import logger from "../utils/logger";

/** How far back an analysis run looks. */
export const BRAIN_WINDOW_DAYS = 30;

/** A state older than this is stale and gets refreshed in the background. */
export const STATE_REFRESH_HOURS = 20;

/** How long a resolved pattern is still shown as good news. */
export const PROGRESS_RESOLVED_DAYS = 30;

/** How many users one scheduled pass will analyse. */
export const BRAIN_BATCH_SIZE = 50;

/**
 * The Brain.
 *
 * This is the single decision-maker in Habeat. Everything that used to shape a
 * meal plan now arrives through here: the deterministic pattern work that
 * lives in this module, and the behaviour analyst in `src/behavior`, which is
 * now an *organ* of the Brain rather than a second opinion competing with it.
 * `BehaviorService` is injected here and called by nobody else on the planning
 * path — that is what makes this one brain rather than two.
 *
 * The loop, once per run:
 *
 *   real collections → projected events → patterns → status ladder
 *     → decision (which pattern, which stage, which intervention)
 *     → BrainState → planner context → meal generator → new data
 *
 * Analysis never happens on a request path. `buildPlannerContext` reads stored
 * state and refreshes in the background, so generating a plan is never blocked
 * on the Brain thinking.
 */
@Injectable()
export class BrainService {
  constructor(
    @InjectModel(BehaviorEvent.name)
    private readonly eventModel: Model<IBehaviorEvent>,
    @InjectModel(BehaviorPattern.name)
    private readonly patternModel: Model<IBehaviorPatternDoc>,
    @InjectModel(BrainStateDoc.name)
    private readonly stateModel: Model<IBrainStateDoc>,
    @InjectModel(DailyProgress.name)
    private readonly progressModel: Model<IDailyProgress>,
    @InjectModel(MoodEntry.name)
    private readonly moodModel: Model<IMoodEntry>,
    @InjectModel(MealMoodCorrelation.name)
    private readonly correlationModel: Model<IMealMoodCorrelation>,
    private readonly patternEngine: PatternEngine,
    private readonly decisionEngine: DecisionEngine,
    private readonly behaviorService: BehaviorService,
  ) {}

  // ── the analysis run ──────────────────────────────────────────────────────

  /**
   * Observe, detect, decide, store. The whole loop for one user.
   */
  async analyzeUser(
    userId: string,
    windowDays: number = BRAIN_WINDOW_DAYS,
  ): Promise<BrainState> {
    const objectId = new mongoose.Types.ObjectId(userId);
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceKey = toLocalDateKey(since);
    const todayKey = toLocalDateKey(new Date());

    const [progressDocs, moods, correlations] = await Promise.all([
      this.progressModel
        .find({ userId: objectId, dateKey: { $gte: sinceKey } })
        .sort({ dateKey: 1 })
        .lean(),
      this.moodModel
        .find({ userId: objectId, date: { $gte: sinceKey } })
        .sort({ date: 1 })
        .lean(),
      this.correlationModel
        .find({ userId: objectId, date: { $gte: sinceKey } })
        .sort({ date: 1 })
        .lean(),
    ]);

    const projected = projectBehaviorEvents({
      userId: objectId,
      progressDocs: progressDocs as any[],
      moods: moods as any[],
      correlations: correlations as any[],
      todayKey,
    });

    await this.persistEvents(objectId, projected);

    const events = projected.map((e) => ({ ...e, userId: objectId as any }));
    const observedDays = observedDaysIn(projected);

    const scores = this.patternEngine.analyze(events as IBehaviorEvent[], {
      days: windowDays,
      observedDays,
    });

    const patterns = await this.updatePatternLadder(objectId, scores);

    // The analyst's view, reconciled inside the decision engine rather than
    // appended to it.
    const analysis = await this.loadAnalysis(userId);

    const existing = await this.stateModel.findOne({ userId: objectId }).lean();
    const active = existing?.activeBehavior ?? null;

    const successRate = active
      ? await this.measureSuccess(objectId, active.patternId, active.stage)
      : null;

    const state = this.decisionEngine.decide({
      userId,
      patterns,
      windowDays,
      observedDays,
      events: projected.length,
      mealsLogged: projected.filter(
        (e) =>
          e.type === BehaviorEventType.MEAL_LOGGED ||
          e.type === BehaviorEventType.SNACK_LOGGED,
      ).length,
      currentStage: active?.stage ?? null,
      currentPatternId: active?.patternId ?? null,
      successRate,
      analysis,
    });

    await this.persistState(objectId, state, active);

    logger.info(
      `[Brain] ${userId}: ${projected.length} events over ${observedDays} days → ` +
        `${patterns.length} pattern(s), decision: ${state.decision.patternId ?? "none"} ` +
        `@ ${state.decision.stage ?? "n/a"} (confidence: ${state.confidence})`,
    );

    return state;
  }

  // ── what the rest of the app calls ────────────────────────────────────────

  /**
   * The brief for the meal generator. This replaced the direct call into
   * BehaviorService: the generator now has exactly one source of guidance.
   *
   * Never blocks on analysis. A stale state is refreshed in the background and
   * the caller gets what is currently known.
   */
  async buildPlannerContext(userId: string): Promise<string | null> {
    try {
      const objectId = new mongoose.Types.ObjectId(userId);
      const stored = await this.stateModel.findOne({ userId: objectId }).lean();

      if (this.isStale(stored)) {
        setImmediate(() => {
          this.analyzeUser(userId).catch((err) =>
            logger.warn(`[Brain] Background analysis failed for ${userId}: ${err}`),
          );
        });
      }

      if (!stored?.plannerContext) return null;

      await this.stateModel
        .updateOne({ userId: objectId }, { $set: { lastAppliedToPlanAt: new Date() } })
        .exec();

      return stored.plannerContext;
    } catch (err) {
      logger.warn(`[Brain] Planner context unavailable for ${userId}: ${err}`);
      return null;
    }
  }

  /**
   * The prep ceiling the planner should respect.
   *
   * The Brain answers this too, so the generator has no reason to reach past
   * it into the behaviour module.
   */
  async effectiveMaxPrepMinutes(userId: string): Promise<number | null> {
    return this.behaviorService.effectiveMaxPrepMinutes(userId).catch(() => null);
  }

  /**
   * Run the Brain for whoever has come due. Called overnight, never on a
   * request path.
   *
   * "Due" is driven by users who have recent activity, because a Brain run
   * over a window with nothing new in it produces the same decision it
   * produced yesterday at the cost of a full projection.
   */
  async runScheduledAnalysis(
    limit: number = BRAIN_BATCH_SIZE,
  ): Promise<{ analysed: number; failed: number }> {
    const userIds = await this.findDueUserIds(limit);

    let analysed = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        await this.analyzeUser(userId);
        analysed++;
      } catch (err) {
        failed++;
        logger.error(`[Brain] Scheduled analysis failed for ${userId}: ${err}`);
      }
    }

    logger.info(
      `[Brain] Scheduled pass complete — ${analysed} analysed, ${failed} failed`,
    );
    return { analysed, failed };
  }

  /**
   * Users whose state is stale but who have logged something recently. A user
   * who has not opened the app has no new behaviour to read.
   */
  async findDueUserIds(limit: number = BRAIN_BATCH_SIZE): Promise<string[]> {
    const activeSince = new Date();
    activeSince.setDate(activeSince.getDate() - 3);
    const activeSinceKey = toLocalDateKey(activeSince);

    const recentlyActive = await this.progressModel
      .distinct("userId", { dateKey: { $gte: activeSinceKey } })
      .exec();

    if (recentlyActive.length === 0) return [];

    const staleCutoff = new Date(Date.now() - STATE_REFRESH_HOURS * 3_600_000);

    const states = await this.stateModel
      .find({ userId: { $in: recentlyActive } })
      .select("userId lastAnalysisAt")
      .lean()
      .exec();

    const analysedAt = new Map(
      states.map((s: any) => [s.userId.toString(), s.lastAnalysisAt]),
    );

    // Never analysed sorts first: a user with no state at all gets nothing
    // from the Brain until the first run happens.
    return recentlyActive
      .map((id: any) => id.toString())
      .filter((id) => {
        const last = analysedAt.get(id);
        return !last || new Date(last) < staleCutoff;
      })
      .slice(0, limit);
  }

  /** The current state, for the API and the insight screens. */
  async getState(userId: string): Promise<IBrainStateDoc | null> {
    return this.stateModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .lean();
  }

  /**
   * The Brain as a user should meet it: one thing being worked on, why we think
   * so, what the app is doing about it, and how they'll know it is working.
   *
   * Composed here rather than stored, so changing an intervention's wording
   * updates every user immediately instead of waiting for their next analysis
   * run. Returns null when the Brain has nothing it can honestly claim — the
   * screen then shows its own "still learning" state rather than an empty card.
   */
  async getUserFacingState(userId: string): Promise<BrainFocus | null> {
    const objectId = new mongoose.Types.ObjectId(userId);
    const state = await this.stateModel.findOne({ userId: objectId }).lean();

    if (!state?.activeBehavior || state.confidence === "insufficient") {
      return null;
    }

    const { patternId, interventionId, stage, startedAt } = state.activeBehavior;
    const definition = patternById(patternId);
    const intervention = interventionById(interventionId);
    if (!definition || !intervention) return null;

    const pattern = await this.patternModel
      .findOne({ userId: objectId, patternId })
      .lean();

    return {
      patternId,
      patternName: definition.name,
      category: definition.category,
      emoji: PATTERN_EMOJI[patternId] ?? "🔎",
      stage,
      stageLabel: STAGE_LABELS[stage] ?? stage,
      stageIndex: STAGE_LADDER.indexOf(stage) + 1,
      stageCount: STAGE_LADDER.length,
      whatWeAreDoing: intervention.userFacing.whatWeAreDoing,
      goingWellIf: intervention.userFacing.goingWellIf,
      // The evidence the detection actually rests on. Shown verbatim so the
      // claim is checkable against the user's own memory of the week.
      evidence: (pattern?.evidence ?? []).map((e) => e.description),
      status: pattern?.status ?? null,
      /** True once the pattern has measurably eased from its baseline. */
      improving: pattern?.status === PatternStatus.IMPROVING,
      startedAt: startedAt ?? null,
      confidence: state.confidence,
    };
  }

  /**
   * Every pattern the user has — or recently had — and which way it is moving,
   * with a few concrete things to try. The focus card says what the Brain is
   * working on; this says how the rest of the picture is changing.
   *
   * Only confirmed patterns are shown: a single sighting is as likely to be a
   * bad week as a habit (see the status ladder), and telling someone about a
   * habit they don't have is worse than saying nothing.
   */
  async getPatternProgress(userId: string): Promise<PatternProgress[]> {
    const objectId = new mongoose.Types.ObjectId(userId);
    const [patterns, state] = await Promise.all([
      this.patternModel.find({ userId: objectId }).lean(),
      this.stateModel.findOne({ userId: objectId }).select("activeBehavior").lean(),
    ]);
    const focusId = state?.activeBehavior?.patternId ?? null;
    const resolvedCutoff = Date.now() - PROGRESS_RESOLVED_DAYS * 86_400_000;

    const order: Record<PatternProgress["trend"], number> = {
      improving: 0,
      steady: 1,
      resolved: 2,
    };

    return patterns
      .map((p): PatternProgress | null => {
        const definition = patternById(p.patternId);
        if (!definition) return null;

        let trend: PatternProgress["trend"];
        if (p.status === PatternStatus.RESOLVED) {
          // Only a pattern that was ever real can resolve, and only recently
          // resolved ones are news.
          if ((p.detectionCount ?? 0) < 2) return null;
          if (!p.resolvedAt || new Date(p.resolvedAt).getTime() < resolvedCutoff) return null;
          trend = "resolved";
        } else if (p.status === PatternStatus.DISCOVERED) {
          return null;
        } else if (p.status === PatternStatus.IMPROVING) {
          trend = "improving";
        } else {
          trend = "steady";
        }

        return {
          patternId: p.patternId,
          name: definition.name,
          emoji: PATTERN_EMOJI[p.patternId] ?? "🔎",
          trend,
          trendLabel: TREND_LABELS[trend],
          isFocus: p.patternId === focusId,
          evidence: trend === "resolved" ? null : (p.evidence?.[0]?.description ?? null),
          tips: trend === "resolved" ? [] : (PATTERN_TIPS[p.patternId] ?? []),
          since: p.firstDetectedAt ?? null,
        };
      })
      .filter((p): p is PatternProgress => p !== null)
      .sort((a, b) => Number(b.isFocus) - Number(a.isFocus) || order[a.trend] - order[b.trend]);
  }

  async getPatterns(userId: string): Promise<IBehaviorPatternDoc[]> {
    return this.patternModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ score: -1 })
      .lean();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Materialise the projection.
   *
   * Idempotent by fingerprint, so re-analysing an overlapping window updates
   * events rather than duplicating them — which would otherwise inflate every
   * count the detectors rely on.
   */
  private async persistEvents(
    userId: mongoose.Types.ObjectId,
    events: Omit<IBehaviorEvent, "userId">[],
  ): Promise<void> {
    if (events.length === 0) return;

    await this.eventModel.bulkWrite(
      events.map((event) => ({
        updateOne: {
          filter: { userId, fingerprint: event.fingerprint },
          update: { $set: { ...event, userId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  /**
   * Move each pattern along its status ladder and return the current view.
   *
   * A pattern is not acted on the first time it is seen. One sighting inside a
   * single window is as likely to be a bad week as a habit, so DISCOVERED only
   * becomes CONFIRMED on a second independent run.
   */
  private async updatePatternLadder(
    userId: mongoose.Types.ObjectId,
    scores: ReturnType<PatternEngine["analyze"]>,
  ): Promise<BrainPatternView[]> {
    const now = new Date();
    const detected = new Set(scores.map((s) => s.patternId));
    const views: BrainPatternView[] = [];

    for (const score of scores) {
      const definition = patternById(score.patternId);
      if (!definition) continue;

      const existing = await this.patternModel
        .findOne({ userId, patternId: score.patternId })
        .lean();

      // A detection only counts as independent when the last one was a
      // separate run over a later window — the nightly cadence. Two analyses
      // minutes apart read the same data twice; counting both "confirmed" a
      // pattern from one sighting.
      const independent =
        !existing?.lastDetectedAt ||
        now.getTime() - new Date(existing.lastDetectedAt).getTime() >=
          STATE_REFRESH_HOURS * 60 * 60 * 1000;
      const detectionCount = (existing?.detectionCount ?? 0) + (independent ? 1 : 0);
      const baseline = existing?.baselineScore ?? score.score;
      const status = this.nextStatus(existing, score.score, detectionCount, baseline);

      await this.patternModel.updateOne(
        { userId, patternId: score.patternId },
        {
          $set: {
            name: definition.name,
            score: score.score,
            confidence: score.confidence,
            evidence: score.evidence,
            status,
            detectionCount,
            baselineScore: baseline,
            // Only moves on an independent detection, so the 20h spacing is
            // measured from the last one that counted.
            lastDetectedAt: independent ? now : existing?.lastDetectedAt ?? now,
            resolvedAt: null,
          },
          $setOnInsert: {
            userId,
            patternId: score.patternId,
            firstDetectedAt: now,
          },
        },
        { upsert: true },
      );

      views.push({
        patternId: score.patternId,
        name: definition.name,
        category: definition.category,
        score: score.score,
        confidence: score.confidence,
        status,
        evidence: score.evidence,
      });
    }

    // Anything previously known but not detected this run has resolved. Said
    // explicitly rather than by silence, so the decision engine can stop
    // working on it and the user can be told it improved.
    await this.patternModel.updateMany(
      {
        userId,
        patternId: { $nin: [...detected] },
        status: { $ne: PatternStatus.RESOLVED },
      },
      { $set: { status: PatternStatus.RESOLVED, resolvedAt: now, score: 0 } },
    );

    return views.sort((a, b) => b.score * b.confidence - a.score * a.confidence);
  }

  private nextStatus(
    existing: IBehaviorPatternDoc | null,
    score: number,
    detectionCount: number,
    baseline: number,
  ): PatternStatus {
    if (detectionCount < 2) return PatternStatus.DISCOVERED;

    // Measured against where the user started, not against last week — week to
    // week noise would otherwise read as progress.
    if (baseline > 0 && score <= baseline * 0.7) return PatternStatus.IMPROVING;

    if (existing?.status === PatternStatus.ACTIVE) return PatternStatus.ACTIVE;
    if (detectionCount >= 4) return PatternStatus.STABLE;
    return PatternStatus.CONFIRMED;
  }

  /**
   * How well the user did against the active intervention's success metric.
   *
   * Measured from the same event stream the detectors use, so success is
   * judged on what actually happened rather than on self-report. Returns null
   * when there is nothing to judge — which the decision engine reads as "hold
   * the stage" rather than as failure.
   */
  private async measureSuccess(
    userId: mongoose.Types.ObjectId,
    patternId: string,
    stage: BehaviorStage,
  ): Promise<number | null> {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const events = await this.eventModel
      .find({ userId, timestamp: { $gte: since } })
      .lean();

    if (events.length === 0) return null;

    const days = new Set(events.map((e) => e.dateKey).filter(Boolean)).size;
    if (days < 3) return null;

    switch (patternId) {
      case "P01": {
        // Success is days that reached a full set of meals.
        const byDay = new Map<string, number>();
        for (const e of events) {
          if (
            e.type !== BehaviorEventType.MEAL_LOGGED &&
            e.type !== BehaviorEventType.PLAN_MEAL_COMPLETED
          ) {
            continue;
          }
          byDay.set(e.dateKey, (byDay.get(e.dateKey) ?? 0) + 1);
        }
        if (byDay.size === 0) return 0;
        const good = [...byDay.values()].filter((c) => c >= 3).length;
        return good / byDay.size;
      }

      case "P02": {
        // Success is the mirror of the detection: of the days that gave the
        // user a chance to recover from a miss, how many did.
        const ORDER = ["breakfast", "lunch", "dinner"] as const;
        const byDay = new Map<string, Map<string, "logged" | "skipped">>();

        for (const e of events) {
          if (!e.dateKey || !e.mealType) continue;
          if (!ORDER.includes(e.mealType as (typeof ORDER)[number])) continue;

          const status =
            e.type === BehaviorEventType.MEAL_LOGGED ||
            e.type === BehaviorEventType.PLAN_MEAL_COMPLETED
              ? ("logged" as const)
              : e.type === BehaviorEventType.MEAL_SKIPPED
                ? ("skipped" as const)
                : null;
          if (!status) continue;

          const day = byDay.get(e.dateKey) ?? new Map();
          if (!(status === "skipped" && day.get(e.mealType) === "logged")) {
            day.set(e.mealType, status);
          }
          byDay.set(e.dateKey, day);
        }

        let slipDays = 0;
        let recovered = 0;

        for (const day of byDay.values()) {
          const statuses = ORDER.map((slot) => day.get(slot));
          const firstMiss = statuses.findIndex((st) => st === "skipped");
          if (firstMiss === -1) continue;

          const later = statuses.slice(firstMiss + 1).filter(Boolean);
          if (later.length === 0) continue;

          slipDays++;
          if (later.some((st) => st === "logged")) recovered++;
        }

        // No slip at all in the window is not a measured success — there was
        // nothing to recover from. Holding the stage is the honest answer.
        if (slipDays === 0) return null;
        return recovered / slipDays;
      }

      case "P04": {
        // Success is meals that were not late. Only timed events can say.
        const timed = events.filter(
          (e) =>
            e.timestampIsExact &&
            (e.type === BehaviorEventType.MEAL_LOGGED ||
              e.type === BehaviorEventType.SNACK_LOGGED),
        );
        if (timed.length === 0) return null;
        const onTime = timed.filter((e) => e.timestamp.getHours() < 21).length;
        return onTime / timed.length;
      }

      case "P08": {
        const meals = events.filter(
          (e) =>
            e.type === BehaviorEventType.MEAL_LOGGED ||
            e.type === BehaviorEventType.SNACK_LOGGED,
        );
        if (meals.length === 0) return null;
        const takeaway = events.filter(
          (e) => e.type === BehaviorEventType.TAKEAWAY_LOGGED,
        ).length;
        return 1 - Math.min(1, takeaway / meals.length);
      }

      case "P09": {
        // Success is lunches that happened, of the lunches we know about.
        const lunch = new Map<string, boolean>();
        for (const e of events) {
          if (e.mealType !== "lunch" || !e.dateKey) continue;
          if (
            e.type === BehaviorEventType.MEAL_LOGGED ||
            e.type === BehaviorEventType.PLAN_MEAL_COMPLETED
          ) {
            lunch.set(e.dateKey, true);
          } else if (e.type === BehaviorEventType.MEAL_SKIPPED && !lunch.get(e.dateKey)) {
            lunch.set(e.dateKey, false);
          }
        }
        if (lunch.size === 0) return null;
        return [...lunch.values()].filter(Boolean).length / lunch.size;
      }

      default:
        // At the awareness stage the metric is simply that the user kept
        // logging, which is the same question for every pattern.
        return stage === BehaviorStage.AWARENESS
          ? Math.min(1, days / 7)
          : null;
    }
  }

  /** The behaviour analyst's contribution to the state. */
  private async loadAnalysis(userId: string): Promise<BrainState["analysis"]> {
    try {
      const profile = await this.behaviorService.getProfile(userId);
      if (!profile || profile.confidence === "insufficient") {
        return { plannerBrief: null, directives: null };
      }

      return {
        plannerBrief: profile.plannerBrief || null,
        directives: profile.planningDirectives
          ? {
              maxPrepMinutes: profile.planningDirectives.maxPrepMinutes ?? null,
              simplifySlots: profile.planningDirectives.simplifySlots ?? [],
              flexibleSlots: profile.planningDirectives.flexibleSlots ?? [],
              weekendNeedsOwnShape:
                profile.planningDirectives.weekendNeedsOwnShape ?? false,
              increaseVariety: profile.planningDirectives.increaseVariety ?? false,
              reduceLateEating: profile.planningDirectives.reduceLateEating ?? false,
              emphasiseMacro: profile.planningDirectives.emphasiseMacro ?? null,
              notes: profile.planningDirectives.notes ?? [],
            }
          : null,
      };
    } catch (err) {
      logger.warn(`[Brain] Analyst profile unavailable for ${userId}: ${err}`);
      return { plannerBrief: null, directives: null };
    }
  }

  private async persistState(
    userId: mongoose.Types.ObjectId,
    state: BrainState,
    previous: IBrainStateDoc["activeBehavior"],
  ): Promise<void> {
    const { decision } = state;

    const resolved = await this.patternModel
      .find({ userId, status: PatternStatus.RESOLVED })
      .select("patternId resolvedAt")
      .lean();

    const sameBehaviour =
      previous?.patternId === decision.patternId &&
      previous?.stage === decision.stage;

    const activeBehavior =
      decision.patternId && decision.interventionId && decision.stage
        ? {
            patternId: decision.patternId,
            interventionId: decision.interventionId,
            stage: decision.stage,
            startedAt: sameBehaviour ? (previous?.startedAt ?? new Date()) : new Date(),
            runsAtStage: sameBehaviour ? (previous?.runsAtStage ?? 0) + 1 : 1,
            lastSuccessRate: previous?.lastSuccessRate ?? null,
          }
        : null;

    if (activeBehavior) {
      await this.patternModel.updateOne(
        { userId, patternId: activeBehavior.patternId },
        { $set: { status: PatternStatus.ACTIVE } },
      );
    }

    await this.stateModel.updateOne(
      { userId },
      {
        $set: {
          generatedAt: state.generatedAt,
          confidence: state.confidence,
          activeBehavior,
          improvingPatterns: state.patterns
            .filter((p) => p.status === PatternStatus.IMPROVING)
            .map((p) => p.patternId),
          stablePatterns: state.patterns
            .filter((p) => p.status === PatternStatus.STABLE)
            .map((p) => p.patternId),
          // Only patterns this user actually had and no longer has. Listing
          // every undetected pattern here would tell someone they had
          // "resolved" a takeaway habit they never had in the first place.
          resolvedPatterns: resolved.map((p) => p.patternId),
          plannerContext: renderPlannerContext(state, resolved),
          lastAnalysisAt: new Date(),
        },
        $inc: { version: 1 },
        $setOnInsert: { userId },
      },
      { upsert: true },
    );
  }

  private isStale(state: IBrainStateDoc | null | undefined): boolean {
    if (!state?.lastAnalysisAt) return true;
    const ageHours =
      (Date.now() - new Date(state.lastAnalysisAt).getTime()) / 3_600_000;
    return ageHours >= STATE_REFRESH_HOURS;
  }
}
