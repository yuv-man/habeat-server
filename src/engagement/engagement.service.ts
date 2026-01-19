import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "../user/user.model";
import { DailyProgress } from "../progress/progress.model";
import { IUserData, IDailyProgress, IBadge } from "../types/interfaces";
import logger from "../utils/logger";

// XP rewards for different actions
export const XP_REWARDS = {
  MEAL_LOGGED: 10,
  BALANCED_MEAL: 20, // Meal with good macro balance
  COMPLETE_DAY: 50, // All meals completed for the day
  WATER_GOAL: 15, // Hit water intake goal
  WORKOUT_COMPLETED: 25,
  STREAK_MILESTONE_7: 100, // 7-day streak
  STREAK_MILESTONE_30: 500, // 30-day streak
  STREAK_MILESTONE_100: 2000, // 100-day streak
  FIRST_MEAL: 50, // First meal ever logged (onboarding)
} as const;

// Badge definitions
export const BADGE_DEFINITIONS: Record<
  string,
  Omit<IBadge, "earnedAt" | "id">
> = {
  first_meal: {
    name: "First Bite",
    description: "Logged your first meal",
    icon: "utensils",
    category: "milestone",
  },
  streak_7: {
    name: "Week Warrior",
    description: "Maintained a 7-day streak",
    icon: "flame",
    category: "streak",
  },
  streak_30: {
    name: "Monthly Master",
    description: "Maintained a 30-day streak",
    icon: "calendar",
    category: "streak",
  },
  streak_100: {
    name: "Century Champion",
    description: "Maintained a 100-day streak",
    icon: "trophy",
    category: "streak",
  },
  meals_50: {
    name: "Meal Tracker",
    description: "Logged 50 meals",
    icon: "check-circle",
    category: "meals",
  },
  meals_100: {
    name: "Nutrition Ninja",
    description: "Logged 100 meals",
    icon: "award",
    category: "meals",
  },
  meals_500: {
    name: "Food Chronicler",
    description: "Logged 500 meals",
    icon: "book-open",
    category: "meals",
  },
  perfect_week: {
    name: "Perfect Week",
    description: "Completed all meals for 7 days straight",
    icon: "star",
    category: "nutrition",
  },
  hydration_hero: {
    name: "Hydration Hero",
    description: "Hit water goal for 7 days straight",
    icon: "droplet",
    category: "nutrition",
  },
};

