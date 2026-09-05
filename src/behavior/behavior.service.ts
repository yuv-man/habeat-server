/**
 * The behaviour pipeline — one system, one profile.
 *
 *   MongoDB → aggregation → summary → checks → verification of the last run
 *           → analyst (LLM #1) → living profile → planner context (LLM #2)
 *
 * This is the only place a user profile is produced. It absorbed the former
 * EatingProfile service: seeding from onboarding, the rule-based trigger and
 * risk-window scores, the pattern/suggestion banks and the chat summary all
 * live here now, against one document, refreshed on one schedule.
 *
 * Two properties the rest of the app depends on:
 *
 *  - **Nothing on a request path runs a model.** `buildPlannerContext` reads
 *    what is stored and returns; refreshes happen on a schedule or in the
 *    background. Generating a plan must never wait on an analysis.
 *  - **Every stage degrades on its own.** With no model key the profile still
 *    gets its computed half; with no profile the planner simply gets no extra
 *    context and behaves as it did before this existed.
 */

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";

import {
  BehaviorProfile,
  IBehaviorProfile,
  IBehaviorPattern,
} from "./behavior-profile.model";
import { BehaviorAnalystAgent } from "./behavior-analyst.agent";
import { buildBehaviorSummary } from "./behavior-summary";
import { BehaviorSummary } from "./behavior-summary.types";
import { deriveProfile } from "./behavior-profile.derive";
import { buildPlannerContext } from "./behavior.prompts";
import {
  CheckResult,
  CheckVerification,
  runChecks,
  verifyCheck,
} from "./behavior-checks";
import { PATTERN_BANK, BankPattern } from "./banks/patterns.bank";
import { SUGGESTION_BANK, BankSuggestion } from "./banks/suggestions.bank";

import { DailyProgress } from "../progress/progress.model";
import {
  MoodEntry,
  IMoodEntry,
  MealMoodCorrelation,
  IMealMoodCorrelation,
} from "../cbt/cbt.model";
import { User } from "../user/user.model";
import { Goal } from "../goals/goal.model";
import { Plan } from "../plan/plan.model";
import { IPlan } from "../types/interfaces";
import { IDailyProgress, IUserData, IGoal } from "../types/interfaces";
import { toLocalDateKey } from "../utils/eating-episodes";
import {
  computeRiskWindows,
  formatHourRange,
  formatDays,
  WINDOW_HOURS,
} from "../utils/risk-windows";
import logger from "../utils/logger";

/** How far back the analysis looks. Thirty days is long enough for a weekday /
 *  weekend split to mean something and short enough to describe how the user
 *  lives now rather than how they lived last season. */
export const ANALYSIS_WINDOW_DAYS = 30;

/** How often a profile is rebuilt. Behaviour does not turn over faster than
 *  this, and each rebuild is a model call — refreshing on every plan would put
 *  an LLM round-trip on a path the user is watching. */
export const PROFILE_REFRESH_DAYS = 3;

/** Profiles refreshed per scheduled tick. Caps the burst when many users come
 *  due at once; the rest are picked up on the next tick. */
export const SCHEDULED_BATCH_SIZE = 25;

/**
 * A plan this many days old means the user is about to ask for a new week —
 * plans cover seven days and are regenerated whole, most often on a Monday.
 *
 * Profiles for those users are refreshed the night before even if they are not
 * otherwise stale, so the week that gets generated is planned against what the
 * user did last week rather than the week before it. This is the difference
 * between a profile that exists and a profile that arrives in time to matter.
 */
export const PLAN_PREWARM_DAYS = 5;

/** Don't re-analyse a profile refreshed within this window, however imminent
 *  the plan. Guards against a plan regenerated twice in a day costing two runs. */
export const PREWARM_MIN_AGE_HOURS = 20;

// ─── seeding from onboarding ────────────────────────────────────────────────

const KYC_PATTERN_TAGS: Record<string, string[]> = {
  "very-emotional": ["stress-eater", "emotional-dinner"],
  "sometimes-emotional": ["mood-responsive"],
  fuel: ["mindful-breakfast"],
  unsure: [],
};

