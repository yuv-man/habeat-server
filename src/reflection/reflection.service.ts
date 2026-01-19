import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { DailyProgress } from "../progress/progress.model";
import { Plan } from "../plan/plan.model";
import { User } from "../user/user.model";
import logger from "../utils/logger";

// Insight templates for positive feedback
const POSITIVE_INSIGHTS = {
  protein: [
    "Great protein intake today! Your muscles are thanking you",
    "You crushed your protein goal! Keep building strength",
    "Excellent protein choices today - recovery mode activated",
  ],
  water: [
    "Hydration hero! Your body is well-fueled",
    "Great job staying hydrated today",
    "Water goal achieved! Your cells are happy",
  ],
  calories: [
    "Perfect calorie balance today - you're on track!",
    "Great job hitting your calorie target",
    "Balanced eating today - your body appreciates it",
  ],
  balance: [
    "Well-balanced macros today! Nutrition pro status",
    "Your macro balance is looking great",
    "Perfectly balanced, as all meals should be",
  ],
  streak: [
    "You're on fire! Keep that streak going",
    "Consistency is key, and you've got it",
    "Another day stronger in your journey",
  ],
  workout: [
    "Workout complete! Endorphins are flowing",
    "You showed up and put in the work today",
    "Exercise done - mind and body aligned",
  ],
  meals: [
    "All meals logged! Tracking champion",
    "Complete day of mindful eating",
    "Full day tracked - awareness is power",
  ],
};

// Weekly improvement messages
const WEEKLY_IMPROVEMENTS = {
  better: [
    "You improved your balance by {percent}%!",
    "Your nutrition game leveled up by {percent}%!",
    "Great progress! {percent}% better than last week",
  ],
  same: [
    "Steady consistency this week - that's the foundation of success",
    "Maintaining your healthy habits like a pro",
    "Rock solid week - you're in a great rhythm",
  ],
  worse: [
    "Every week is a fresh start - you've got this!",
    "Small dips are normal - tomorrow is a new opportunity",
    "Rest weeks matter too - listen to your body",
  ],
};

// Weekly suggestions
const WEEKLY_SUGGESTIONS = {
  protein: "Try adding a protein-rich snack like Greek yogurt or nuts",
  water: "Keep a water bottle at your desk as a visual reminder",
  calories: "Consider meal prepping to stay on track with portions",
  balance: "Mix up your veggies to get a variety of nutrients",
  workout: "Even a 10-minute walk counts - movement matters!",
  consistency: "Set a daily reminder to log your first meal",
};

export interface DailySummary {
  date: string;
  healthScore: number;
  healthScoreChange: number;
  xpEarned: number;
  insight: string;
  emoji: string;
  stats: {
    caloriesPercent: number;
    proteinPercent: number;
    waterPercent: number;
    mealsCompleted: number;
    mealsTotal: number;
    workoutsCompleted: number;
  };
}

export interface WeeklyStory {
  period: { start: string; end: string };
  message: string;
  emoji: string;
  suggestion: string;
  highlights: string[];
  stats: {
    avgHealthScore: number;
    healthScoreChange: number;
    totalXpEarned: number;
    daysTracked: number;
    bestDay: string | null;
    streakDays: number;
  };
}

@Injectable()
export class ReflectionService {
  constructor(
    @InjectModel(DailyProgress.name) private progressModel: Model<any>,
    @InjectModel(Plan.name) private planModel: Model<any>,
    @InjectModel(User.name) private userModel: Model<any>
  ) {}

