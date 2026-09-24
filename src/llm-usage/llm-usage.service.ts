import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import mongoose, { Model } from "mongoose";
import { ILlmUsageDay, LlmUsageDay } from "./llm-usage.model";
import { LlmUsageRecord, setLlmUsageSink } from "../utils/llm-usage";
import { scheduleDailyAt } from "../behavior/behavior.schedule";
import logger from "../utils/logger";

/** Alert when one user's LLM spend over the last 30 days passes this. The
 *  business case holds at a few cents; $0.25 is where something is wrong. */
export const USER_MONTHLY_ALERT_USD = Number(process.env.LLM_USER_MONTHLY_ALERT_USD) || 0.25;
/** Alert when all LLM spend in one day passes this. */
export const DAILY_TOTAL_ALERT_USD = Number(process.env.LLM_DAILY_ALERT_USD) || 20;
/** The budget check runs after the nightly jobs have spent their share. */
const BUDGET_CHECK_HOUR = 7;

const dayKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "DishTuner:gemini-3.6-flash" → "DishTuner": the feature, not the attempt. */
export const featureOf = (context: string): string => context.split(":")[0].trim() || "unknown";

export interface BudgetAlert {
  kind: "user-month" | "daily-total";
  userId?: string;
  costUsd: number;
  limitUsd: number;
}

@Injectable()
export class LlmUsageService implements OnModuleInit, OnModuleDestroy {
  constructor(@InjectModel(LlmUsageDay.name) private usageModel: Model<ILlmUsageDay>) {}

  onModuleInit() {
    setLlmUsageSink((record) => {
      void this.record(record).catch((err) =>
        logger.warn(`[LLMUsage] Could not store usage: ${err?.message ?? err}`),
      );
    });
    if (process.env.NODE_ENV !== "test") {
      scheduleDailyAt(BUDGET_CHECK_HOUR, () => {
        this.checkBudgets().catch((err) => logger.error(`[LLMBudget] Check failed: ${err}`));
      });
    }
  }

  onModuleDestroy() {
    setLlmUsageSink(null);
  }

  async record(r: LlmUsageRecord, when: Date = new Date()): Promise<void> {
    const userId =
      r.userId && mongoose.Types.ObjectId.isValid(r.userId)
        ? new mongoose.Types.ObjectId(r.userId)
        : null;
    await this.usageModel
      .updateOne(
        { date: dayKey(when), userId, feature: featureOf(r.context), model: r.model },
        {
          $inc: {
            calls: 1,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            thinkingTokens: r.thinkingTokens ?? 0,
            costUsd: r.costUsd,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /** Spend over the last `days` days: in total, by feature, and the costliest users. */
  async report(days = 30, top = 20) {
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const match = { date: { $gte: dayKey(since) } };
    const sum = {
      calls: { $sum: "$calls" },
      inputTokens: { $sum: "$inputTokens" },
      outputTokens: { $sum: "$outputTokens" },
      thinkingTokens: { $sum: "$thinkingTokens" },
      costUsd: { $sum: "$costUsd" },
    };
    const [totals, byFeature, byUser, byDay] = await Promise.all([
      this.usageModel.aggregate([{ $match: match }, { $group: { _id: null, ...sum } }]).exec(),
      this.usageModel
        .aggregate([{ $match: match }, { $group: { _id: "$feature", ...sum } }, { $sort: { costUsd: -1 } }])
        .exec(),
      this.usageModel
        .aggregate([
          { $match: { ...match, userId: { $ne: null } } },
          { $group: { _id: "$userId", ...sum } },
          { $sort: { costUsd: -1 } },
          { $limit: top },
        ])
        .exec(),
      this.usageModel
        .aggregate([{ $match: match }, { $group: { _id: "$date", costUsd: { $sum: "$costUsd" } } }, { $sort: { _id: 1 } }])
        .exec(),
    ]);
    const users = await this.usageModel.distinct("userId", { ...match, userId: { $ne: null } }).exec();
    const total = totals[0] ?? { calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0 };
    return {
      days,
      total: { ...total, _id: undefined },
      activeUsers: users.length,
      costPerUserUsd: users.length ? total.costUsd / users.length : 0,
      byFeature: byFeature.map(({ _id, ...rest }) => ({ feature: _id, ...rest })),
      topUsers: byUser.map(({ _id, ...rest }) => ({ userId: String(_id), ...rest })),
      byDay: byDay.map(({ _id, costUsd }) => ({ date: _id, costUsd })),
    };
  }

  /**
   * Who is over budget. Logged as errors so they reach whatever watches the
   * logs; returned so a test or an admin screen can read them.
   */
  async checkBudgets(now: Date = new Date()): Promise<BudgetAlert[]> {
    const since = new Date(now);
    since.setDate(since.getDate() - 29);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const [users, day] = await Promise.all([
      this.usageModel
        .aggregate([
          { $match: { date: { $gte: dayKey(since) }, userId: { $ne: null } } },
          { $group: { _id: "$userId", costUsd: { $sum: "$costUsd" } } },
          { $match: { costUsd: { $gt: USER_MONTHLY_ALERT_USD } } },
          { $sort: { costUsd: -1 } },
        ])
        .exec(),
      this.usageModel
        .aggregate([
          { $match: { date: dayKey(yesterday) } },
          { $group: { _id: null, costUsd: { $sum: "$costUsd" } } },
        ])
        .exec(),
    ]);

    const alerts: BudgetAlert[] = users.map((u) => ({
      kind: "user-month" as const,
      userId: String(u._id),
      costUsd: u.costUsd,
      limitUsd: USER_MONTHLY_ALERT_USD,
    }));
    const dayCost = day[0]?.costUsd ?? 0;
    if (dayCost > DAILY_TOTAL_ALERT_USD) {
      alerts.push({ kind: "daily-total", costUsd: dayCost, limitUsd: DAILY_TOTAL_ALERT_USD });
    }

    for (const a of alerts) {
      logger.error(
        a.kind === "user-month"
          ? `[LLMBudget] User ${a.userId} spent $${a.costUsd.toFixed(3)} on LLM calls in 30 days (alert above $${a.limitUsd})`
          : `[LLMBudget] LLM spend yesterday was $${a.costUsd.toFixed(2)} (alert above $${a.limitUsd})`,
      );
    }
    if (!alerts.length) logger.info("[LLMBudget] All LLM spend within budget");
    return alerts;
  }
}