const KYC_SUGGESTION_TAGS: Record<string, string[]> = {
  "very-emotional": ["needs-urge-surfing", "needs-breathing", "hunger-check", "mood-meal-link"],
  "sometimes-emotional": ["hunger-check", "pre-meal-pause", "mood-meal-link"],
  fuel: ["meal-pacing", "mood-meal-link"],
  unsure: ["mood-meal-link", "hunger-check"],
};

const EMOTIONAL_TRIGGER_TO_SUGGESTION: Record<string, string> = {
  stress: "needs-breathing",
  boredom: "needs-urge-surfing",
  sadness: "needs-body-scan",
  anxiety: "needs-breathing",
  habit: "pre-meal-pause",
  social: "social-mindfulness",
  tiredness: "stress-alternative",
  procrastination: "pre-meal-pause",
  "late-night": "reduce-evening-snacks",
  celebration: "celebrate-without-food",
};

const MOOD_TO_TRIGGER: Record<string, string> = {
  stressed: "stress",
  anxious: "anxiety",
  sad: "sadness",
  tired: "tiredness",
  angry: "stress",
  neutral: "habit",
};

function filterBank<T extends { tags: string[]; priority: number }>(
  bank: T[],
  profileTags: string[],
  limit: number,
): T[] {
  return bank
    .filter((item) => item.tags.some((t) => profileTags.includes(t)))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
}

/**
 * Replace a bank pattern's generic `context` ("After 9 PM") with the window the
 * user's own data actually shows. Without this the windows are computed from
 * real timestamps and then thrown away at display time.
 */
function applyUserWindow(
  pattern: BankPattern,
  riskWindows: { dayOfWeek: number; hourStart: number; risk: string }[],
): BankPattern {
  if (!riskWindows?.length) return pattern;

  const bySlot = new Map<number, { days: number[]; highRisk: boolean }>();
  for (const w of riskWindows) {
    const slot = bySlot.get(w.hourStart) ?? { days: [], highRisk: false };
    slot.days.push(w.dayOfWeek);
    slot.highRisk ||= w.risk === "high";
    bySlot.set(w.hourStart, slot);
  }

  const [hourStart, slot] = [...bySlot.entries()].sort(
    (a, b) =>
      Number(b[1].highRisk) - Number(a[1].highRisk) ||
      b[1].days.length - a[1].days.length ||
      a[0] - b[0],
  )[0];

  const hours = formatHourRange(hourStart, hourStart + WINDOW_HOURS);
  const days = slot.days.length <= 3 ? formatDays([...new Set(slot.days)].sort()) : "";

  return { ...pattern, context: days ? `${days}, ${hours}` : `${hours}, most days` };
}

@Injectable()
export class BehaviorService {
  constructor(
    @InjectModel(BehaviorProfile.name)
    private profileModel: Model<IBehaviorProfile>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>,
    @InjectModel(MoodEntry.name) private moodModel: Model<IMoodEntry>,
    @InjectModel(MealMoodCorrelation.name)
    private correlationModel: Model<IMealMoodCorrelation>,
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(Goal.name) private goalModel: Model<IGoal>,
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    private analyst: BehaviorAnalystAgent,
  ) {}

  // ── stage 1: aggregation ──────────────────────────────────────────────────

  /**
   * The clean behavioural summary. Exposed on its own because it is useful
   * without any model: it is what the analytics screens could read, and it is
   * what makes a bad analysis debuggable — you can see exactly what the model
   * was told.
   */
  async buildSummary(
    userId: string,
    periodDays: number = ANALYSIS_WINDOW_DAYS,
  ): Promise<BehaviorSummary> {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - periodDays);
    const todayKey = toLocalDateKey(now);
    const startKey = toLocalDateKey(start);

