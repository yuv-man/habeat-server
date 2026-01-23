import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Challenge, ChallengeDocument } from "./challenge.model";
import { EngagementService } from "../engagement/engagement.service";
import { IChallenge, ChallengeType, ChallengeDifficulty, HabitChallengeType } from "../types/interfaces";
import logger from "../utils/logger";

// Habit-focused challenge templates
interface HabitChallengeTemplate {
  type: HabitChallengeType;
  title: string;
  description: string;
  icon: string;
  target: number;
  daysRequired: number;
  period: "daily" | "weekly"; // Daily = can complete in 1 day, Weekly = spans multiple days
  difficulty: ChallengeDifficulty;
  badgeId?: string; // Optional badge awarded on completion
}

// Habit-focused challenge templates organized by difficulty and period
const HABIT_CHALLENGE_TEMPLATES: HabitChallengeTemplate[] = [
  // ========== DAILY CHALLENGES (Quick wins - can complete in 1 day) ==========
  {
    type: "daily_logging",
    title: "Complete Day",
    description: "Log all meals today",
    icon: "check-circle",
    target: 1,
    daysRequired: 1,
    period: "daily",
    difficulty: "starter",
  },
  {
    type: "hydration_habit",
    title: "Hydration Goal",
    description: "Hit your water goal today",
    icon: "droplet",
    target: 1,
    daysRequired: 1,
    period: "daily",
    difficulty: "starter",
  },
  {
    type: "protein_focus",
    title: "Protein Power",
    description: "Hit your protein goal today",
    icon: "beef",
    target: 1,
    daysRequired: 1,
    period: "daily",
    difficulty: "starter",
  },
  {
    type: "balanced_eating",
    title: "Balanced Day",
    description: "Hit macro balance today",
    icon: "scale",
    target: 1,
    daysRequired: 1,
    period: "daily",
    difficulty: "building",
  },
  {
    type: "breakfast_habit",
    title: "Morning Win",
    description: "Log breakfast today",
    icon: "sunrise",
    target: 1,
    daysRequired: 1,
    period: "daily",
    difficulty: "starter",
  },

  // ========== WEEKLY CHALLENGES (Long-term - spans multiple days) ==========
  // Starter habits (3-day) - Build initial momentum
  {
    type: "breakfast_habit",
    title: "Morning Starter",
    description: "Log breakfast for 3 days",
    icon: "utensils",
    target: 3,
    daysRequired: 3,
    period: "weekly",
    difficulty: "starter",
  },
  {
    type: "hydration_habit",
    title: "Stay Hydrated",
    description: "Hit your water goal for 3 days",
    icon: "droplet",
    target: 3,
    daysRequired: 3,
    period: "weekly",
    difficulty: "starter",
  },
  {
    type: "daily_logging",
    title: "Track Your Day",
    description: "Log all meals for 3 days",
    icon: "clipboard-list",
    target: 3,
    daysRequired: 3,
    period: "weekly",
    difficulty: "starter",
  },

  // Building habits (7-day) - Establish consistency
  {
    type: "daily_logging",
    title: "Consistent Tracker",
    description: "Log all meals for 7 days",
    icon: "award",
    target: 7,
    daysRequired: 7,
    period: "weekly",
    difficulty: "building",
  },
  {
    type: "balanced_eating",
    title: "Balance Week",
    description: "Hit macro balance 5 of 7 days",
    icon: "scale",
    target: 5,
    daysRequired: 7,
    period: "weekly",
    difficulty: "building",
  },
  {
    type: "hydration_habit",
    title: "Hydration Hero",
    description: "Hit water goal for 7 days",
    icon: "droplets",
    target: 7,
    daysRequired: 7,
    period: "weekly",
    difficulty: "building",
    badgeId: "hydration_habit",
  },
  {
    type: "protein_focus",
    title: "Protein Priority",
    description: "Hit your protein goal 5 of 7 days",
    icon: "beef",
    target: 5,
    daysRequired: 7,
    period: "weekly",
    difficulty: "building",
  },

  // Established habits (14-day) - Solidify the habit
  {
    type: "meal_consistency",
    title: "No Skipping",
    description: "Don't skip meals for 14 days",
    icon: "trophy",
    target: 14,
    daysRequired: 14,
    period: "weekly",
    difficulty: "established",
  },
  {
    type: "daily_logging",
    title: "Two Week Tracker",
    description: "Log all meals for 14 days",
    icon: "star",
    target: 14,
    daysRequired: 14,
    period: "weekly",
    difficulty: "established",
    badgeId: "two_weeks",
  },
  {
    type: "protein_focus",
    title: "Protein Pro",
    description: "Hit protein goal 12 of 14 days",
    icon: "medal",
    target: 12,
    daysRequired: 14,
    period: "weekly",
    difficulty: "established",
    badgeId: "protein_pro",
  },
  {
    type: "weekly_streak",
    title: "Full Week Champion",
    description: "Complete 2 full weeks of tracking",
    icon: "flame",
    target: 14,
    daysRequired: 14,
    period: "weekly",
    difficulty: "established",
  },
];

