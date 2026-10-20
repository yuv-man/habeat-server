import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AnalyticsService } from "../analytics/analytics.service";
import { EngagementService } from "../engagement/engagement.service";
import { User } from "../user/user.model";
import { getLocalDateKey } from "../utils/helpers";
import logger from "../utils/logger";
import { ChallengeProgram } from "./content/program.types";
import { ChallengeEnrollment, IChallengeEnrollment } from "./enrollment.model";
import { journeyCoachSection } from "./coach-context";
import {
  ActionInput,
  ActionResult,
  EnrollmentRuleError,
  completionLabel,
  countCoreDaysDone,
  isCurrentDayOpen,
  newEnrollmentState,
  recordAction,
  recordLesson,
  resolveDay,
  shouldWelcomeBack,
  stageForDay,
  tipsForDay,
  writtenThrough,
} from "./enrollment.rules";
import { getProgram, listPrograms } from "./program.registry";

const TIER_RANK: Record<string, number> = { free: 0, plus: 1, premium: 2 };
const PAYING_STATUSES = ["active", "trialing"];
const PREVIEW_DAYS = 3;

export type MealEvent = { source: "meal_log" | "swap"; mealName?: string };

/** Program fields safe to show before enrolling (no lesson bodies past the preview). */
export function programSummary(p: ChallengeProgram) {
  return {
    id: p.id,
    version: p.version,
    title: p.title,
    tagline: p.tagline,
    description: p.description,
    audience: p.audience,
    learningOutcomes: p.learningOutcomes,
    durationDays: p.durationDays,
    dailyMinutes: p.dailyMinutes,
    access: p.access,
    stages: p.stages.map(({ id, title, purpose, days }) => ({ id, title, purpose, days })),
    milestones: p.milestones.map(({ id, afterDay, title }) => ({ id, afterDay, title })),
    writtenThrough: writtenThrough(p),
  };
}

@Injectable()
export class EnrollmentService {
  constructor(
    @InjectModel(ChallengeEnrollment.name)
    private enrollmentModel: Model<IChallengeEnrollment>,
    @InjectModel(User.name) private userModel: Model<any>,
    @Inject(forwardRef(() => EngagementService))
    private engagementService: EngagementService,
    @Optional() private analyticsService?: AnalyticsService,
  ) {}

  // ── Programs ──────────────────────────────────────────────────────────────

  listPrograms() {
    return listPrograms().map(programSummary);
  }

  getPreview(programId: string) {
    const program = getProgram(programId);
    if (!program) throw new NotFoundException("Program not found");
    return {
      ...programSummary(program),
      previewDays: program.days
        .filter((d) => d.day <= PREVIEW_DAYS)
        .map((d) => resolveDay(program, d.day, {})!)
        .map(({ day, stageId, focus, minutes, lesson, action }) => ({ day, stageId, focus, minutes, lesson, action })),
      // What the user keeps once the program ends, so the welcome page can say it up front.
      afterwards: program.afterwards ? { independent: program.afterwards.independent } : undefined,
    };
  }

  // ── Enrollment lifecycle ──────────────────────────────────────────────────

  async enroll(
    userId: string,
    programId: string,
    today: string,
    options: { continueFromLeft?: boolean } = {},
  ) {
    const program = getProgram(programId);
    if (!program) throw new NotFoundException("Program not found");
    await this.assertAccess(userId, program);

    const live = await this.enrollmentModel.findOne({ userId, status: { $in: ["active", "paused"] } });
    if (live) {
      throw new ConflictException("You already have a challenge in progress. Leave it first to start another.");
    }

    const now = new Date();
    const state = newEnrollmentState(program, today, now);
    let continuedFrom: string | undefined;

    // Rejoining a program they left: carry answers and the day pointer over (§3.3).
    if (options.continueFromLeft) {
      const left = await this.enrollmentModel
        .findOne({ userId, programId, status: "left" })
        .sort({ leftAt: -1 });
      if (left && left.programVersion === program.version) {
        state.currentDay = left.currentDay;
        state.answers = { ...(left.answers ?? {}) };
        state.days = left.days.map((d: any) => ({ ...(d.toObject?.() ?? d) }));
        state.milestones = [...left.milestones];
        continuedFrom = String(left._id);
      }
    }

    let enrollment: IChallengeEnrollment;
    try {
      enrollment = await this.enrollmentModel.create({
        userId,
        programId: program.id,
        programVersion: program.version,
        startedAt: now,
        totalPausedMs: 0,
        continuedFrom,
        ...state,
      });
    } catch (err: any) {
      // Lost a race with another enroll request: the partial unique index caught it.
      if (err?.code === 11000) throw new ConflictException("You already have a challenge in progress.");
      throw err;
    }

    this.track(userId, "challenge_enrolled", enrollment, { continued: !!continuedFrom });
    return this.toView(enrollment, program, today);
  }

