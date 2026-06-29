import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { IEatingProfile, EatingProfile } from "./eating-profile.model";
import { MealMoodCorrelation, IMealMoodCorrelation, MoodEntry, IMoodEntry } from "../cbt/cbt.model";
import { IUserData } from "../types/interfaces";
import { User } from "../user/user.model";
import { callGeminiWithRateLimit } from "../utils/gemini-rate-limiter";
import { loadKnowledge } from "../../../knowledge/loader";
import logger from "../utils/logger";

// ─── Gemini system prompt (send once per context cache TTL) ─────────────────

const SYSTEM_PROMPT = `You are an eating behavior analyst. Analyze the user data snapshot and return ONLY valid JSON matching the output schema. Be precise. No explanations outside the JSON.

OUTPUT SCHEMA:
{"eatingType":"mindful"|"emotional"|"habitual"|"social"|"mixed","emotionalEatingRisk":"low"|"medium"|"high","triggerScores":{"<trigger>":0.0},"riskWindows":[{"dayOfWeek":0,"hourStart":0,"hourEnd":0,"risk":"medium"|"high"}],"bestMeals":[{"mealName":"","avgMoodLift":0.0}],"patternTags":[],"suggestionTags":[],"nutritionTendency":{"calorieAccuracy":"under"|"on-target"|"over","macroWeakness":"protein"|"fiber"|"healthy-fats"|null},"reasoning":""}

VALID PATTERN TAGS: late-night-snacker,stress-eater,mindful-breakfast,social-overeater,boredom-grazer,emotional-dinner,consistent-logger,weekend-spiral,mindful-lunch,habitual-snacker,mood-responsive,celebration-eater,tiredness-eater,anxiety-eater

VALID SUGGESTION TAGS: needs-urge-surfing,needs-breathing,needs-body-scan,high-protein-morning,reduce-evening-snacks,meal-pacing,hunger-check,pre-meal-pause,social-mindfulness,weekend-planning,stress-alternative,mood-meal-link,celebrate-without-food

reasoning: max 20 words describing the dominant pattern. Return ONLY the JSON object.`;

// ─── KYC → tag maps (Tier 0 seed, no AI) ────────────────────────────────────

const KYC_PATTERN_TAGS: Record<string, string[]> = {
  "very-emotional":    ["stress-eater", "emotional-dinner"],
  "sometimes-emotional": ["mood-responsive"],
  fuel:                ["mindful-breakfast"],
  unsure:              [],
};

const KYC_SUGGESTION_TAGS: Record<string, string[]> = {
  "very-emotional":    ["needs-urge-surfing", "needs-breathing", "hunger-check", "mood-meal-link"],
  "sometimes-emotional": ["hunger-check", "pre-meal-pause", "mood-meal-link"],
  fuel:                ["meal-pacing", "mood-meal-link"],
  unsure:              ["mood-meal-link", "hunger-check"],
};

const EMOTIONAL_TRIGGER_TO_SUGGESTION: Record<string, string> = {
  stress:         "needs-breathing",
  boredom:        "needs-urge-surfing",
  sadness:        "needs-body-scan",
  anxiety:        "needs-breathing",
  habit:          "pre-meal-pause",
  social:         "social-mindfulness",
  tiredness:      "stress-alternative",
  procrastination:"pre-meal-pause",
  "late-night":   "reduce-evening-snacks",
  celebration:    "celebrate-without-food",
};

@Injectable()
export class EatingProfileAgent {
  constructor(
    @InjectModel(EatingProfile.name) private profileModel: Model<IEatingProfile>,
    @InjectModel(MealMoodCorrelation.name) private correlationModel: Model<IMealMoodCorrelation>,
    @InjectModel(MoodEntry.name) private moodModel: Model<IMoodEntry>,
    @InjectModel(User.name) private userModel: Model<IUserData>,
  ) {}

  // ── Tier 0: seed from KYC (no AI) ────────────────────────────────────────

  async seed(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) return;

    const rel = (user as any).foodRelationship ?? "unsure";
    const kycTriggers: string[] = (user as any).emotionalTriggers ?? [];

    const patternTags: string[] = [...(KYC_PATTERN_TAGS[rel] ?? [])];
    const suggestionTags: string[] = [...(KYC_SUGGESTION_TAGS[rel] ?? [])];

    kycTriggers.forEach((t) => {
      const tag = EMOTIONAL_TRIGGER_TO_SUGGESTION[t];
      if (tag && !suggestionTags.includes(tag)) suggestionTags.push(tag);
    });

