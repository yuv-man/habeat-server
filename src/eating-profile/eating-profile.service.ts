import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { EatingProfile, IEatingProfile } from "./eating-profile.model";
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

    const patterns = filterBank(PATTERN_BANK, profile.patternTags ?? [], 5);
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
      .map((w) => {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return `${days[w.dayOfWeek]} ${w.hourStart}–${w.hourEnd}h`;
      })
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