  /**
   * Calculate health score (0-100) based on daily progress
   */
  calculateHealthScore(progress: any, targets: any): number {
    if (!progress) return 0;

    // Weight factors for different metrics
    const weights = {
      calories: 0.25,
      protein: 0.2,
      water: 0.15,
      meals: 0.2,
      balance: 0.2,
    };

    // Calculate individual scores
    const caloriesScore = this.calculatePercentageScore(
      progress.caloriesConsumed || 0,
      targets.calories,
      true // Penalize both under and over eating
    );

    const proteinScore = this.calculatePercentageScore(
      progress.protein?.consumed || 0,
      targets.protein
    );

    const waterScore = this.calculatePercentageScore(
      progress.water?.consumed || 0,
      targets.water
    );

    // Meals completion score
    const mealsCompleted = this.countCompletedMeals(progress.meals);
    const mealsScore = (mealsCompleted / 4) * 100; // 4 = breakfast, lunch, dinner + at least 1 snack

    // Balance score (how close to ideal macro ratios)
    const balanceScore = this.calculateBalanceScore(progress, targets);

    // Weighted average
    const healthScore =
      caloriesScore * weights.calories +
      proteinScore * weights.protein +
      waterScore * weights.water +
      mealsScore * weights.meals +
      balanceScore * weights.balance;

    return Math.round(Math.min(100, Math.max(0, healthScore)));
  }

  /**
   * Calculate percentage score with optional overeating penalty
   */
  private calculatePercentageScore(
    consumed: number,
    target: number,
    penalizeOver = false
  ): number {
    if (target <= 0) return 50;
    const percent = (consumed / target) * 100;

    if (penalizeOver) {
      // Ideal is 90-110% of target
      if (percent >= 90 && percent <= 110) return 100;
      if (percent < 90) return percent;
      // Penalize over by distance from 110%
      return Math.max(0, 100 - (percent - 110) * 2);
    }

    return Math.min(100, percent);
  }

  /**
   * Calculate macro balance score
   */
  private calculateBalanceScore(progress: any, targets: any): number {
    const proteinRatio =
      targets.protein > 0
        ? (progress.protein?.consumed || 0) / targets.protein
        : 0;
    const carbsRatio =
      targets.carbs > 0 ? (progress.carbs?.consumed || 0) / targets.carbs : 0;
    const fatRatio =
      targets.fat > 0 ? (progress.fat?.consumed || 0) / targets.fat : 0;

    // Average deviation from 1.0 (perfect ratio)
    const avgDeviation =
      (Math.abs(1 - proteinRatio) +
        Math.abs(1 - carbsRatio) +
        Math.abs(1 - fatRatio)) /
      3;

    // Convert to score (0 deviation = 100, 0.5 deviation = 50, etc.)
    return Math.max(0, Math.round((1 - avgDeviation) * 100));
  }

  /**
   * Count completed meals
   */
  private countCompletedMeals(meals: any): number {
    if (!meals) return 0;
    let count = 0;
    if (meals.breakfast?.done) count++;
    if (meals.lunch?.done) count++;
    if (meals.dinner?.done) count++;
    if (meals.snacks?.some((s: any) => s.done)) count++;
    return count;
  }

  /**
   * Get a random item from an array
   */
  private getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Generate positive insight based on today's performance
   */
  private generateInsight(
    progress: any,
    targets: any
  ): { insight: string; emoji: string } {
    const insights: { category: string; score: number }[] = [];

    // Check each category for achievements
    const proteinPercent =
      targets.protein > 0
        ? ((progress.protein?.consumed || 0) / targets.protein) * 100
        : 0;
    if (proteinPercent >= 90) {
      insights.push({ category: "protein", score: proteinPercent });
    }

    const waterPercent =
      targets.water > 0
        ? ((progress.water?.consumed || 0) / targets.water) * 100
        : 0;
    if (waterPercent >= 100) {
      insights.push({ category: "water", score: waterPercent });
    }

    const caloriesPercent =
      targets.calories > 0
        ? ((progress.caloriesConsumed || 0) / targets.calories) * 100
        : 0;
    if (caloriesPercent >= 85 && caloriesPercent <= 115) {
      insights.push({
        category: "calories",
        score: 100 - Math.abs(100 - caloriesPercent),
      });
    }

    const mealsCompleted = this.countCompletedMeals(progress.meals);
    if (mealsCompleted >= 3) {
      insights.push({ category: "meals", score: mealsCompleted * 25 });
    }

    const workoutsCompleted =
      progress.workouts?.filter((w: any) => w.done)?.length || 0;
    if (workoutsCompleted > 0) {
      insights.push({ category: "workout", score: workoutsCompleted * 50 });
    }

    // Pick the best achievement or default to streak
    if (insights.length === 0) {
      return {
        insight: this.getRandomItem(POSITIVE_INSIGHTS.streak),
        emoji: "💪",
      };
    }

    insights.sort((a, b) => b.score - a.score);
    const best = insights[0];
    const insightTexts =
      POSITIVE_INSIGHTS[best.category as keyof typeof POSITIVE_INSIGHTS];

    const emojis: Record<string, string> = {
      protein: "🥩",
      water: "💧",
      calories: "🎯",
      balance: "⚖️",
      workout: "🏋️",
      meals: "🍽️",
      streak: "🔥",
    };

    return {
      insight: this.getRandomItem(insightTexts),
      emoji: emojis[best.category] || "✨",
    };
  }