@Injectable()
export class EngagementService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>
  ) {}

  /**
   * Calculate level from XP using sqrt formula
   * Level 1: 0-99 XP
   * Level 2: 100-399 XP
   * Level 3: 400-899 XP
   * etc.
   */
  calculateLevel(xp: number): number {
    return Math.floor(Math.sqrt(xp / 100)) + 1;
  }

  /**
   * Calculate XP required for a specific level
   */
  xpForLevel(level: number): number {
    return Math.pow(level - 1, 2) * 100;
  }

  /**
   * Calculate XP required to reach next level
   */
  xpToNextLevel(currentXp: number): { current: number; required: number } {
    const currentLevel = this.calculateLevel(currentXp);
    const nextLevelXp = this.xpForLevel(currentLevel + 1);
    const currentLevelXp = this.xpForLevel(currentLevel);
    return {
      current: currentXp - currentLevelXp,
      required: nextLevelXp - currentLevelXp,
    };
  }

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
   * Calculate streak from progress records
   * Uses the "no punishment" rule:
   * - 1 missed day = freeze (no change)
   * - 2+ missed days = decrement by 1 (not reset)
   */
  async calculateStreak(userId: string): Promise<{
    currentStreak: number;
    longestStreak: number;
    lastActiveDate: string | null;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = this.getLocalDateKey(today);

    // Get all progress records sorted by date descending
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

    // Calculate days since last activity
    const lastActive = new Date(lastActiveDate);
    lastActive.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor(
      (today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Build a set of active date keys for streak calculation
    const activeDateSet = new Set(activeDays.map((p: any) => p.dateKey));

    // Calculate current streak
    let currentStreak = 0;
    let checkDate = new Date(today);
    let missedDays = 0;

    // Start from today or yesterday if today has no activity
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
        // Don't count the day we started if it's a miss
        if (currentStreak === 0 && missedDays === 1) {
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
      }
      checkDate.setDate(checkDate.getDate() - 1);

      // Safety check to prevent infinite loop
      if (checkDate < new Date("2020-01-01")) break;
    }

    // Apply no-punishment rule
    if (daysDiff === 1 && !activeDateSet.has(todayKey)) {
      // 1 missed day (today) - freeze streak at current value
      // No change needed
    } else if (daysDiff >= 2 && !activeDateSet.has(todayKey)) {
      // 2+ missed days - decrement by 1 but don't go below 0
      currentStreak = Math.max(0, currentStreak - 1);
    }

    // Calculate longest streak historically
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
   * Award XP to user and handle level ups
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

    // Initialize engagement if not exists
    if (!user.engagement) {
      (user as any).engagement = {
        xp: 0,
        level: 1,
        streakDays: 0,
        longestStreak: 0,
        lastActiveDate: null,
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

    const leveledUp = newLevel > oldLevel;
    const newBadges: IBadge[] = [];

    // Check for level-up badges could go here

    user.markModified("engagement");
    await user.save();

    logger.info(
      `[EngagementService] Awarded ${amount} XP to user ${userId} for ${reason}. Total: ${(user as any).engagement.xp}, Level: ${newLevel}`
    );

    return {
      xpAwarded: amount,
      totalXp: (user as any).engagement.xp,
      level: newLevel,
      leveledUp,
      newBadges,
    };
  }

  /**
   * Process meal completion - award XP and update stats
   */
  async onMealCompleted(
    userId: string,
    mealType: string,
    isBalanced: boolean = false
  ): Promise<{
    xpAwarded: number;
    totalXp: number;
    level: number;
    leveledUp: boolean;
    newBadges: IBadge[];
    streak: number;
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
        streakDays: 0,
        longestStreak: 0,
        lastActiveDate: null,
        totalMealsLogged: 0,
        totalDaysTracked: 0,
        badges: [],
        streakFreezeAvailable: true,
        streakFreezeUsedAt: null,
      };
    }

    let totalXpAwarded = 0;
    const newBadges: IBadge[] = [];
    const todayKey = this.getLocalDateKey(new Date());

    // Base XP for logging a meal
    totalXpAwarded += XP_REWARDS.MEAL_LOGGED;

    // Bonus for balanced meal
    if (isBalanced) {
      totalXpAwarded += XP_REWARDS.BALANCED_MEAL;
    }

    // Check if this is the first meal ever
    const isFirstMeal = (user as any).engagement.totalMealsLogged === 0;
    if (isFirstMeal) {
      totalXpAwarded += XP_REWARDS.FIRST_MEAL;
      const badge = this.createBadge("first_meal");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    }

    // Update stats
    (user as any).engagement.totalMealsLogged += 1;
    (user as any).engagement.lastActiveDate = todayKey;

    // Check for meal milestone badges
    const mealCount = (user as any).engagement.totalMealsLogged;
    if (mealCount === 50 && !this.hasBadge(user, "meals_50")) {
      const badge = this.createBadge("meals_50");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    } else if (mealCount === 100 && !this.hasBadge(user, "meals_100")) {
      const badge = this.createBadge("meals_100");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    } else if (mealCount === 500 && !this.hasBadge(user, "meals_500")) {
      const badge = this.createBadge("meals_500");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    }

    // Calculate and update streak
    const streakData = await this.calculateStreak(userId);
    (user as any).engagement.streakDays = streakData.currentStreak;
    if (streakData.longestStreak > (user as any).engagement.longestStreak) {
      (user as any).engagement.longestStreak = streakData.longestStreak;
    }

    // Check for streak milestone badges
    const streak = streakData.currentStreak;
    if (streak >= 7 && !this.hasBadge(user, "streak_7")) {
      totalXpAwarded += XP_REWARDS.STREAK_MILESTONE_7;
      const badge = this.createBadge("streak_7");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    }
    if (streak >= 30 && !this.hasBadge(user, "streak_30")) {
      totalXpAwarded += XP_REWARDS.STREAK_MILESTONE_30;
      const badge = this.createBadge("streak_30");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    }
    if (streak >= 100 && !this.hasBadge(user, "streak_100")) {
      totalXpAwarded += XP_REWARDS.STREAK_MILESTONE_100;
      const badge = this.createBadge("streak_100");
      if (badge) {
        newBadges.push(badge);
        (user as any).engagement.badges.push(badge);
      }
    }

    // Apply XP
    const oldLevel = (user as any).engagement.level;
    (user as any).engagement.xp += totalXpAwarded;
    const newLevel = this.calculateLevel((user as any).engagement.xp);
    (user as any).engagement.level = newLevel;

    user.markModified("engagement");
    await user.save();

    logger.info(
      `[EngagementService] Meal completed for user ${userId}. XP: +${totalXpAwarded}, Total: ${(user as any).engagement.xp}, Level: ${newLevel}, Streak: ${streak}`
    );

    return {
      xpAwarded: totalXpAwarded,
      totalXp: (user as any).engagement.xp,
      level: newLevel,
      leveledUp: newLevel > oldLevel,
      newBadges,
      streak: streakData.currentStreak,
    };
  }

  /**
   * Process day completion - check if all meals completed
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
      // Check if we already awarded XP for this day
      const user = await this.userModel.findById(userId);
      if (!user || !user.engagement) return { completed: true, xpAwarded: 0 };

      // Award day completion XP
      const result = await this.awardXP(
        userId,
        XP_REWARDS.COMPLETE_DAY,
        "complete_day"
      );

      // Update total days tracked
      (user as any).engagement.totalDaysTracked += 1;
      user.markModified("engagement");
      await user.save();

      return { completed: true, xpAwarded: result.xpAwarded };
    }

    return { completed: false, xpAwarded: 0 };
  }

  /**
   * Get user's engagement stats
   */
  async getEngagementStats(userId: string): Promise<{
    xp: number;
    level: number;
    xpProgress: { current: number; required: number };
    streak: number;
    longestStreak: number;
    totalMealsLogged: number;
    totalDaysTracked: number;
    badges: IBadge[];
    streakFreezeAvailable: boolean;
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
        streakDays: 0,
        longestStreak: 0,
        lastActiveDate: null,
        totalMealsLogged: 0,
        totalDaysTracked: 0,
        badges: [],
        streakFreezeAvailable: true,
        streakFreezeUsedAt: null,
      };
      user.markModified("engagement");
      await user.save();
    }

    // Recalculate streak to ensure accuracy
    const streakData = await this.calculateStreak(userId);

    const engagement = (user as any).engagement;
    return {
      xp: engagement.xp,
      level: engagement.level,
      xpProgress: this.xpToNextLevel(engagement.xp),
      streak: streakData.currentStreak,
      longestStreak: Math.max(
        engagement.longestStreak,
        streakData.longestStreak
      ),
      totalMealsLogged: engagement.totalMealsLogged,
      totalDaysTracked: engagement.totalDaysTracked,
      badges: engagement.badges,
      streakFreezeAvailable: engagement.streakFreezeAvailable,
    };
  }

  /**
   * Use streak freeze to save streak
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
   * Reset streak freeze availability (call monthly via cron)
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
    const definition = BADGE_DEFINITIONS[badgeId];
    if (!definition) return null;

    return {
      id: badgeId,
      ...definition,
      earnedAt: new Date(),
    };
  }
}