@Injectable()
export class ChallengeService {
  constructor(
    @InjectModel(Challenge.name) private challengeModel: Model<ChallengeDocument>,
    private engagementService: EngagementService
  ) {}

  /**
   * Get all active challenges for a user
   */
  async getActiveChallenges(userId: string): Promise<IChallenge[]> {
    // First, expire any challenges that are past their end date
    await this.expireOldChallenges(userId);

    // Ensure we have a good mix of daily and weekly challenges
    await this.ensureChallengeBalance(userId);

    const challenges = await this.challengeModel
      .find({ userId, status: "active" })
      .sort({ period: 1, endDate: 1 }) // Daily challenges first, then weekly
      .lean();

    return challenges as unknown as IChallenge[];
  }

  /**
   * Get all challenges for a user (including completed)
   */
  async getAllChallenges(userId: string): Promise<IChallenge[]> {
    await this.expireOldChallenges(userId);

    const challenges = await this.challengeModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return challenges as unknown as IChallenge[];
  }

  /**
   * Get completed but unclaimed challenges
   */
  async getClaimableChallenges(userId: string): Promise<IChallenge[]> {
    const challenges = await this.challengeModel
      .find({ userId, status: "completed" })
      .lean();

    return challenges as unknown as IChallenge[];
  }

  /**
   * Assign new habit challenges to a user
   * Ensures a mix of daily (quick wins) and weekly (long-term) challenges
   */
  async assignChallenges(userId: string): Promise<IChallenge[]> {
    const activeChallenges = await this.getActiveChallenges(userId);

    // Count active challenges by period
    const dailyChallenges = activeChallenges.filter((c) => c.period === "daily");
    const weeklyChallenges = activeChallenges.filter((c) => c.period === "weekly");

    // Target: 1-2 daily challenges and 1-2 weekly challenges (total 2-3 active)
    const targetDaily = 1;
    const targetWeekly = 1;
    const neededDaily = Math.max(0, targetDaily - dailyChallenges.length);
    const neededWeekly = Math.max(0, targetWeekly - weeklyChallenges.length);
    const totalNeeded = neededDaily + neededWeekly;

    if (totalNeeded <= 0) {
      return activeChallenges;
    }

    // Get types of current active challenges to avoid duplicates
    const activeTypes = new Set(activeChallenges.map((c) => c.type));

    const newChallenges: IChallenge[] = [];

    // Assign daily challenges first (quick wins)
    if (neededDaily > 0) {
      const dailyTemplates = HABIT_CHALLENGE_TEMPLATES.filter(
        (t) => t.period === "daily" && !activeTypes.has(t.type)
      );
      const shuffledDaily = this.shuffleArray([...dailyTemplates]);

      for (let i = 0; i < Math.min(neededDaily, shuffledDaily.length); i++) {
        const template = shuffledDaily[i];
        const challenge = await this.createHabitChallenge(userId, template);
        newChallenges.push(challenge);
        activeTypes.add(template.type); // Prevent duplicates
      }
    }

    // Assign weekly challenges (long-term goals)
    if (neededWeekly > 0) {
      const weeklyTemplates = HABIT_CHALLENGE_TEMPLATES.filter(
        (t) => t.period === "weekly" && !activeTypes.has(t.type)
      );
      const shuffledWeekly = this.shuffleArray([...weeklyTemplates]);

      // Prefer starter difficulty for new users
      const sortedWeekly = shuffledWeekly.sort((a, b) => {
        const difficultyOrder = { starter: 0, building: 1, established: 2 };
        return difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
      });

      for (let i = 0; i < Math.min(neededWeekly, sortedWeekly.length); i++) {
        const template = sortedWeekly[i];
        const challenge = await this.createHabitChallenge(userId, template);
        newChallenges.push(challenge);
      }
    }

    logger.info(
      `[ChallengeService] Assigned ${newChallenges.length} new challenges (${neededDaily} daily, ${neededWeekly} weekly) to user ${userId}`
    );

    return [...activeChallenges, ...newChallenges];
  }