  async getActive(userId: string, today: string) {
    const enrollment = await this.findLive(userId);
    if (!enrollment) return null;
    return this.toView(enrollment, this.programOf(enrollment), today);
  }

  /**
   * The coach's section about the user's live journey, or null when they
   * aren't in one. Never throws: the coach must work without it.
   */
  async coachSection(userId: string, today: string = getLocalDateKey(new Date())): Promise<string | null> {
    try {
      const enrollment = await this.findLive(userId);
      if (!enrollment) return null;
      return journeyCoachSection(this.programOf(enrollment), enrollment, today);
    } catch (err: any) {
      logger.warn(`[Enrollment] coach context failed for ${userId}: ${err.message}`);
      return null;
    }
  }

  async getHistory(userId: string) {
    const enrollments = await this.enrollmentModel
      .find({ userId, status: { $in: ["completed", "left"] } })
      .sort({ updatedAt: -1 })
      .limit(50);
    return enrollments.map((e) => {
      const program = this.programOf(e);
      return {
        id: String(e._id),
        programId: e.programId,
        programVersion: e.programVersion,
        title: program.title,
        status: e.status,
        result: e.status === "completed" ? completionLabel(e, program) : undefined,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        leftAt: e.leftAt,
        currentDay: e.currentDay,
        coreDaysDone: countCoreDaysDone(e),
        milestones: e.milestones,
      };
    });
  }

  async recordLesson(userId: string, enrollmentId: string, day: number, event: "opened" | "read", today: string) {
    const enrollment = await this.findOwned(userId, enrollmentId);
    const program = this.programOf(enrollment);
    const first = event === "read" && !enrollment.days.find((d) => d.day === day)?.lessonReadAt;
    this.applyRules(() => recordLesson(enrollment, program, day, event, today, new Date()));
    enrollment.markModified("days");
    await enrollment.save();
    if (first) this.track(userId, "challenge_lesson_read", enrollment, { day });
    return this.toView(enrollment, program, today);
  }

  /**
   * One day the user has reached, with what they answered: for reviewing a
   * finished activity. Days not reached yet stay hidden.
   */
  async getDay(userId: string, enrollmentId: string, day: number) {
    const enrollment = await this.findOwned(userId, enrollmentId);
    const program = this.programOf(enrollment);
    if (!Number.isInteger(day) || day < 1 || day > enrollment.currentDay) {
      throw new NotFoundException("Day not reached yet");
    }
    const content = resolveDay(program, day, enrollment.answers ?? {});
    if (!content) throw new NotFoundException("Day not written yet");
    const stage = stageForDay(program, day);
    return {
      day,
      stage: stage && { id: stage.id, title: stage.title },
      content: { ...content, aiGuidance: undefined },
      state: enrollment.days.find((d) => d.day === day) ?? { day, actionStatus: "not_started" },
    };
  }

  async recordAction(userId: string, enrollmentId: string, day: number, input: ActionInput, today: string) {
    const enrollment = await this.findOwned(userId, enrollmentId);
    return this.applyAction(enrollment, day, input, today);
  }

  async pause(userId: string, enrollmentId: string, today: string) {
    const enrollment = await this.findOwned(userId, enrollmentId);
    if (enrollment.status !== "active") throw new BadRequestException(`Challenge is ${enrollment.status}`);
    enrollment.status = "paused";
    enrollment.pausedAt = new Date();
    await enrollment.save();
    this.track(userId, "challenge_paused", enrollment);
    return this.toView(enrollment, this.programOf(enrollment), today);
  }

