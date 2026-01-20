import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "../user/user.model";
import { DailyProgress } from "../progress/progress.model";
import { IWeeklySummary, IUserData, IDailyProgress } from "../types/interfaces";
import { EngagementService } from "./engagement.service";
import logger from "../utils/logger";

// Motivational messages based on consistency score
const MOTIVATIONAL_MESSAGES = {
  excellent: [
    "Amazing consistency! You're building a lifestyle, not just a diet.",
    "Your dedication is inspiring! Keep showing up for yourself.",
    "Excellence in action! Your habits are becoming second nature.",
  ],
  good: [
    "Great work this week! You're building strong foundations.",
    "You're on the right track! Keep that momentum going.",
    "Solid effort! Every week you get closer to your goals.",
  ],
  moderate: [
    "Progress, not perfection. Keep moving forward!",
    "Every step counts. Let's make next week even better!",
    "You're learning what works for you. That's valuable progress.",
  ],
  needsWork: [
    "New week, fresh start! You've got this.",
    "Small steps lead to big changes. Start with just one meal tomorrow.",
    "Habits take time to build. Be patient with yourself.",
  ],
};

// Focus area suggestions
const FOCUS_SUGGESTIONS = {
  lowTracking: "Try setting meal reminders to help you remember to log.",
  lowWater: "Keep a water bottle nearby and take sips throughout the day.",
  missedBreakfast: "A simple breakfast can set a positive tone for your whole day.",
  inconsistentMacros: "Focus on protein first - it helps with satiety and energy.",
  lowConsistency: "Start with just tracking one meal consistently before adding more.",
};