    const [progressDocs, moods, correlations, user, goals] = await Promise.all([
      this.progressModel
        .find({ userId: userIdObj, dateKey: { $gte: startKey, $lte: todayKey } })
        .lean()
        .exec(),
      this.moodModel
        .find({ userId: userIdObj, date: { $gte: startKey, $lte: todayKey } })
        .lean()
        .exec(),
      this.correlationModel
        .find({ userId: userIdObj, date: { $gte: startKey, $lte: todayKey } })
        .lean()
        .exec(),
      this.userModel.findById(userId).lean().exec(),
      this.goalModel
        .find({ userId: userIdObj, status: { $in: ["active", "in_progress"] } })
        .lean()
        .exec(),
    ]);

    return buildBehaviorSummary({
      periodDays,
      todayKey,
      startKey,
      progressDocs: progressDocs as any[],
      moods: moods as any[],
      user: user as any,
      goals: (goals as any[]).map((g) => ({
        title: g.title,
        current: g.current,
        target: g.target,
        unit: g.unit,
      })),
      episodes: (correlations as any[]).map((c) => ({
        date: c.date,
        mealType: c.mealType,
        score: c.wasEmotionalEating ? 1 : 0,
        emotional: Boolean(c.wasEmotionalEating),
        moodCategory: c.moodBefore?.moodCategory ?? null,
      })),
    });
  }

  // ── tier 0: seed from onboarding, no model involved ───────────────────────

  /**
   * Create the profile at signup from the KYC answers, so the app has
   * something to say on day one. Everything here is marked "insufficient": it
   * is what the user told us, not anything we watched them do.
   */
  async seed(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) return;

    const rel = (user as any).foodRelationship ?? "unsure";
    const kycTriggers: string[] = (user as any).emotionalTriggers ?? [];

    const patternTags = [...(KYC_PATTERN_TAGS[rel] ?? [])];
    const suggestionTags = [...(KYC_SUGGESTION_TAGS[rel] ?? [])];
    kycTriggers.forEach((t) => {
      const tag = EMOTIONAL_TRIGGER_TO_SUGGESTION[t];
      if (tag && !suggestionTags.includes(tag)) suggestionTags.push(tag);
    });

    await this.profileModel.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      {
        $setOnInsert: { userId: new mongoose.Types.ObjectId(userId) },
        $set: {
          confidence: "insufficient",
          patternTags,
          suggestionTags,
          generatedAt: new Date(),
          version: 1,
        },
      },
      { upsert: true, new: true },
    );

    logger.info(`[BehaviorService] Seed profile created for user ${userId}`);
  }

  // ── rule-based scores, refreshed cheaply and often ────────────────────────

  /**
   * Trigger scores, risk windows and mood-lifting meals, straight from the
   * meal-mood correlations. No model, so this can run on every new correlation
   * without costing anything.
   */
  async refreshScores(userId: string): Promise<void> {
    const correlations = await this.correlationModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .lean()
      .exec();

    if (correlations.length === 0) return;

    const emotionalTotal = correlations.filter((c) => c.wasEmotionalEating).length;
    const triggerCounts: Record<string, number> = {};
    correlations
      .filter((c) => c.wasEmotionalEating && c.moodBefore?.moodCategory)
      .forEach((c) => {
        const trigger = MOOD_TO_TRIGGER[c.moodBefore!.moodCategory];
        if (trigger) triggerCounts[trigger] = (triggerCounts[trigger] ?? 0) + 1;
      });

    const triggerScores: Record<string, number> = {};
    Object.entries(triggerCounts).forEach(([t, count]) => {
      triggerScores[t] =
        emotionalTotal > 0 ? Math.round((count / emotionalTotal) * 100) / 100 : 0;
    });

    const riskWindows = computeRiskWindows(
      correlations.map((c) => ({
        at: new Date(c.createdAt),
        emotional: c.wasEmotionalEating,
      })),
    );

    // Meals the user reliably felt better after. Only meals with a mood on both
    // sides can say anything here.
    const lifts: Record<string, { total: number; count: number }> = {};
    correlations.forEach((c) => {
      if (!c.moodBefore || !c.moodAfter) return;
      const lift = c.moodAfter.moodLevel - c.moodBefore.moodLevel;
      lifts[c.mealName] ??= { total: 0, count: 0 };
      lifts[c.mealName].total += lift;
      lifts[c.mealName].count++;
    });
    const bestMeals = Object.entries(lifts)
      .map(([mealName, v]) => ({
        mealName,
        avgMoodLift: Math.round((v.total / v.count) * 10) / 10,
      }))
      .filter((m) => m.avgMoodLift > 0)
      .sort((a, b) => b.avgMoodLift - a.avgMoodLift)
      .slice(0, 5);

    await this.profileModel
      .findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        { $set: { triggerScores, riskWindows, bestMeals } },
      )
      .exec();
  }

  /**
   * Called after every new meal-mood correlation. Refreshes the cheap scores
   * inline and leaves the expensive analysis to the schedule — a user logging
   * a mood should never trigger a model call they have to wait for.
   */
  async onNewCorrelation(userId: string): Promise<void> {
    await this.refreshScores(userId);
  }

  // ── stage 2: the self-test ────────────────────────────────────────────────

  /**
   * Re-run the previous run's checks and report how its claims held up.
   *
   * This is the system testing itself. The checks that fired when the claims
   * were written are stored on the profile; running the same predicates against
   * today's data says, per claim, whether it still holds, has eased, has
   * resolved, or can no longer be measured.
   */
  verifyAgainst(
    stored: IBehaviorProfile | null,
    current: CheckResult[],
  ): {
    verifiedAt: Date;
    testedVersion: number;
    results: CheckVerification[];
    holds: number;
    eased: number;
    resolved: number;
    unverifiable: number;
  } | null {
    const previous = (stored?.checks ?? []).filter((c) => c.fired);
    if (previous.length === 0) return null;

    const results = previous.map((before) =>
      verifyCheck(
        {
          ...(before as any),
          area: "planning",
          label: before.id,
          minBasis: 0,
          direction: (before.direction as "below" | "above") ?? "above",
        },
        current.find((c) => c.id === before.id),
      ),
    );

    const count = (outcome: CheckVerification["outcome"]) =>
      results.filter((r) => r.outcome === outcome).length;

    return {
      verifiedAt: new Date(),
      testedVersion: stored?.version ?? 0,
      results,
      holds: count("holds"),
      eased: count("eased"),
      resolved: count("resolved"),
      unverifiable: count("unverifiable"),
    };
  }

  /** Verify the stored profile against fresh data without rebuilding it. */
  async verifyProfile(userId: string) {
    const [profile, summary] = await Promise.all([
      this.getProfile(userId),
      this.buildSummary(userId),
    ]);

    const selfCheck = this.verifyAgainst(profile, runChecks(summary));
    if (selfCheck) {
      await this.profileModel
        .updateOne(
          { userId: new mongoose.Types.ObjectId(userId) },
          { $set: { selfCheck } },
        )
        .exec();
    }

    return selfCheck;
  }

  // ── stage 3: analysis and the living profile ──────────────────────────────

  async getProfile(userId: string): Promise<IBehaviorProfile | null> {
    return this.profileModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .lean()
      .exec() as Promise<IBehaviorProfile | null>;
  }

  /** True when the stored profile is old enough to be worth rebuilding. */
  isDue(profile: IBehaviorProfile | null): boolean {
    if (!profile?.generatedAt) return true;
    const ageDays =
      (Date.now() - new Date(profile.generatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays >= PROFILE_REFRESH_DAYS;
  }

  /**
   * Rebuild the profile: aggregate, check, verify the last run, analyse, persist.
   *
   * `skipLlm` produces the computed half only — the arithmetic, the checks and
   * the verification, which is everything the planner actually reads.
   */
  async refreshProfile(
    userId: string,
    opts: { skipLlm?: boolean; periodDays?: number } = {},
  ): Promise<IBehaviorProfile> {
    const summary = await this.buildSummary(userId, opts.periodDays);
    const computed = deriveProfile(summary);
    const existing = await this.getProfile(userId);

    // Grade the previous run before writing over it.
    const selfCheck = this.verifyAgainst(existing, computed.checks);

    let analysis = null;
    // Below "insufficient" there is nothing worth spending a model call on, and
    // an analysis of four days of data would read far more confidently than it
    // deserves to.
    if (!opts.skipLlm && computed.confidence !== "insufficient") {
      analysis = await this.analyst.analyse(
        summary,
        computed.checks,
        existing ? { patterns: existing.patterns ?? [], selfCheck } : null,
      );
    }

    const directives = {
      ...computed.planningDirectives,
      ...(analysis?.planningDirectives ?? {}),
      // The union of both sides: the analyst can add a slot the arithmetic
      // missed, but cannot drop one the arithmetic proved.
      simplifySlots: [
        ...new Set([
          ...computed.planningDirectives.simplifySlots,
          ...(analysis?.planningDirectives?.simplifySlots ?? []),
        ]),
      ],
      flexibleSlots: [
        ...new Set([
          ...computed.planningDirectives.flexibleSlots,
          ...(analysis?.planningDirectives?.flexibleSlots ?? []),
        ]),
      ],
      // A model may only lower the prep ceiling the user's own behaviour set.
      maxPrepMinutes: (() => {
        const own = computed.planningDirectives.maxPrepMinutes;
        const asked = analysis?.planningDirectives?.maxPrepMinutes ?? null;
        if (own === null) return asked;
        if (asked === null) return own;
        return Math.min(own, asked);
      })(),
      weekendNeedsOwnShape:
        computed.planningDirectives.weekendNeedsOwnShape ||
        Boolean(analysis?.planningDirectives?.weekendNeedsOwnShape),
      reduceLateEating:
        computed.planningDirectives.reduceLateEating ||
        Boolean(analysis?.planningDirectives?.reduceLateEating),
      increaseVariety:
        computed.planningDirectives.increaseVariety ||
        Boolean(analysis?.planningDirectives?.increaseVariety),
      emphasiseMacro:
        computed.planningDirectives.emphasiseMacro ??
        analysis?.planningDirectives?.emphasiseMacro ??
        null,
    };

    const updated = await this.profileModel
      .findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        {
          $setOnInsert: { userId: new mongoose.Types.ObjectId(userId) },
          $set: {
            version: (existing?.version ?? 0) + 1,
            generatedAt: new Date(),
            confidence: computed.confidence,
            dataSnapshot: computed.dataSnapshot,
            behavior: computed.behavior,
            context: computed.context,
            preferences: computed.preferences,
            planningDirectives: directives,
            nutritionTendency: {
              calorieAccuracy: summary.nutrition.calorieAccuracy ?? "on-target",
              macroWeakness: summary.nutrition.macroWeakness,
            },
            // The checks as they stood when these claims were written — the
            // baseline the next run grades them against.
            checks: computed.checks.map((c) => ({
              id: c.id,
              fired: c.fired,
              value: c.value,
              threshold: c.threshold,
              direction: c.direction,
              basis: c.basis,
              evidence: c.evidence,
            })),
            ...(selfCheck ? { selfCheck } : {}),
            // Narrative fields come from the model. When it didn't run, keep
            // what was there rather than blanking a good analysis because one
            // refresh happened without a key.
            ...(analysis
              ? {
                  patterns: analysis.keyPatterns,
                  feelingFoodRelationship: analysis.feelingFoodRelationship,
                  habitOpportunities: analysis.habitOpportunities,
                  recommendations: analysis.recommendations,
                  eatingType: analysis.eatingType,
                  emotionalEatingRisk: analysis.emotionalEatingRisk,
                  patternTags: analysis.patternTags,
                  suggestionTags: analysis.suggestionTags,
                  plannerBrief: analysis.planningBrief,
                  narrative: {
                    behavioralSummary: analysis.behavioralSummary,
                    whatWorked: analysis.whatWorked,
                    whatDidNotWork: analysis.whatDidNotWork,
                  },
                }
              : {}),
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    logger.info(
      `[BehaviorService] Profile v${(existing?.version ?? 0) + 1} for ${userId} ` +
        `(confidence=${computed.confidence}, fired=${computed.checks.filter((c) => c.fired).length}, ` +
        `patterns=${analysis?.keyPatterns.length ?? "kept"}` +
        (selfCheck
          ? `, self-check ${selfCheck.holds} hold / ${selfCheck.eased} eased / ${selfCheck.resolved} resolved`
          : "") +
        ")",
    );

    return updated as unknown as IBehaviorProfile;
  }

  // ── the schedule ──────────────────────────────────────────────────────────

  /**
   * Refresh whichever profiles have come due. Called on a timer, never on a
   * request: this is where the model calls happen, deliberately away from
   * anything a user is waiting on.
   */
  /**
   * Who gets refreshed tonight.
   *
   * Two reasons to be on the list, and the second is the one that makes the
   * feature work at all:
   *
   *  - the profile has simply gone stale, or
   *  - the user's plan is old enough that a new week is imminent, so the
   *    profile is brought up to date *before* they ask rather than after.
   */
  async findDueUserIds(limit: number = SCHEDULED_BATCH_SIZE): Promise<string[]> {
    const now = Date.now();

    const staleCutoff = new Date(now - PROFILE_REFRESH_DAYS * 24 * 60 * 60 * 1000);
    const planCutoff = new Date(now - PLAN_PREWARM_DAYS * 24 * 60 * 60 * 1000);
    const prewarmCutoff = new Date(now - PREWARM_MIN_AGE_HOURS * 60 * 60 * 1000);

    // A plan is deleted and rebuilt whole on generation, so createdAt is when
    // the current week began — updatedAt drifts every time a meal is ticked off.
    const agingPlans = await this.planModel
      .find({ createdAt: { $lt: planCutoff } })
      .select("userId")
      .lean()
      .exec();

    const prewarmIds = agingPlans
      .map((p: any) => p.userId)
      .filter(Boolean);

    const due = await this.profileModel
      .find({
        $or: [
          { generatedAt: { $lt: staleCutoff } },
          ...(prewarmIds.length
            ? [{ userId: { $in: prewarmIds }, generatedAt: { $lt: prewarmCutoff } }]
            : []),
        ],
      })
      .sort({ generatedAt: 1 })
      .limit(limit)
      .select("userId")
      .lean()
      .exec();

    return due.map((p: any) => p.userId.toString());
  }

  /**
   * Refresh whichever profiles have come due. Called overnight, never on a
   * request: this is where the model calls happen, deliberately away from
   * anything a user is waiting on.
   */
  async runScheduledAnalysis(): Promise<{ refreshed: number; failed: number }> {
    const due = await this.findDueUserIds();

    let refreshed = 0;
    let failed = 0;

    for (const userId of due) {
      try {
        await this.refreshProfile(userId);
        refreshed++;
      } catch (err) {
        failed++;
        logger.error(`[BehaviorService] Scheduled refresh failed for ${userId}: ${err}`);
      }
    }

    if (due.length > 0) {
      logger.info(
        `[BehaviorService] Nightly run: ${refreshed} refreshed, ${failed} failed ` +
          `(${due.length} due, batch cap ${SCHEDULED_BATCH_SIZE})`,
      );
    }

    return { refreshed, failed };
  }

  // ── stage 4: what the weekly planner is told ──────────────────────────────

  /**
   * The behavioural paragraph for the weekly-plan prompt, or null when there is
   * nothing worth saying.
   *
   * Reads only. If the profile is stale a rebuild is kicked off behind the
   * request and this week's plan uses what was already there — a slightly old
   * profile costs nothing a user would notice, whereas an LLM call in the
   * middle of plan generation is several seconds they would.
   */
  async buildPlannerContext(userId: string): Promise<string | null> {
    try {
      const profile = await this.getProfile(userId);

      if (this.isDue(profile)) {
        setImmediate(() => {
          this.refreshProfile(userId).catch((err) =>
            logger.warn(`[BehaviorService] Background refresh failed for ${userId}: ${err}`),
          );
        });
      }

      if (!profile || profile.confidence === "insufficient") return null;

      const context = buildPlannerContext({
        behavior: profile.behavior as any,
        context: profile.context as any,
        planningDirectives: profile.planningDirectives,
        habitOpportunities: profile.habitOpportunities,
        preferences: profile.preferences,
        // The analysis itself, not just the flags derived from it. These are
        // what make the plan differ for a reason rather than by threshold.
        plannerBrief: profile.plannerBrief,
        patterns: profile.patterns,
        feelingFoodRelationship: profile.feelingFoodRelationship,
        narrative: profile.narrative,
        selfCheck: profile.selfCheck,
      });

      if (context) {
        await this.profileModel
          .updateOne(
            { userId: new mongoose.Types.ObjectId(userId) },
            { $set: { lastAppliedToPlanAt: new Date() } },
          )
          .exec();
      }

      return context;
    } catch (err) {
      logger.warn(`[BehaviorService] Planner context unavailable for ${userId}: ${err}`);
      return null;
    }
  }

  /** The prep ceiling the planner should respect, when behaviour established one. */
  async effectiveMaxPrepMinutes(userId: string): Promise<number | null> {
    const profile = await this.getProfile(userId);
    if (!profile || profile.confidence === "insufficient") return null;
    return profile.planningDirectives?.maxPrepMinutes ?? null;
  }

  // ── consumers of the old eating-profile service ───────────────────────────

  /** The profile with its bank rows resolved, for the insights screens. */
  async getProfileWithBank(userId: string): Promise<{
    profile: IBehaviorProfile | null;
    patterns: BankPattern[];
    suggestions: BankSuggestion[];
  }> {
    const profile = await this.getProfile(userId);
    if (!profile) return { profile: null, patterns: [], suggestions: [] };

    const patterns = filterBank(PATTERN_BANK, profile.patternTags ?? [], 5).map((p) =>
      applyUserWindow(p, profile.riskWindows ?? []),
    );
    const suggestions = filterBank(SUGGESTION_BANK, profile.suggestionTags ?? [], 3);

    return { profile, patterns, suggestions };
  }

  /**
   * A compact line for the chat assistant's system prompt. Leads with what was
   * observed rather than what was characterised — "dinner is logged 50% of the
   * time" is worth more to a conversation than "habitual eater".
   */
  profileSummaryText(profile: IBehaviorProfile): string {
    const pctOf = (v: number | null | undefined) =>
      v == null ? null : `${Math.round(v * 100)}%`;

    const adherence = (["breakfast", "lunch", "dinner"] as const)
      .map((slot) => {
        const v = (profile.behavior as any)?.[`${slot}Adherence`];
        return v == null ? null : `${slot} ${pctOf(v)}`;
      })
      .filter(Boolean)
      .join(", ");

    const topTriggers = Object.entries(profile.triggerScores ?? {})
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([t, s]) => `${t}(${Math.round((s as number) * 100)}%)`)
      .join(", ");

    const openPatterns = (profile.patterns ?? [])
      .slice(0, 2)
      .map((p: IBehaviorPattern) => p.pattern)
      .join("; ");

    return [
      `Behaviour profile (${profile.confidence}): ${profile.eatingType} eater, emotional-eating risk ${profile.emotionalEatingRisk}.`,
      adherence ? `Plan adherence: ${adherence}.` : "",
      topTriggers ? `Top triggers: ${topTriggers}.` : "",
      openPatterns ? `Open patterns: ${openPatterns}.` : "",
      profile.selfCheck
        ? `Since last time: ${profile.selfCheck.eased} eased, ${profile.selfCheck.resolved} resolved, ${profile.selfCheck.holds} unchanged.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /** Full rebuild on demand, for the sync endpoint. */
  async sync(userId: string) {
    await this.refreshScores(userId);
    await this.refreshProfile(userId);
    return this.getProfileWithBank(userId);
  }
}