  async resume(userId: string, enrollmentId: string, today: string) {
    const enrollment = await this.findOwned(userId, enrollmentId);
    if (enrollment.status !== "paused") throw new BadRequestException(`Challenge is ${enrollment.status}`);
    const now = new Date();
    enrollment.totalPausedMs += enrollment.pausedAt ? now.getTime() - enrollment.pausedAt.getTime() : 0;
    enrollment.pausedAt = undefined;
    enrollment.status = "active";
    // Coming back from a pause should never make the user wait another day.
    if (enrollment.dayUnlockedOn > today) enrollment.dayUnlockedOn = today;
    enrollment.lastActivityAt = now;
    await enrollment.save();
    this.track(userId, "challenge_resumed", enrollment);
    return this.toView(enrollment, this.programOf(enrollment), today);
  }

  async leave(userId: string, enrollmentId: string) {
    const enrollment = await this.findOwned(userId, enrollmentId);
    if (enrollment.status !== "active" && enrollment.status !== "paused") {
      throw new BadRequestException(`Challenge is ${enrollment.status}`);
    }
    enrollment.status = "left";
    enrollment.leftAt = new Date();
    await enrollment.save();
    this.track(userId, "challenge_left", enrollment);
    return { id: String(enrollment._id), status: enrollment.status };
  }