  /**
   * Create a habit challenge from a template
   */
  private async createHabitChallenge(
    userId: string,
    template: HabitChallengeTemplate
  ): Promise<IChallenge> {
    const now = new Date();
    let endDate: Date;

    if (template.period === "daily") {
      // Daily challenges expire at end of today
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Weekly challenges span multiple days
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() + template.daysRequired);
      endDate.setHours(23, 59, 59, 999);
    }

    const challenge = new this.challengeModel({
      userId,
      type: template.type,
      title: template.title,
      description: template.description,
      icon: template.icon,
      target: template.target,
      progress: 0,
      daysRequired: template.daysRequired,
      period: template.period,
      difficulty: template.difficulty,
      badgeId: template.badgeId,
      status: "active",
      startDate: now,
      endDate,
    });

    const saved = await challenge.save();
    return saved.toObject() as IChallenge;
  }

  /**
   * Update challenge progress based on user action
   */
  async updateProgress(
    userId: string,
    type: ChallengeType,
    increment: number = 1
  ): Promise<IChallenge[]> {
    const challenges = await this.challengeModel.find({
      userId,
      type,
      status: "active",
    });

    const updated: IChallenge[] = [];

    for (const challenge of challenges) {
      challenge.progress = Math.min(challenge.target, challenge.progress + increment);

      // Check if completed
      if (challenge.progress >= challenge.target && challenge.status === "active") {
        challenge.status = "completed";
        challenge.completedAt = new Date();
        logger.info(
          `[ChallengeService] Challenge completed: ${challenge.title} for user ${userId}`
        );
      }

      await challenge.save();
      updated.push(challenge.toObject() as IChallenge);
    }

    return updated;
  }

  /**
   * Claim reward for a completed habit challenge
   * Awards badge if challenge has one defined
   */
  async claimReward(
    userId: string,
    challengeId: string
  ): Promise<{ success: boolean; challenge: IChallenge; badgeAwarded?: string }> {
    const challenge = await this.challengeModel.findOne({
      _id: challengeId,
      userId,
      status: "completed",
    });

    if (!challenge) {
      throw new Error("Challenge not found or not completed");
    }

    let badgeAwarded: string | undefined;

    // Award badge if challenge has one defined
    if (challenge.badgeId) {
      await this.engagementService.awardBadge(userId, challenge.badgeId);
      badgeAwarded = challenge.badgeId;
    }

    // Mark as claimed
    challenge.status = "claimed";
    challenge.claimedAt = new Date();
    await challenge.save();

    logger.info(
      `[ChallengeService] Habit challenge completed: ${challenge.title}${badgeAwarded ? `, badge: ${badgeAwarded}` : ""} for user ${userId}`
    );

    // Assign new challenges if needed (especially daily challenges for quick wins)
    await this.assignChallenges(userId);

    return {
      success: true,
      challenge: challenge.toObject() as IChallenge,
      badgeAwarded,
    };
  }

  /**
   * Expire challenges that are past their end date
   */
  private async expireOldChallenges(userId: string): Promise<void> {
    const now = new Date();
    
    // Expire weekly challenges that are past their end date
    await this.challengeModel.updateMany(
      {
        userId,
        status: "active",
        period: "weekly",
        endDate: { $lt: now },
      },
      {
        $set: { status: "expired" },
      }
    );

    // Expire daily challenges that are past end of day
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    
    await this.challengeModel.updateMany(
      {
        userId,
        status: "active",
        period: "daily",
        endDate: { $lt: endOfToday },
      },
      {
        $set: { status: "expired" },
      }
    );
  }

  /**
   * Ensure user has a balanced mix of daily and weekly challenges
   * Auto-assigns new daily challenges if needed
   */
  private async ensureChallengeBalance(userId: string): Promise<void> {
    const activeChallenges = await this.challengeModel.find({
      userId,
      status: "active",
    });

    const dailyChallenges = activeChallenges.filter((c) => c.period === "daily");
    const weeklyChallenges = activeChallenges.filter((c) => c.period === "weekly");

    // If no daily challenges, assign one (quick win opportunity)
    if (dailyChallenges.length === 0) {
      const dailyTemplates = HABIT_CHALLENGE_TEMPLATES.filter(
        (t) => t.period === "daily"
      );
      if (dailyTemplates.length > 0) {
        const activeTypes = new Set(activeChallenges.map((c) => c.type));
        const availableDaily = dailyTemplates.filter(
          (t) => !activeTypes.has(t.type)
        );
        
        if (availableDaily.length > 0) {
          const shuffled = this.shuffleArray([...availableDaily]);
          const template = shuffled[0];
          await this.createHabitChallenge(userId, template);
          logger.info(
            `[ChallengeService] Auto-assigned daily challenge "${template.title}" to user ${userId}`
          );
        }
      }
    }

    // If no weekly challenges, assign one (long-term goal)
    if (weeklyChallenges.length === 0) {
      await this.assignChallenges(userId);
    }
  }

  /**
   * Process meal completion - update relevant habit challenges
   */
  async onMealCompleted(userId: string, mealType: string, isBalanced: boolean): Promise<void> {
    // Update daily_logging challenges
    await this.updateProgress(userId, "daily_logging", 1);

    // Update meal_consistency challenges
    await this.updateProgress(userId, "meal_consistency", 1);

    // Update breakfast_habit if it's a breakfast
    if (mealType === "breakfast") {
      await this.updateProgress(userId, "breakfast_habit", 1);
    }

    // Update balanced_eating challenges if applicable
    if (isBalanced) {
      await this.updateProgress(userId, "balanced_eating", 1);
    }
  }

  /**
   * Process water goal reached - update hydration habit challenges
   */
  async onWaterGoalReached(userId: string): Promise<void> {
    await this.updateProgress(userId, "hydration_habit", 1);
  }

  /**
   * Process water intake update - update hydration habit challenges
   * Only increments when goal is reached (to avoid double counting)
   */
  async onWaterIntake(
    userId: string,
    waterConsumed: number,
    goalReached: boolean
  ): Promise<void> {
    if (goalReached) {
      await this.updateProgress(userId, "hydration_habit", 1);
    }
  }

  /**
   * Process workout completion - update workout-related challenges
   */
  async onWorkoutCompleted(userId: string): Promise<void> {
    // For now, workout challenges can be added later if needed
    // This method exists to prevent errors when called from progress service
    logger.info(`[ChallengeService] Workout completed for user ${userId}`);
  }

  /**
   * Process streak update - update weekly_streak challenges
   */
  async onStreakUpdated(userId: string, currentStreak: number): Promise<void> {
    // Find weekly_streak challenges and update their progress directly
    const challenges = await this.challengeModel.find({
      userId,
      type: "weekly_streak",
      status: "active",
    });

    for (const challenge of challenges) {
      challenge.progress = currentStreak;

      if (challenge.progress >= challenge.target && challenge.status === "active") {
        challenge.status = "completed";
        challenge.completedAt = new Date();
        logger.info(
          `[ChallengeService] Weekly streak challenge completed: ${challenge.title} for user ${userId}`
        );
      }

      await challenge.save();
    }
  }

  /**
   * Process protein goal reached - update protein_focus challenges
   */
  async onProteinGoalReached(userId: string): Promise<void> {
    await this.updateProgress(userId, "protein_focus", 1);
  }

  // Helper to shuffle array
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
