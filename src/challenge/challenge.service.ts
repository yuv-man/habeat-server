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
  difficulty: ChallengeDifficulty;
  badgeId?: string; // Optional badge awarded on completion
}

// Habit-focused challenge templates organized by difficulty
const HABIT_CHALLENGE_TEMPLATES: HabitChallengeTemplate[] = [
  // Starter habits (3-day) - Build initial momentum
  {
    type: "breakfast_habit",
    title: "Morning Starter",
    description: "Log breakfast for 3 days",
    icon: "utensils",
    target: 3,
    daysRequired: 3,
    difficulty: "starter",
  },
  {
    type: "hydration_habit",
    title: "Stay Hydrated",
    description: "Hit your water goal for 3 days",
    icon: "droplet",
    target: 3,
    daysRequired: 3,
    difficulty: "starter",
  },
  {
    type: "daily_logging",
    title: "Track Your Day",
    description: "Log all meals for 3 days",
    icon: "clipboard-list",
    target: 3,
    daysRequired: 3,
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
    difficulty: "building",
  },
  {
    type: "balanced_eating",
    title: "Balance Week",
    description: "Hit macro balance 5 of 7 days",
    icon: "scale",
    target: 5,
    daysRequired: 7,
    difficulty: "building",
  },
  {
    type: "hydration_habit",
    title: "Hydration Hero",
    description: "Hit water goal for 7 days",
    icon: "droplets",
    target: 7,
    daysRequired: 7,
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
    difficulty: "established",
  },
  {
    type: "daily_logging",
    title: "Two Week Tracker",
    description: "Log all meals for 14 days",
    icon: "star",
    target: 14,
    daysRequired: 14,
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

    const challenges = await this.challengeModel
      .find({ userId, status: "active" })
      .sort({ endDate: 1 })
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
   * Called when user has fewer than 2 active challenges
   */
  async assignChallenges(userId: string): Promise<IChallenge[]> {
    const activeChallenges = await this.getActiveChallenges(userId);

    // User should have 2 active habit challenges at a time (simpler than 3)
    const needed = 2 - activeChallenges.length;
    if (needed <= 0) {
      return activeChallenges;
    }

    // Get types of current active challenges to avoid duplicates
    const activeTypes = new Set(activeChallenges.map((c) => c.type));

    // Filter available templates
    const availableTemplates = HABIT_CHALLENGE_TEMPLATES.filter(
      (t) => !activeTypes.has(t.type)
    );

    // Pick random challenges, preferring variety in difficulty
    const newChallenges: IChallenge[] = [];
    const shuffled = this.shuffleArray([...availableTemplates]);

    // Try to get a mix of difficulties - prefer starter for new users
    const difficulties: ChallengeDifficulty[] = ["starter", "building", "established"];
    let difficultyIndex = 0;

    for (const template of shuffled) {
      if (newChallenges.length >= needed) break;

      // Try to match the desired difficulty, but accept any if needed
      const targetDifficulty = difficulties[difficultyIndex % 3];
      if (template.difficulty === targetDifficulty || newChallenges.length === needed - 1) {
        const challenge = await this.createHabitChallenge(userId, template);
        newChallenges.push(challenge);
        difficultyIndex++;
      }
    }

    // If we still need more, just grab any remaining
    for (const template of shuffled) {
      if (newChallenges.length >= needed) break;
      if (!newChallenges.find((c) => c.type === template.type)) {
        const challenge = await this.createHabitChallenge(userId, template);
        newChallenges.push(challenge);
      }
    }

    logger.info(
      `[ChallengeService] Assigned ${newChallenges.length} new habit challenges to user ${userId}`
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
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + template.daysRequired);

    const challenge = new this.challengeModel({
      userId,
      type: template.type,
      title: template.title,
      description: template.description,
      icon: template.icon,
      target: template.target,
      progress: 0,
      daysRequired: template.daysRequired,
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

    // Assign new challenges if needed
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
    await this.challengeModel.updateMany(
      {
        userId,
        status: "active",
        endDate: { $lt: now },
      },
      {
        $set: { status: "expired" },
      }
    );
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
