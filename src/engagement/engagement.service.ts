import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "../user/user.model";
import { DailyProgress } from "../progress/progress.model";
import { IUserData, IDailyProgress, IBadge } from "../types/interfaces";
import logger from "../utils/logger";

// Habit-focused badge definitions
export const HABIT_BADGES: Record<string, Omit<IBadge, "earnedAt" | "id">> = {
  // Consistency badges
  first_week: {
    name: "First Week",
    description: "Tracked 7 days consistently",
    icon: "calendar-check",
    category: "consistency",
  },
  two_weeks: {
    name: "Two Weeks Strong",
    description: "Maintained a 14-day streak",
    icon: "calendar-days",
    category: "consistency",
  },
  habit_formed: {
    name: "Habit Formed",
    description: "21 days of consistent tracking",
    icon: "sparkles",
    category: "consistency",
  },
  monthly_habit: {
    name: "Monthly Habit",
    description: "30 days of consistency",
    icon: "calendar",
    category: "consistency",
  },
  quarterly_champion: {
    name: "Quarterly Champion",
    description: "90 days of consistency",
    icon: "trophy",
    category: "consistency",
  },

  // Nutrition badges
  balanced_week: {
    name: "Balanced Week",
    description: "Hit macro goals 5+ days this week",
    icon: "scale",
    category: "nutrition",
  },
  protein_pro: {
    name: "Protein Pro",
    description: "Hit protein goal 7 days in a row",
    icon: "dumbbell",
    category: "nutrition",
  },
  veggie_lover: {
    name: "Veggie Lover",
    description: "Logged vegetables for 10 days",
    icon: "leaf",
    category: "nutrition",
  },

  // Hydration badges
  hydration_habit: {
    name: "Hydration Habit",
    description: "Hit water goal for 7 days",
    icon: "droplet",
    category: "hydration",
  },
  hydration_master: {
    name: "Hydration Master",
    description: "Hit water goal for 30 days",
    icon: "droplets",
    category: "hydration",
  },

  // Milestone badges
  first_meal: {
    name: "First Step",
    description: "Logged your first meal",
    icon: "utensils",
    category: "milestone",
  },
  first_goal: {
    name: "Goal Getter",
    description: "Achieved your first personal goal",
    icon: "target",
    category: "milestone",
  },
  meals_100: {
    name: "Dedicated Tracker",
    description: "Logged 100 meals",
    icon: "check-circle",
    category: "milestone",
  },

  // CBT/Mindfulness badges
  mood_explorer: {
    name: "Mood Explorer",
    description: "Logged your first mood entry",
    icon: "smile",
    category: "milestone",
  },
  mood_tracker: {
    name: "Mood Tracker",
    description: "Logged mood for 7 days in a row",
    icon: "heart",
    category: "consistency",
  },
  mood_master: {
    name: "Mood Master",
    description: "Logged mood for 30 days",
    icon: "brain",
    category: "consistency",
  },
  thought_challenger: {
    name: "Thought Challenger",
    description: "Completed 5 thought records",
    icon: "lightbulb",
    category: "milestone",
  },
  cognitive_warrior: {
    name: "Cognitive Warrior",
    description: "Completed 20 thought records",
    icon: "shield",
    category: "milestone",
  },
  mindfulness_starter: {
    name: "Mindfulness Starter",
    description: "Completed your first CBT exercise",
    icon: "leaf",
    category: "milestone",
  },
  mindfulness_habit: {
    name: "Mindfulness Habit",
    description: "Completed 7 CBT exercises",
    icon: "lotus",
    category: "consistency",
  },
  mindfulness_master: {
    name: "Mindfulness Master",
    description: "Completed 30 CBT exercises",
    icon: "sparkles",
    category: "milestone",
  },
  emotional_eater_aware: {
    name: "Emotional Awareness",
    description: "Linked mood to 10 meals",
    icon: "eye",
    category: "milestone",
  },
  mindful_eater: {
    name: "Mindful Eater",
    description: "Practiced mindful eating for 7 meals",
    icon: "utensils-crossed",
    category: "consistency",
  },
  cbt_streak_week: {
    name: "Mindful Week",
    description: "CBT activity every day for a week",
    icon: "flame",
    category: "consistency",
  },
};

// Legacy XP rewards (kept for backward compatibility during migration)
export const XP_REWARDS = {
  MEAL_LOGGED: 10,
  BALANCED_MEAL: 20,
  COMPLETE_DAY: 50,
  WATER_GOAL: 15,
  WORKOUT_COMPLETED: 25,
  STREAK_MILESTONE_7: 100,
  STREAK_MILESTONE_30: 500,
  STREAK_MILESTONE_100: 2000,
  FIRST_MEAL: 50,
} as const;