  /**
   * Called from the meal-done and swap paths. Completes today's `meal_logged`
   * day when the event matches it; does nothing otherwise. Never throws — a
   * meal tick must not fail because of the journey.
   */
  async onMealEvent(userId: string, event: MealEvent, today: string = getLocalDateKey(new Date())) {
    try {
      const enrollment = await this.enrollmentModel.findOne({ userId, status: "active" });
      if (!enrollment || !isCurrentDayOpen(enrollment, today)) return;
      const program = this.programOf(enrollment);
      const content = program.days.find((d) => d.day === enrollment.currentDay);
      const auto = content?.action.kind === "meal_logged" ? content.action.autoComplete : undefined;
      if (!auto || auto.source !== event.source) return;

      const entry = enrollment.days.find((d) => d.day === enrollment.currentDay);
      if (entry && ["done", "partly", "skipped"].includes(entry.actionStatus)) return;

      if (auto.matchAnswer) {
        const expected = enrollment.answers?.[auto.matchAnswer];
        if (!dishMatches(expected, event.mealName)) return;
      }

      await this.applyAction(
        enrollment,
        enrollment.currentDay,
        { status: "done", source: event.source, answer: event.mealName },
        today,
      );
    } catch (err: any) {
      logger.warn(`[Enrollment] onMealEvent failed for ${userId}: ${err.message}`);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async applyAction(enrollment: IChallengeEnrollment, day: number, input: ActionInput, today: string) {
    const program = this.programOf(enrollment);
    const result: ActionResult = this.applyRules(() =>
      recordAction(enrollment, program, day, input, today, new Date()),
    );
    enrollment.markModified("days");
    enrollment.markModified("answers");
    enrollment.markModified("milestones");
    await enrollment.save();

    const userId = enrollment.userId;
    const event = input.status === "started" ? "challenge_action_started" : "challenge_action_completed";
    this.track(userId, event, enrollment, { day, status: input.status, source: input.source ?? "manual" });

    const badges = [];
    for (const m of result.milestonesReached) {
      this.track(userId, "challenge_milestone_reached", enrollment, { day, milestone_id: m.id });
      if (m.badgeId) {
        const badge = await this.engagementService.awardBadge(userId, m.badgeId).catch((err) => {
          logger.warn(`[Enrollment] Badge ${m.badgeId} not awarded: ${err.message}`);
          return null;
        });
        if (badge) badges.push(badge);
      }
    }
    if (result.finished) {
      this.track(userId, "challenge_completed", enrollment, {
        core_days_done: result.finished.coreDaysDone,
        result: result.finished.completed ? "completed" : "finished",
      });
    }

    return {
      ...this.toView(enrollment, program, today),
      result: {
        advanced: result.advanced,
        milestonesReached: result.milestonesReached.map(({ id, title }) => ({ id, title })),
        badges,
        finished: result.finished,
      },
    };
  }

  private applyRules<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof EnrollmentRuleError) {
        if (["not_active", "locked", "not_reached", "not_written"].includes(err.code)) {
          throw new ConflictException({ message: err.message, code: err.code });
        }
        throw new BadRequestException({ message: err.message, code: err.code });
      }
      throw err;
    }
  }

  private async assertAccess(userId: string, program: ChallengeProgram) {
    if (program.access === "free") return;
    const user = await this.userModel.findById(userId).select("subscriptionTier subscriptionStatus").lean();
    const tier = PAYING_STATUSES.includes((user as any)?.subscriptionStatus)
      ? (user as any)?.subscriptionTier ?? "free"
      : "free";
    if ((TIER_RANK[tier] ?? 0) < TIER_RANK[program.access]) {
      throw new ForbiddenException({ message: "This challenge needs a subscription", code: "upgrade_required" });
    }
  }

  private async findLive(userId: string) {
    return this.enrollmentModel.findOne({ userId, status: { $in: ["active", "paused"] } });
  }

  private async findOwned(userId: string, enrollmentId: string) {
    if (!/^[a-f\d]{24}$/i.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const enrollment = await this.enrollmentModel.findOne({ _id: enrollmentId, userId });
    if (!enrollment) throw new NotFoundException("Enrollment not found");
    return enrollment;
  }

  private programOf(enrollment: IChallengeEnrollment): ChallengeProgram {
    const program = getProgram(enrollment.programId, enrollment.programVersion);
    if (!program) {
      throw new NotFoundException(`Program ${enrollment.programId} v${enrollment.programVersion} is missing`);
    }
    return program;
  }

  /** What the client renders: the enrollment plus today's resolved day. */
  private toView(enrollment: IChallengeEnrollment, program: ChallengeProgram, today: string) {
    const answers = enrollment.answers ?? {};
    const day = enrollment.currentDay;
    const open = isCurrentDayOpen(enrollment, today);
    const stage = stageForDay(program, day);
    const finished = enrollment.status === "completed";
    const content = finished ? undefined : resolveDay(program, day, answers);
    return {
      id: String(enrollment._id),
      program: programSummary(program),
      status: enrollment.status,
      startedAt: enrollment.startedAt,
      completedAt: enrollment.completedAt,
      result: enrollment.status === "completed" ? completionLabel(enrollment, program) : undefined,
      currentDay: day,
      stage: stage && { id: stage.id, title: stage.title, purpose: stage.purpose, brainStage: stage.brainStage },
      today: {
        day,
        open,
        opensOn: open ? undefined : enrollment.dayUnlockedOn,
        content,
        // Reached a day of a long program that isn't written yet: it waits, nothing is lost.
        comingSoon: !finished && !content,
        state: enrollment.days.find((d) => d.day === day) ?? { day, actionStatus: "not_started" },
        tips:
          finished
            ? []
            : tipsForDay(program, day, answers).map(({ id, title, body }) => ({ id, title, body })),
      },
      welcomeBack: shouldWelcomeBack(enrollment, today, getLocalDateKey(enrollment.lastActivityAt)),
      days: enrollment.days.map(({ day: d, actionStatus, lessonReadAt }) => ({
        day: d,
        actionStatus,
        lessonRead: !!lessonReadAt,
      })),
      answers,
      milestones: enrollment.milestones,
      coreDaysDone: countCoreDaysDone(enrollment),
      afterwards: finished ? this.afterwardsView(program) : undefined,
    };
  }

  /** The paths offered once the core program ends, limited to programs that exist. */
  private afterwardsView(program: ChallengeProgram) {
    const a = program.afterwards;
    if (!a) return undefined;
    const exists = (id?: string) => !!id && !!getProgram(id);
    return {
      maintenance: exists(a.maintenanceProgramId) ? programSummary(getProgram(a.maintenanceProgramId!)!) : undefined,
      next: a.nextProgramIds.filter(exists).map((id) => programSummary(getProgram(id)!)),
      independent: a.independent,
    };
  }

  private track(userId: string, event: string, e: IChallengeEnrollment, extra: Record<string, unknown> = {}) {
    this.analyticsService?.capture(userId, event, {
      program_id: e.programId,
      program_version: e.programVersion,
      enrollment_id: String(e._id),
      day: e.currentDay,
      stage: stageForDay(this.programOf(e), e.currentDay)?.id,
      ...extra,
    });
  }
}

/** Loose dish match: the logged meal names the dish the user picked, or vice versa. */
export function dishMatches(expected: unknown, mealName?: string): boolean {
  if (!mealName) return false;
  const names = (Array.isArray(expected) ? expected : [expected]).filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  if (!names.length) return true; // nothing picked yet: any logged meal counts
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const meal = norm(mealName);
  return names.some((n) => {
    const want = norm(n);
    return !!want && (meal.includes(want) || want.includes(meal));
  });
}
