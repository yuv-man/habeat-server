import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { EatingProfile, IEatingProfile, IRiskWindow } from "./eating-profile.model";
import { formatHourRange, formatDays, WINDOW_HOURS } from "../utils/risk-windows";
import { EatingProfileAgent } from "./eating-profile.agent";
import { PATTERN_BANK, BankPattern } from "./banks/patterns.bank";
import { SUGGESTION_BANK, BankSuggestion } from "./banks/suggestions.bank";
import logger from "../utils/logger";

function filterBank<T extends { tags: string[]; priority: number }>(
  bank: T[],
  profileTags: string[],
  limit: number
): T[] {
  return bank
    .filter((item) => item.tags.some((t) => profileTags.includes(t)))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
}

/**
 * Replace a bank pattern's generic `context` ("After 9 PM") with the window the
 * user's own data actually shows. `refreshScores` already computes these from
 * real timestamps; without this they were computed and then discarded.
 *
 * Windows are day-specific, so we merge those sharing a time-of-day slot into a
 * single "Tue & Thu, 3–6 PM" phrase, preferring high-risk slots.
 */
function applyUserWindow(
  pattern: BankPattern,
  riskWindows: IRiskWindow[]
): BankPattern {
  if (riskWindows.length === 0) return pattern;

  const bySlot = new Map<number, { days: number[]; highRisk: boolean }>();
  for (const w of riskWindows) {
    const slot = bySlot.get(w.hourStart) ?? { days: [], highRisk: false };
    slot.days.push(w.dayOfWeek);
    slot.highRisk ||= w.risk === "high";
    bySlot.set(w.hourStart, slot);
  }

  // Most-evidenced slot wins: high risk first, then the one spanning most days.
  const [hourStart, slot] = [...bySlot.entries()].sort(
    (a, b) =>
      Number(b[1].highRisk) - Number(a[1].highRisk) ||
      b[1].days.length - a[1].days.length ||
      a[0] - b[0]
  )[0];

  const hours = formatHourRange(hourStart, hourStart + WINDOW_HOURS);
  // Naming every day of a near-daily pattern reads worse than "most days".
  const days = slot.days.length <= 3 ? formatDays([...new Set(slot.days)].sort()) : "";

  return {
    ...pattern,
    context: days ? `${days}, ${hours}` : `${hours}, most days`,
  };
}

@Injectable()
export class EatingProfileService {
  constructor(
    @InjectModel(EatingProfile.name) private profileModel: Model<IEatingProfile>,
    private agent: EatingProfileAgent,
  ) {}

  async seed(userId: string): Promise<void> {
    await this.agent.seed(userId);
  }

  async getProfile(userId: string): Promise<IEatingProfile | null> {
    return this.profileModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .lean()
      .exec() as Promise<IEatingProfile | null>;
  }

  async getProfileWithBank(userId: string): Promise<{
    profile: IEatingProfile | null;
    patterns: BankPattern[];
    suggestions: BankSuggestion[];
  }> {
    const profile = await this.getProfile(userId);
    if (!profile) return { profile: null, patterns: [], suggestions: [] };

    const patterns = filterBank(PATTERN_BANK, profile.patternTags ?? [], 5).map(
      (p) => applyUserWindow(p, profile.riskWindows ?? []),
    );
    const suggestions = filterBank(SUGGESTION_BANK, profile.suggestionTags ?? [], 3);

    return { profile, patterns, suggestions };
  }

  // Called after every new meal-mood correlation
  async onNewCorrelation(userId: string): Promise<void> {
    const totalCount = await this.profileModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .select("lastCorrelationCount")
      .lean()
      .exec()
      .then((p) => (p as any)?.lastCorrelationCount ?? 0);

    // Always refresh scores (rule-based, no AI)
    await this.agent.refreshScores(userId);

    // Count actual correlations to decide AI tier
    const correlationCount = await mongoose.connection
      .collection("mealmoodcorrelations")
      .countDocuments({ userId: new mongoose.Types.ObjectId(userId) });

    const newDataPoints = correlationCount - totalCount;

    if (correlationCount === 5) {
      logger.info(`[EatingProfileService] Tier 1 trigger for user ${userId}`);
      this.agent.run(userId).catch((e) =>
        logger.error(`[EatingProfileService] Tier 1 agent error: ${e}`)
      );
    } else if (correlationCount > 5 && newDataPoints >= 10) {
      logger.info(`[EatingProfileService] Tier 2 threshold trigger for user ${userId}`);
      this.agent.run(userId).catch((e) =>
        logger.error(`[EatingProfileService] Tier 2 agent error: ${e}`)
      );
    }

    // Update lastCorrelationCount on profile
    await this.profileModel.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      { $set: { lastCorrelationCount: correlationCount } }
    );
  }

  async sync(userId: string): Promise<{
    profile: IEatingProfile | null;
    patterns: BankPattern[];
    suggestions: BankSuggestion[];
  }> {
    const existing = await this.getProfile(userId);
    if (!existing) {
      await this.agent.seed(userId);
    }
    await this.agent.refreshScores(userId);
    await this.agent.run(userId);
    return this.getProfileWithBank(userId);
  }

  async runScheduledAnalysis(): Promise<void> {
    await this.agent.runForAllEligibleUsers();
  }

  // Returns a compact summary string for injecting into chat context
  profileSummaryText(profile: IEatingProfile): string {
    const topTriggers = Object.entries(profile.triggerScores ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([t, s]) => `${t}(${Math.round(s * 100)}%)`)
      .join(", ");

    const riskSummary = (profile.riskWindows ?? [])
      .filter((w) => w.risk === "high")
      .slice(0, 2)
      .map(
        (w) =>
          `${formatDays([w.dayOfWeek])} ${formatHourRange(w.hourStart, w.hourEnd)}`,
      )
      .join(", ");

    const bestMealNames = (profile.bestMeals ?? [])
      .slice(0, 2)
      .map((m) => m.mealName)
      .join(", ");

    return [
      `Eating profile (${profile.confidence}): ${profile.eatingType} eater, risk=${profile.emotionalEatingRisk}.`,
      topTriggers ? `Top triggers: ${topTriggers}.` : "",
      riskSummary ? `High-risk windows: ${riskSummary}.` : "",
      bestMealNames ? `Best meals: ${bestMealNames}.` : "",
      `Active suggestion tags: ${(profile.suggestionTags ?? []).slice(0, 4).join(", ")}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
}