@Injectable()
export class WeeklySummaryService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(DailyProgress.name) private progressModel: Model<IDailyProgress>,
    private engagementService: EngagementService
  ) {}

  /**
   * Generate weekly summary for a user
   */
  async generateWeeklySummary(userId: string): Promise<IWeeklySummary | null> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      return null;
    }

    // Get date range for the past week
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    // Fetch daily progress for the week
    const progressRecords = await this.progressModel.find({
      userId,
      date: { $gte: weekStart, $lte: weekEnd },
    }).sort({ date: 1 });

    // Calculate metrics
    const daysTracked = progressRecords.length;
    const consistencyScore = Math.round((daysTracked / 7) * 100);

    // Calculate nutrition averages
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalWater = 0;
    let calorieGoalHitDays = 0;
    let waterGoalHitDays = 0;
    let bestDayScore = 0;
    let bestDay: string | null = null;

    for (const record of progressRecords) {
      totalCalories += record.caloriesConsumed || 0;
      totalProtein += record.protein?.consumed || 0;
      totalCarbs += record.carbs?.consumed || 0;
      totalFat += record.fat?.consumed || 0;
      totalWater += record.water?.consumed || 0;

      // Check if calorie goal was hit (within 10% of goal)
      if (record.caloriesGoal && record.caloriesConsumed) {
        const ratio = record.caloriesConsumed / record.caloriesGoal;
        if (ratio >= 0.9 && ratio <= 1.1) {
          calorieGoalHitDays++;
        }
      }

      // Check if water goal was hit
      if (record.water?.consumed >= record.water?.goal) {
        waterGoalHitDays++;
      }

      // Calculate day score (% of goals met)
      const dayScore = this.calculateDayScore(record);
      if (dayScore > bestDayScore) {
        bestDayScore = dayScore;
        bestDay = record.dateKey;
      }
    }

    // Calculate averages
    const avgCalories = daysTracked > 0 ? Math.round(totalCalories / daysTracked) : 0;
    const avgProtein = daysTracked > 0 ? Math.round(totalProtein / daysTracked) : 0;
    const avgCarbs = daysTracked > 0 ? Math.round(totalCarbs / daysTracked) : 0;
    const avgFat = daysTracked > 0 ? Math.round(totalFat / daysTracked) : 0;
    const avgWaterGlasses = daysTracked > 0 ? Math.round(totalWater / daysTracked) : 0;

    // Gather achievements (badges earned this week)
    const badges = (user as any).engagement?.badges || [];
    const weekBadges = badges.filter((b: any) => {
      const earnedAt = new Date(b.earnedAt);
      return earnedAt >= weekStart && earnedAt <= weekEnd;
    });
    const achievements = weekBadges.map((b: any) => b.name);

    // Generate motivational message based on consistency
    const motivationalMessage = this.getMotivationalMessage(consistencyScore);

    // Determine focus area for next week
    const focusAreaForNextWeek = this.determineFocusArea(
      daysTracked,
      waterGoalHitDays,
      calorieGoalHitDays,
      consistencyScore
    );

    const summary: IWeeklySummary = {
      weekStart,
      weekEnd,
      daysTracked,
      consistencyScore,
      avgCalories,
      avgProtein,
      avgCarbs,
      avgFat,
      calorieGoalHitDays,
      avgWaterGlasses,
      waterGoalHitDays,
      achievements,
      bestDay,
      motivationalMessage,
      focusAreaForNextWeek,
    };

    // Save summary to user's engagement
    if (!user.engagement) {
      (user as any).engagement = {
        xp: 0,
        level: 1,
        habitScore: 0,
        streakDays: 0,
        longestStreak: 0,
        lastActiveDate: null,
        weeklyConsistency: 0,
        weeklyGoalsHit: 0,
        totalMealsLogged: 0,
        totalDaysTracked: 0,
        badges: [],
        streakFreezeAvailable: true,
        streakFreezeUsedAt: null,
        weeklySummaries: [],
      };
    }

    // Keep only last 12 weekly summaries
    const summaries = (user as any).engagement.weeklySummaries || [];
    summaries.push(summary);
    if (summaries.length > 12) {
      summaries.shift();
    }
    (user as any).engagement.weeklySummaries = summaries;
    (user as any).engagement.lastWeeklySummary = new Date();

    user.markModified("engagement");
    await user.save();

    logger.info(`[WeeklySummary] Generated summary for user ${userId}: ${consistencyScore}% consistency`);

    return summary;
  }

  /**
   * Get the latest weekly summary for a user
   */
  async getLatestSummary(userId: string): Promise<IWeeklySummary | null> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.engagement) {
      return null;
    }

    const summaries = (user as any).engagement.weeklySummaries || [];
    if (summaries.length === 0) {
      return null;
    }

    return summaries[summaries.length - 1];
  }

  /**
   * Check if user should see their weekly summary
   */
  async shouldShowWeeklySummary(userId: string): Promise<boolean> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.engagement) {
      return false;
    }

    const lastSummary = (user as any).engagement.lastWeeklySummary;
    if (!lastSummary) {
      return true; // No summary yet, show one
    }

    // Check if it's been more than 7 days since last summary
    const daysSinceLastSummary = Math.floor(
      (Date.now() - new Date(lastSummary).getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysSinceLastSummary >= 7;
  }

  /**
   * Calculate a day's performance score (0-100)
   */
  private calculateDayScore(progress: IDailyProgress): number {
    let score = 0;
    let factors = 0;

    // Calorie adherence (40%)
    if (progress.caloriesGoal && progress.caloriesConsumed) {
      const ratio = progress.caloriesConsumed / progress.caloriesGoal;
      if (ratio >= 0.9 && ratio <= 1.1) {
        score += 40;
      } else if (ratio >= 0.8 && ratio <= 1.2) {
        score += 30;
      } else if (ratio >= 0.7 && ratio <= 1.3) {
        score += 20;
      }
      factors++;
    }

    // Meals logged (30%)
    const meals = (progress as any).meals;
    let mealsLogged = 0;
    if (meals?.breakfast?.done) mealsLogged++;
    if (meals?.lunch?.done) mealsLogged++;
    if (meals?.dinner?.done) mealsLogged++;
    score += (mealsLogged / 3) * 30;
    factors++;

    // Water intake (30%)
    if (progress.water?.goal && progress.water?.consumed) {
      const waterRatio = progress.water.consumed / progress.water.goal;
      score += Math.min(waterRatio, 1) * 30;
      factors++;
    }

    return factors > 0 ? Math.round(score) : 0;
  }

  /**
   * Get motivational message based on consistency
   */
  private getMotivationalMessage(consistencyScore: number): string {
    let messages: string[];

    if (consistencyScore >= 80) {
      messages = MOTIVATIONAL_MESSAGES.excellent;
    } else if (consistencyScore >= 60) {
      messages = MOTIVATIONAL_MESSAGES.good;
    } else if (consistencyScore >= 40) {
      messages = MOTIVATIONAL_MESSAGES.moderate;
    } else {
      messages = MOTIVATIONAL_MESSAGES.needsWork;
    }

    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * Determine the focus area for next week
   */
  private determineFocusArea(
    daysTracked: number,
    waterGoalHitDays: number,
    calorieGoalHitDays: number,
    consistencyScore: number
  ): string {
    // Priority: consistency > water > meals
    if (consistencyScore < 40) {
      return FOCUS_SUGGESTIONS.lowConsistency;
    }

    if (daysTracked < 4) {
      return FOCUS_SUGGESTIONS.lowTracking;
    }

    if (waterGoalHitDays < 3) {
      return FOCUS_SUGGESTIONS.lowWater;
    }

    if (calorieGoalHitDays < 3) {
      return FOCUS_SUGGESTIONS.inconsistentMacros;
    }

    // If all good, encourage maintaining
    return "Keep doing what you're doing! You're building great habits.";
  }
}