    await this.profileModel.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      {
        $setOnInsert: { userId: new mongoose.Types.ObjectId(userId) },
        $set: {
          confidence: "seed",
          patternTags,
          suggestionTags,
          generatedAt: new Date(),
          version: 1,
          dataSnapshot: { meals: 0, moodLogs: 0, correlations: 0 },
        },
      },
      { upsert: true, new: true }
    );

    logger.info(`[EatingProfileAgent] Seed profile created for user ${userId}`);
  }

  // ── Rule-based refresh: updates triggerScores + riskWindows from raw data ──

  async refreshScores(userId: string): Promise<void> {
    const correlations = await this.correlationModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .lean()
      .exec();

    if (correlations.length === 0) return;

    const MOOD_TO_TRIGGER: Record<string, string> = {
      stressed: "stress", anxious: "anxiety", sad: "sadness",
      tired: "tiredness", angry: "stress", neutral: "habit",
    };

    // Compute trigger scores
    const triggerCounts: Record<string, number> = {};
    const emotionalTotal = correlations.filter((c) => c.wasEmotionalEating).length;

    correlations
      .filter((c) => c.wasEmotionalEating && c.moodBefore?.moodCategory)
      .forEach((c) => {
        const trigger = MOOD_TO_TRIGGER[c.moodBefore!.moodCategory];
        if (trigger) triggerCounts[trigger] = (triggerCounts[trigger] ?? 0) + 1;
      });

    const triggerScores: Record<string, number> = {};
    Object.entries(triggerCounts).forEach(([t, count]) => {
      triggerScores[t] = emotionalTotal > 0
        ? Math.round((count / emotionalTotal) * 100) / 100
        : 0;
    });

    // Compute risk windows: bucket emotional correlations by hour + day
    const windowCounts: Record<string, { count: number; total: number }> = {};
    correlations.forEach((c) => {
      const hour = new Date(c.createdAt).getHours();
      const dow = new Date(c.createdAt).getDay();
      const hourBucket = Math.floor(hour / 3) * 3;
      const key = `${dow}-${hourBucket}`;
      if (!windowCounts[key]) windowCounts[key] = { count: 0, total: 0 };
      windowCounts[key].total++;
      if (c.wasEmotionalEating) windowCounts[key].count++;
    });

    const riskWindows = Object.entries(windowCounts)
      .filter(([, v]) => v.total >= 2 && v.count / v.total >= 0.5)
      .map(([key, v]) => {
        const [dow, hourStart] = key.split("-").map(Number);
        const rate = v.count / v.total;
        return {
          dayOfWeek: dow,
          hourStart,
          hourEnd: hourStart + 3,
          risk: (rate >= 0.75 ? "high" : "medium") as "high" | "medium",
        };
      })
      .slice(0, 5);

    await this.profileModel.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      { $set: { triggerScores, riskWindows } }
    );
  }

  // ── Tier 1 / 2: full AI analysis ─────────────────────────────────────────

  async run(userId: string): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error("[EatingProfileAgent] GEMINI_API_KEY not set");
      return;
    }

    const [user, correlations, moodLogs, profile] = await Promise.all([
      this.userModel.findById(userId).lean().exec(),
      this.correlationModel
        .find({ userId: new mongoose.Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .limit(60)
        .lean()
        .exec(),
      this.moodModel
        .find({ userId: new mongoose.Types.ObjectId(userId) })
        .sort({ date: -1 })
        .limit(30)
        .lean()
        .exec(),
      this.profileModel.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean().exec(),
    ]);

    if (!user) return;

    const snapshot = this.buildSnapshot(user, correlations, moodLogs);
    const prompt = `${SYSTEM_PROMPT}\n\nUSER DATA:\n${JSON.stringify(snapshot)}`;

    try {
      const knowledge = loadKnowledge("eating-profile", { maxTokens: 1400 });
      const fullPrompt = knowledge ? `${knowledge}\n\n---\n\n${prompt}` : prompt;

      const raw = await callGeminiWithRateLimit(
        apiKey,
        "gemini-2.0-flash",
        async (model) => {
          const result = await model.generateContent([{ text: fullPrompt }]);
          if (!result?.response) throw new Error("Empty response");
          return result.response.text();
        },
        { context: "EatingProfileAgent", maxRetries: 3 }
      );

      const parsed = this.parseAgentResponse(raw);
      if (!parsed) {
        logger.warn(`[EatingProfileAgent] Failed to parse response for ${userId}`);
        return;
      }

      const totalCorrelations = await this.correlationModel.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
      });
      const confidence = totalCorrelations >= 30 ? "high"
        : totalCorrelations >= 15 ? "medium"
        : "low";

      await this.profileModel.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        {
          $setOnInsert: { userId: new mongoose.Types.ObjectId(userId) },
          $set: {
            ...parsed,
            confidence,
            generatedAt: new Date(),
            version: (profile?.version ?? 0) + 1,
            lastCorrelationCount: totalCorrelations,
            dataSnapshot: {
              meals: correlations.length,
              moodLogs: moodLogs.length,
              correlations: totalCorrelations,
            },
          },
        },
        { upsert: true, new: true }
      );

      logger.info(`[EatingProfileAgent] Profile updated for user ${userId} (confidence=${confidence})`);
    } catch (err) {
      logger.error(`[EatingProfileAgent] Analysis failed for ${userId}: ${err}`);
    }
  }

  async runForAllEligibleUsers(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);

    const profiles = await this.profileModel
      .find({
        "dataSnapshot.correlations": { $gte: 5 },
        generatedAt: { $lt: cutoff },
      })
      .lean()
      .exec();

    logger.info(`[EatingProfileAgent] Scheduled run: ${profiles.length} eligible users`);
    for (const p of profiles) {
      await this.run(p.userId.toString());
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildSnapshot(
    user: any,
    correlations: IMealMoodCorrelation[],
    moodLogs: IMoodEntry[]
  ) {
    const emotionalCount = correlations.filter((c) => c.wasEmotionalEating).length;
    const eePct = correlations.length > 0
      ? Math.round((emotionalCount / correlations.length) * 100)
      : 0;
    const avgMood = moodLogs.length > 0
      ? Math.round((moodLogs.reduce((s, m) => s + m.moodLevel, 0) / moodLogs.length) * 10) / 10
      : 0;

    // Best meals by mood lift
    const mealLifts: Record<string, { total: number; count: number }> = {};
    correlations.forEach((c) => {
      if (c.moodBefore && c.moodAfter) {
        const lift = c.moodAfter.moodLevel - c.moodBefore.moodLevel;
        if (!mealLifts[c.mealName]) mealLifts[c.mealName] = { total: 0, count: 0 };
        mealLifts[c.mealName].total += lift;
        mealLifts[c.mealName].count++;
      }
    });
    const bestMeals = Object.entries(mealLifts)
      .map(([n, v]) => ({ n, lift: Math.round((v.total / v.count) * 10) / 10 }))
      .filter((m) => m.lift > 0)
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 3);

    // Macro accuracy
    const caloriesRatios = correlations
      .filter((c) => (c as any).actualCalories && (c as any).targetCalories)
      .map((c) => (c as any).actualCalories / (c as any).targetCalories);
    const avgCalorieRatio = caloriesRatios.length > 0
      ? caloriesRatios.reduce((s, r) => s + r, 0) / caloriesRatios.length
      : null;

    // Top emotions
    const emotionCounts: Record<string, number> = {};
    correlations.forEach((c) => {
      if (c.moodBefore?.moodCategory) {
        emotionCounts[c.moodBefore.moodCategory] = (emotionCounts[c.moodBefore.moodCategory] ?? 0) + 1;
      }
    });
    const topEmotions = Object.entries(emotionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([e]) => e);

    // Recent correlations (compact, last 60)
    const recentCorrelations = correlations.slice(0, 60).map((c) => ({
      mt: c.mealType,
      h: new Date(c.createdAt).getHours(),
      dow: new Date(c.createdAt).getDay(),
      ee: c.wasEmotionalEating,
      mood: c.moodBefore?.moodCategory ?? null,
    }));

    return {
      kyc: {
        rel: user.foodRelationship ?? "unsure",
        triggers: user.emotionalTriggers ?? [],
        diet: user.path ?? user.dietType ?? "healthy",
      },
      stats: {
        correlations: correlations.length,
        eePct,
        avgMood,
        totalMeals: correlations.length,
      },
      topEmotions,
      recentCorrelations,
      bestMeals,
      macroAccuracy: avgCalorieRatio != null
        ? { calories: Math.round(avgCalorieRatio * 100) / 100 }
        : null,
    };
  }

  private parseAgentResponse(raw: string): Partial<IEatingProfile> | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        eatingType: parsed.eatingType,
        emotionalEatingRisk: parsed.emotionalEatingRisk,
        triggerScores: parsed.triggerScores ?? {},
        riskWindows: parsed.riskWindows ?? [],
        bestMeals: parsed.bestMeals ?? [],
        patternTags: parsed.patternTags ?? [],
        suggestionTags: parsed.suggestionTags ?? [],
        nutritionTendency: parsed.nutritionTendency ?? {
          calorieAccuracy: "on-target",
          macroWeakness: null,
        },
      };
    } catch {
      return null;
    }
  }
}