// Legacy badge definitions (for migration)
export const BADGE_DEFINITIONS = HABIT_BADGES;

@Injectable()
export class EngagementService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>
  ) {}

  /**
   * Get local date key in YYYY-MM-DD format
   */
  private getLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Calculate Habit Score (0-100) based on:
   * - Recent consistency (last 7 days): 30%
   * - Streak length: 25%
   * - Goal achievement rate: 25%
   * - Mindfulness engagement (last 7 days): 20%
   */
  async calculateHabitScore(userId: string): Promise<number> {
    const user = await this.userModel.findById(userId);
    if (!user) return 0;

    // Get recent activity (last 7 days)
    const recentDays = await this.getRecentActivityDays(userId, 7);
    const consistencyScore = (recentDays / 7) * 30;

    // Streak score (maxes out at 30 days)
    const streak = (user as any).engagement?.streakDays || 0;
    const streakScore = Math.min(streak / 30, 1) * 25;

    // Goal achievement rate (last 7 days)
    const goalRate = await this.getGoalAchievementRate(userId, 7);
    const goalScore = goalRate * 25;

    // Mindfulness engagement score (last 7 days)
    const mindfulnessScore = await this.getMindfulnessScore(userId, 7);

    const habitScore = Math.round(consistencyScore + streakScore + goalScore + mindfulnessScore);
    return Math.min(100, Math.max(0, habitScore));
  }

  /**
   * Calculate mindfulness engagement score (0-20) based on CBT activities
   * - Mood tracking: up to 7 points (1 per day)
   * - CBT exercises: up to 7 points (1 per exercise)
   * - Thought records: up to 3 points (1 per record)
   * - Meal-mood correlations: up to 3 points (1 per correlation)
   */
  async getMindfulnessScore(userId: string, days: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = today.toISOString().split("T")[0];

    try {
      // We need to use the User model to access CBT collections
      // For now, we'll estimate based on engagement badges and stats
      const user = await this.userModel.findById(userId);
      if (!user) return 0;

      const badges = (user as any).engagement?.badges || [];
      let score = 0;

      // Award points based on CBT-related badges
      if (badges.some((b: any) => b.id === "mood_explorer")) score += 2;
      if (badges.some((b: any) => b.id === "mood_tracker")) score += 4;
      if (badges.some((b: any) => b.id === "mindfulness_starter")) score += 2;
      if (badges.some((b: any) => b.id === "mindfulness_habit")) score += 4;
      if (badges.some((b: any) => b.id === "thought_challenger")) score += 3;
      if (badges.some((b: any) => b.id === "emotional_eater_aware")) score += 3;
      if (badges.some((b: any) => b.id === "cbt_streak_week")) score += 2;

      return Math.min(20, score);
    } catch (error) {
      logger.warn(`Failed to calculate mindfulness score: ${error}`);
      return 0;
    }
  }

  /**
   * Get number of active days in the last N days
   */
  async getRecentActivityDays(userId: string, days: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);

    const progressRecords = await this.progressModel
      .find({
        userId,
        dateKey: {
          $gte: this.getLocalDateKey(startDate),
          $lte: this.getLocalDateKey(today),
        },
      })
      .select("dateKey meals")
      .lean();

    // Count days with at least one completed meal
    const activeDays = progressRecords.filter((p: any) => {
      const meals = p.meals;
      return (
        meals?.breakfast?.done ||
        meals?.lunch?.done ||
        meals?.dinner?.done ||
        meals?.snacks?.some((s: any) => s.done)
      );
    });

    return activeDays.length;
  }

  /**
   * Get goal achievement rate (percentage of days where calorie goal was hit)
   */
  async getGoalAchievementRate(userId: string, days: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);

    const progressRecords = await this.progressModel
      .find({
        userId,
        dateKey: {
          $gte: this.getLocalDateKey(startDate),
          $lte: this.getLocalDateKey(today),
        },
      })
      .select("caloriesConsumed caloriesGoal")
      .lean();

    if (progressRecords.length === 0) return 0;

    // Count days where calories were within 10% of goal
    const successDays = progressRecords.filter((p: any) => {
      if (!p.caloriesGoal || p.caloriesGoal === 0) return false;
      const ratio = p.caloriesConsumed / p.caloriesGoal;
      return ratio >= 0.85 && ratio <= 1.15; // Within 15% of goal
    });

    return successDays.length / days;
  }

  /**
   * Update weekly consistency metrics
   */
  async updateWeeklyMetrics(userId: string): Promise<{
    weeklyConsistency: number;
    weeklyGoalsHit: number;
  }> {
    const recentDays = await this.getRecentActivityDays(userId, 7);
    const weeklyConsistency = Math.round((recentDays / 7) * 100);

    // Count goals hit this week
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 6); // Last 7 days

    const progressRecords = await this.progressModel
      .find({
        userId,
        dateKey: {
          $gte: this.getLocalDateKey(startDate),
          $lte: this.getLocalDateKey(today),
        },
      })
      .select("caloriesConsumed caloriesGoal water")
      .lean();

    let weeklyGoalsHit = 0;
    for (const p of progressRecords as any[]) {
      // Calorie goal hit
      if (p.caloriesGoal && p.caloriesConsumed >= p.caloriesGoal * 0.9) {
        weeklyGoalsHit++;
      }
      // Water goal hit
      if (p.water?.goal && p.water.consumed >= p.water.goal) {
        weeklyGoalsHit++;
      }
    }

    // Update user
    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        "engagement.weeklyConsistency": weeklyConsistency,
        "engagement.weeklyGoalsHit": weeklyGoalsHit,
      },
    });

    return { weeklyConsistency, weeklyGoalsHit };
  }

  /**
   * Calculate streak from progress records
   */
  async calculateStreak(userId: string): Promise<{
    currentStreak: number;
    longestStreak: number;
    lastActiveDate: string | null;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = this.getLocalDateKey(today);

    const progressRecords = await this.progressModel
      .find({ userId })
      .sort({ dateKey: -1 })
      .select("dateKey meals")
      .lean();

    if (progressRecords.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
    }

    // Filter to only days with at least one completed meal
    const activeDays = progressRecords.filter((p: any) => {
      const meals = p.meals;
      return (
        meals?.breakfast?.done ||
        meals?.lunch?.done ||
        meals?.dinner?.done ||
        meals?.snacks?.some((s: any) => s.done)
      );
    });

    if (activeDays.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
    }

    const lastActiveDate = activeDays[0].dateKey;
    const activeDateSet = new Set(activeDays.map((p: any) => p.dateKey));

    // Calculate current streak
    let currentStreak = 0;
    let checkDate = new Date(today);
    let missedDays = 0;

    if (!activeDateSet.has(todayKey)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (missedDays < 2) {
      const checkKey = this.getLocalDateKey(checkDate);
      if (activeDateSet.has(checkKey)) {
        currentStreak++;
        missedDays = 0;
      } else {
        missedDays++;
        if (currentStreak === 0 && missedDays === 1) {
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
      }
      checkDate.setDate(checkDate.getDate() - 1);
      if (checkDate < new Date("2020-01-01")) break;
    }

    // Calculate longest streak
    let longestStreak = currentStreak;
    let tempStreak = 0;
    let lastKey: string | null = null;

    for (const day of activeDays) {
      if (!lastKey) {
        tempStreak = 1;
        lastKey = day.dateKey;
        continue;
      }

      const currentDate = new Date(day.dateKey);
      const lastDate = new Date(lastKey);
      const diff = Math.floor(
        (lastDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diff === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
      lastKey = day.dateKey;
    }
    longestStreak = Math.max(longestStreak, tempStreak);

    return { currentStreak, longestStreak, lastActiveDate };
  }

  /**
   * Process meal completion - update habit score and check milestones
   */
  async onMealCompleted(
    userId: string,
    mealType: string,
    isBalanced: boolean = false
  ): Promise<{
    habitScore: number;
    newBadges: IBadge[];
    streak: number;
    milestoneReached: string | null;
    // Legacy fields for compatibility
    xpAwarded: number;
    totalXp: number;
    level: number;
    leveledUp: boolean;
  }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Initialize engagement if not exists
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
        lastWeeklySummary: null,
        weeklySummaries: [],
      };
    }

    const newBadges: IBadge[] = [];
    let milestoneReached: string | null = null;
    const todayKey = this.getLocalDateKey(new Date());

    // Check if first meal ever
    const isFirstMeal = (user as any).engagement.totalMealsLogged === 0;
    if (isFirstMeal && !this.hasBadge(user, "first_meal")) {
      const badge = this.createBadge("first_meal");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        milestoneReached = "First Step - You logged your first meal!";
      }
    }

    // Update stats
    (user as any).engagement.totalMealsLogged += 1;
    (user as any).engagement.lastActiveDate = todayKey;

    // Calculate and update streak
    const streakData = await this.calculateStreak(userId);
    (user as any).engagement.streakDays = streakData.currentStreak;
    if (streakData.longestStreak > (user as any).engagement.longestStreak) {
      (user as any).engagement.longestStreak = streakData.longestStreak;
    }

    // Check for consistency milestones
    const streak = streakData.currentStreak;

    if (streak === 7 && !this.hasBadge(user, "first_week")) {
      const badge = this.createBadge("first_week");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        milestoneReached = "First Week - 7 days of consistent tracking!";
      }
    }
    if (streak === 14 && !this.hasBadge(user, "two_weeks")) {
      const badge = this.createBadge("two_weeks");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        milestoneReached = "Two Weeks Strong - Keep building that habit!";
      }
    }
    if (streak === 21 && !this.hasBadge(user, "habit_formed")) {
      const badge = this.createBadge("habit_formed");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        milestoneReached = "Habit Formed - 21 days! This is now part of your routine!";
      }
    }
    if (streak === 30 && !this.hasBadge(user, "monthly_habit")) {
      const badge = this.createBadge("monthly_habit");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        milestoneReached = "Monthly Habit - One month of healthy tracking!";
      }
    }
    if (streak === 90 && !this.hasBadge(user, "quarterly_champion")) {
      const badge = this.createBadge("quarterly_champion");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        milestoneReached = "Quarterly Champion - 90 days of dedication!";
      }
    }

    // Check for meal count milestone
    const mealCount = (user as any).engagement.totalMealsLogged;
    if (mealCount === 100 && !this.hasBadge(user, "meals_100")) {
      const badge = this.createBadge("meals_100");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
        if (!milestoneReached) {
          milestoneReached = "Dedicated Tracker - 100 meals logged!";
        }
      }
    }

    // Calculate habit score
    const habitScore = await this.calculateHabitScore(userId);
    (user as any).engagement.habitScore = habitScore;

    // Update weekly metrics
    await this.updateWeeklyMetrics(userId);

    // Legacy: Also update XP for backward compatibility
    const xpAmount = XP_REWARDS.MEAL_LOGGED + (isBalanced ? XP_REWARDS.BALANCED_MEAL : 0);
    const oldLevel = (user as any).engagement.level || 1;
    (user as any).engagement.xp = ((user as any).engagement.xp || 0) + xpAmount;
    const newLevel = this.calculateLevel((user as any).engagement.xp);
    (user as any).engagement.level = newLevel;

    user.markModified("engagement");
    await user.save();

    logger.info(
      `[EngagementService] Meal completed for user ${userId}. Habit Score: ${habitScore}, Streak: ${streak}`
    );

    return {
      habitScore,
      newBadges,
      streak: streakData.currentStreak,
      milestoneReached,
      // Legacy compatibility
      xpAwarded: xpAmount,
      totalXp: (user as any).engagement.xp,
      level: newLevel,
      leveledUp: newLevel > oldLevel,
    };
  }

  /**
   * Legacy: Calculate level from XP (kept for backward compatibility)
   */
  calculateLevel(xp: number): number {
    return Math.floor(Math.sqrt(xp / 100)) + 1;
  }

  /**
   * Legacy: Award XP (kept for backward compatibility)
   */
  async awardXP(
    userId: string,
    amount: number,
    reason: string
  ): Promise<{
    xpAwarded: number;
    totalXp: number;
    level: number;
    leveledUp: boolean;
    newBadges: IBadge[];
  }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

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
      };
    }

    const oldLevel = (user as any).engagement.level;
    (user as any).engagement.xp += amount;
    const newLevel = this.calculateLevel((user as any).engagement.xp);
    (user as any).engagement.level = newLevel;

    user.markModified("engagement");
    await user.save();

    return {
      xpAwarded: amount,
      totalXp: (user as any).engagement.xp,
      level: newLevel,
      leveledUp: newLevel > oldLevel,
      newBadges: [],
    };
  }

  /**
   * Award a specific badge to a user
   */
  async awardBadge(userId: string, badgeId: string): Promise<IBadge | null> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Check if badge exists in our definitions
    const badgeDefinition = HABIT_BADGES[badgeId];
    if (!badgeDefinition) {
      logger.warn(`[Engagement] Badge not found: ${badgeId}`);
      return null;
    }

    // Check if user already has this badge
    const existingBadges = (user as any).engagement?.badges || [];
    if (existingBadges.some((b: IBadge) => b.id === badgeId)) {
      logger.info(`[Engagement] User ${userId} already has badge: ${badgeId}`);
      return null;
    }

    // Create badge
    const newBadge: IBadge = {
      id: badgeId,
      ...badgeDefinition,
      earnedAt: new Date(),
    };

    // Add badge to user
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
      };
    }

    (user as any).engagement.badges.push(newBadge);
    user.markModified("engagement");
    await user.save();

    logger.info(`[Engagement] Badge awarded: ${badgeId} to user ${userId}`);
    return newBadge;
  }

  /**
   * Check day completion
   */
  async checkDayCompletion(userId: string): Promise<{
    completed: boolean;
    xpAwarded: number;
  }> {
    const todayKey = this.getLocalDateKey(new Date());

    const progress = await this.progressModel.findOne({
      userId,
      dateKey: todayKey,
    });

    if (!progress) {
      return { completed: false, xpAwarded: 0 };
    }

    const meals = (progress as any).meals;
    const allMainMealsComplete =
      meals?.breakfast?.done && meals?.lunch?.done && meals?.dinner?.done;

    if (allMainMealsComplete) {
      const user = await this.userModel.findById(userId);
      if (!user || !user.engagement) return { completed: true, xpAwarded: 0 };

      // Update total days tracked
      (user as any).engagement.totalDaysTracked += 1;

      // Legacy XP
      (user as any).engagement.xp += XP_REWARDS.COMPLETE_DAY;

      user.markModified("engagement");
      await user.save();

      return { completed: true, xpAwarded: XP_REWARDS.COMPLETE_DAY };
    }

    return { completed: false, xpAwarded: 0 };
  }

  /**
   * Get user's engagement stats (habit-focused)
   */
  async getEngagementStats(userId: string): Promise<{
    // Habit-focused stats
    habitScore: number;
    streak: number;
    longestStreak: number;
    weeklyConsistency: number;
    weeklyGoalsHit: number;
    totalMealsLogged: number;
    totalDaysTracked: number;
    badges: IBadge[];
    streakFreezeAvailable: boolean;
    // Legacy fields for compatibility
    xp: number;
    level: number;
    xpProgress: { current: number; required: number };
  }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Initialize engagement if not exists
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
      };
      user.markModified("engagement");
      await user.save();
    }

    // Recalculate streak and habit score
    const streakData = await this.calculateStreak(userId);
    const habitScore = await this.calculateHabitScore(userId);

    // Update weekly metrics
    const weeklyMetrics = await this.updateWeeklyMetrics(userId);

    const engagement = (user as any).engagement;

    // Legacy XP progress calculation
    const currentLevel = engagement.level || 1;
    const nextLevelXp = Math.pow(currentLevel, 2) * 100;
    const currentLevelXp = Math.pow(currentLevel - 1, 2) * 100;
    const xpProgress = {
      current: (engagement.xp || 0) - currentLevelXp,
      required: nextLevelXp - currentLevelXp,
    };

    return {
      // Habit-focused
      habitScore,
      streak: streakData.currentStreak,
      longestStreak: Math.max(
        engagement.longestStreak || 0,
        streakData.longestStreak
      ),
      weeklyConsistency: weeklyMetrics.weeklyConsistency,
      weeklyGoalsHit: weeklyMetrics.weeklyGoalsHit,
      totalMealsLogged: engagement.totalMealsLogged || 0,
      totalDaysTracked: engagement.totalDaysTracked || 0,
      badges: engagement.badges || [],
      streakFreezeAvailable: engagement.streakFreezeAvailable ?? true,
      // Legacy
      xp: engagement.xp || 0,
      level: engagement.level || 1,
      xpProgress,
    };
  }

  /**
   * Use streak freeze
   */
  async useStreakFreeze(userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.engagement) {
      return { success: false, message: "User not found" };
    }

    if (!(user as any).engagement.streakFreezeAvailable) {
      return {
        success: false,
        message: "Streak freeze already used this month",
      };
    }

    (user as any).engagement.streakFreezeAvailable = false;
    (user as any).engagement.streakFreezeUsedAt = new Date();

    user.markModified("engagement");
    await user.save();

    return { success: true, message: "Streak freeze activated!" };
  }

  /**
   * Reset streak freeze availability (monthly)
   */
  async resetStreakFreezeForAllUsers(): Promise<void> {
    await this.userModel.updateMany(
      { "engagement.streakFreezeAvailable": false },
      {
        $set: {
          "engagement.streakFreezeAvailable": true,
        },
      }
    );
    logger.info("[EngagementService] Reset streak freeze for all users");
  }

  // Helper methods
  private hasBadge(user: any, badgeId: string): boolean {
    return user.engagement?.badges?.some((b: IBadge) => b.id === badgeId);
  }

  private createBadge(badgeId: string): IBadge | null {
    const definition = HABIT_BADGES[badgeId];
    if (!definition) return null;

    return {
      id: badgeId,
      ...definition,
      earnedAt: new Date(),
    };
  }
}