  /**
   * Get daily summary for a user
   */
  async getDailySummary(userId: string, date?: string): Promise<DailySummary> {
    const targetDate = date ? new Date(date) : new Date();

    const dateKey = targetDate.toISOString().split("T")[0];

    // Get today's progress
    const progress = (await this.progressModel
      .findOne({
        userId,
        dateKey,
      })
      .lean()) as any;

    // Get yesterday's progress for comparison
    const yesterday = new Date(targetDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().split("T")[0];
    const yesterdayProgress = (await this.progressModel
      .findOne({
        userId,
        dateKey: yesterdayKey,
      })
      .lean()) as any;

    // Get user's targets
    const plan = (await this.planModel.findOne({ userId }).lean()) as any;
    const targets = {
      calories: Math.round(plan?.userMetrics?.tdee || 2000),
      protein: Math.round(plan?.userMetrics?.dailyMacros?.protein || 150),
      carbs: Math.round(plan?.userMetrics?.dailyMacros?.carbs || 250),
      fat: Math.round(plan?.userMetrics?.dailyMacros?.fat || 65),
      water: 8,
    };

    // Get user engagement for XP
    const user = (await this.userModel.findById(userId).lean()) as any;
    const engagement = user?.engagement;

    // Calculate health scores
    const healthScore = this.calculateHealthScore(progress, targets);
    const yesterdayScore = this.calculateHealthScore(
      yesterdayProgress,
      targets
    );
    const healthScoreChange = healthScore - yesterdayScore;

    // Generate insight
    const { insight, emoji } = this.generateInsight(progress, targets);

    // Calculate stats
    const caloriesPercent =
      targets.calories > 0
        ? Math.round(
            ((progress?.caloriesConsumed || 0) / targets.calories) * 100
          )
        : 0;
    const proteinPercent =
      targets.protein > 0
        ? Math.round(
            ((progress?.protein?.consumed || 0) / targets.protein) * 100
          )
        : 0;
    const waterPercent =
      targets.water > 0
        ? Math.round(((progress?.water?.consumed || 0) / targets.water) * 100)
        : 0;

    return {
      date: dateKey,
      healthScore,
      healthScoreChange,
      xpEarned: engagement?.xp || 0, // Today's XP (simplified - in real app track daily XP)
      insight,
      emoji,
      stats: {
        caloriesPercent,
        proteinPercent,
        waterPercent,
        mealsCompleted: this.countCompletedMeals(progress?.meals),
        mealsTotal: 4,
        workoutsCompleted:
          progress?.workouts?.filter((w: any) => w.done)?.length || 0,
      },
    };
  }

  /**
   * Generate weekly story for a user
   */
  async getWeeklyStory(userId: string): Promise<WeeklyStory> {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // This week (last 7 days)
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - 6);
    thisWeekStart.setHours(0, 0, 0, 0);

    // Last week (7-14 days ago)
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
    lastWeekEnd.setHours(23, 59, 59, 999);

    // Get user's targets
    const plan = (await this.planModel.findOne({ userId }).lean()) as any;
    const targets = {
      calories: Math.round(plan?.userMetrics?.tdee || 2000),
      protein: Math.round(plan?.userMetrics?.dailyMacros?.protein || 150),
      carbs: Math.round(plan?.userMetrics?.dailyMacros?.carbs || 250),
      fat: Math.round(plan?.userMetrics?.dailyMacros?.fat || 65),
      water: 8,
    };

    // Get this week's progress
    const thisWeekProgress = await this.progressModel
      .find({
        userId,
        date: { $gte: thisWeekStart, $lte: today },
      })
      .lean()
      .sort({ date: 1 });

    // Get last week's progress
    const lastWeekProgress = await this.progressModel
      .find({
        userId,
        date: { $gte: lastWeekStart, $lte: lastWeekEnd },
      })
      .lean();

    // Calculate average health scores
    const thisWeekScores = thisWeekProgress.map((p) =>
      this.calculateHealthScore(p, targets)
    );
    const lastWeekScores = lastWeekProgress.map((p) =>
      this.calculateHealthScore(p, targets)
    );

    const avgThisWeek =
      thisWeekScores.length > 0
        ? Math.round(
            thisWeekScores.reduce((a, b) => a + b, 0) / thisWeekScores.length
          )
        : 0;
    const avgLastWeek =
      lastWeekScores.length > 0
        ? Math.round(
            lastWeekScores.reduce((a, b) => a + b, 0) / lastWeekScores.length
          )
        : 0;

    const healthScoreChange = avgThisWeek - avgLastWeek;
    const percentChange =
      avgLastWeek > 0 ? Math.round((healthScoreChange / avgLastWeek) * 100) : 0;

    // Generate message based on performance
    let messageTemplate: string;
    let emoji: string;

    if (healthScoreChange > 5) {
      messageTemplate = this.getRandomItem(WEEKLY_IMPROVEMENTS.better).replace(
        "{percent}",
        Math.abs(percentChange).toString()
      );
      emoji = "🎉";
    } else if (healthScoreChange >= -5) {
      messageTemplate = this.getRandomItem(WEEKLY_IMPROVEMENTS.same);
      emoji = "💪";
    } else {
      messageTemplate = this.getRandomItem(WEEKLY_IMPROVEMENTS.worse);
      emoji = "🌱";
    }

    // Determine suggestion based on weakest area
    let suggestion = WEEKLY_SUGGESTIONS.consistency;
    const avgProtein =
      thisWeekProgress.reduce(
        (acc, p: any) => acc + (p.protein?.consumed || 0) / targets.protein,
        0
      ) / Math.max(1, thisWeekProgress.length);
    const avgWater =
      thisWeekProgress.reduce(
        (acc, p: any) => acc + (p.water?.consumed || 0) / targets.water,
        0
      ) / Math.max(1, thisWeekProgress.length);

    if (avgProtein < 0.8) {
      suggestion = WEEKLY_SUGGESTIONS.protein;
    } else if (avgWater < 0.8) {
      suggestion = WEEKLY_SUGGESTIONS.water;
    }

    // Generate highlights
    const highlights: string[] = [];

    // Best day
    let bestDayIndex = 0;
    let bestScore = 0;
    thisWeekScores.forEach((score, i) => {
      if (score > bestScore) {
        bestScore = score;
        bestDayIndex = i;
      }
    });

    if (thisWeekProgress.length > 0 && bestScore > 0) {
      const bestDay = new Date((thisWeekProgress[bestDayIndex] as any).date);
      const dayName = bestDay.toLocaleDateString("en-US", { weekday: "long" });
      highlights.push(
        `${dayName} was your best day with a ${bestScore} health score`
      );
    }

    // Streak info
    const user = await this.userModel.findById(userId).lean();
    const streak = (user as any)?.engagement?.streakDays || 0;
    if (streak >= 3) {
      highlights.push(`You're on a ${streak}-day streak!`);
    }

    // Days tracked
    if (thisWeekProgress.length >= 5) {
      highlights.push(
        `You tracked ${thisWeekProgress.length} out of 7 days this week`
      );
    }

    return {
      period: {
        start: thisWeekStart.toISOString().split("T")[0],
        end: today.toISOString().split("T")[0],
      },
      message: messageTemplate,
      emoji,
      suggestion,
      highlights,
      stats: {
        avgHealthScore: avgThisWeek,
        healthScoreChange,
        totalXpEarned: 0, // Would need to track daily XP gains
        daysTracked: thisWeekProgress.length,
        bestDay:
          thisWeekProgress.length > 0
            ? new Date((thisWeekProgress[bestDayIndex] as any).date)
                .toISOString()
                .split("T")[0]
            : null,
        streakDays: streak,
      },
    };
  }
}
