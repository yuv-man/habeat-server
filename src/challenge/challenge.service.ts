import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Challenge, ChallengeDocument } from "./challenge.model";
import { EngagementService } from "../engagement/engagement.service";
import { IChallenge, ChallengeType, ChallengeDifficulty } from "../types/interfaces";
import logger from "../utils/logger";

// Challenge templates - used to generate challenges for users
interface ChallengeTemplate {
  type: ChallengeType;
  title: string;
  description: string;
  icon: string;
  target: number;
  xpReward: number;
  difficulty: ChallengeDifficulty;
  durationDays: number;
  frequency: "daily" | "weekly"; // daily = resets each day, weekly = accumulates over period
}

// Challenge templates organized by difficulty
const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  // Easy challenges (1-3 days) - Daily challenges
  {
    type: "meals_logged",
    title: "Meal Tracker",
    description: "Log 3 meals today",
    icon: "utensils",
    target: 3,
    xpReward: 50,
    difficulty: "easy",
    durationDays: 1,
    frequency: "daily",
  },
  {
    type: "water_intake",
    title: "Stay Hydrated",
    description: "Drink 8 glasses of water today",
    icon: "droplet",
    target: 8,
    xpReward: 30,
    difficulty: "easy",
    durationDays: 1,
    frequency: "daily",
  },
  {
    type: "balanced_meals",
    title: "Balance Check",
    description: "Log 2 balanced meals today",
    icon: "scale",
    target: 2,
    xpReward: 40,
    difficulty: "easy",
    durationDays: 1,
    frequency: "daily",
  },

  // Medium challenges (3-5 days) - Weekly challenges
  {
    type: "meals_logged",
    title: "Consistent Logger",
    description: "Log 10 meals this week",
    icon: "clipboard-list",
    target: 10,
    xpReward: 100,
    difficulty: "medium",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "water_intake",
    title: "Hydration Hero",
    description: "Hit water goal for 3 days this week",
    icon: "droplets",
    target: 3,
    xpReward: 80,
    difficulty: "medium",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "protein_goal",
    title: "Protein Power",
    description: "Hit your protein goal 3 times this week",
    icon: "beef",
    target: 3,
    xpReward: 90,
    difficulty: "medium",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "workout_complete",
    title: "Active Week",
    description: "Complete 3 workouts this week",
    icon: "dumbbell",
    target: 3,
    xpReward: 100,
    difficulty: "medium",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "streak_days",
    title: "Keep It Going",
    description: "Maintain a 3-day streak",
    icon: "flame",
    target: 3,
    xpReward: 75,
    difficulty: "medium",
    durationDays: 7,
    frequency: "weekly",
  },

  // Hard challenges (7+ days) - Weekly challenges
  {
    type: "meals_logged",
    title: "Meal Master",
    description: "Log 21 meals in a week",
    icon: "award",
    target: 21,
    xpReward: 200,
    difficulty: "hard",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "streak_days",
    title: "Week Warrior",
    description: "Maintain a 7-day streak",
    icon: "trophy",
    target: 7,
    xpReward: 250,
    difficulty: "hard",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "water_intake",
    title: "Hydration Champion",
    description: "Hit water goal for 7 days this week",
    icon: "medal",
    target: 7,
    xpReward: 180,
    difficulty: "hard",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "balanced_meals",
    title: "Nutrition Expert",
    description: "Log 14 balanced meals in a week",
    icon: "star",
    target: 14,
    xpReward: 220,
    difficulty: "hard",
    durationDays: 7,
    frequency: "weekly",
  },
  {
    type: "workout_complete",
    title: "Fitness Champion",
    description: "Complete 5 workouts in a week",
    icon: "zap",
    target: 5,
    xpReward: 200,
    difficulty: "hard",
    durationDays: 7,
    frequency: "weekly",
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
   * Assign new challenges to a user
   * Called when user has fewer than 3 active challenges
   */
  async assignChallenges(userId: string): Promise<IChallenge[]> {
    const activeChallenges = await this.getActiveChallenges(userId);

    // User should have 3 active challenges at a time
    const needed = 3 - activeChallenges.length;
    if (needed <= 0) {
      return activeChallenges;
    }

    // Get types of current active challenges to avoid duplicates
    const activeTypes = new Set(activeChallenges.map((c) => c.type));

    // Filter available templates
    const availableTemplates = CHALLENGE_TEMPLATES.filter(
      (t) => !activeTypes.has(t.type)
    );

    // Pick random challenges, preferring variety in difficulty
    const newChallenges: IChallenge[] = [];
    const shuffled = this.shuffleArray([...availableTemplates]);

    // Try to get a mix of difficulties
    const difficulties: ChallengeDifficulty[] = ["easy", "medium", "hard"];
    let difficultyIndex = 0;

    for (const template of shuffled) {
      if (newChallenges.length >= needed) break;

      // Try to match the desired difficulty, but accept any if needed
      const targetDifficulty = difficulties[difficultyIndex % 3];
      if (template.difficulty === targetDifficulty || newChallenges.length === needed - 1) {
        const challenge = await this.createChallenge(userId, template);
        newChallenges.push(challenge);
        difficultyIndex++;
      }
    }

    // If we still need more, just grab any remaining
    for (const template of shuffled) {
      if (newChallenges.length >= needed) break;
      if (!newChallenges.find((c) => c.type === template.type)) {
        const challenge = await this.createChallenge(userId, template);
        newChallenges.push(challenge);
      }
    }

    logger.info(
      `[ChallengeService] Assigned ${newChallenges.length} new challenges to user ${userId}`
    );

    return [...activeChallenges, ...newChallenges];
  }

  /**
   * Create a challenge from a template
   */
  private async createChallenge(
    userId: string,
    template: ChallengeTemplate
  ): Promise<IChallenge> {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + template.durationDays);

    const challenge = new this.challengeModel({
      userId,
      type: template.type,
      title: template.title,
      description: template.description,
      icon: template.icon,
      target: template.target,
      progress: 0,
      xpReward: template.xpReward,
      difficulty: template.difficulty,
      frequency: template.frequency,
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
   * Claim reward for a completed challenge
   */
  async claimReward(
    userId: string,
    challengeId: string
  ): Promise<{ success: boolean; xpAwarded: number; challenge: IChallenge }> {
    const challenge = await this.challengeModel.findOne({
      _id: challengeId,
      userId,
      status: "completed",
    });

    if (!challenge) {
      throw new Error("Challenge not found or not completed");
    }

    // Award XP
    await this.engagementService.awardXP(
      userId,
      challenge.xpReward,
      `challenge_${challenge.type}`
    );

    // Mark as claimed
    challenge.status = "claimed";
    challenge.claimedAt = new Date();
    await challenge.save();

    logger.info(
      `[ChallengeService] Challenge reward claimed: ${challenge.title}, +${challenge.xpReward} XP for user ${userId}`
    );

    // Assign new challenges if needed
    await this.assignChallenges(userId);

    return {
      success: true,
      xpAwarded: challenge.xpReward,
      challenge: challenge.toObject() as IChallenge,
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
   * Process meal completion - update relevant challenges
   */
  async onMealCompleted(userId: string, isBalanced: boolean): Promise<void> {
    // Update meals_logged challenges
    await this.updateProgress(userId, "meals_logged", 1);

    // Update balanced_meals challenges if applicable
    if (isBalanced) {
      await this.updateProgress(userId, "balanced_meals", 1);
    }
  }

  /**
   * Process water intake - update relevant challenges incrementally
   * For daily challenges: increments progress for each glass
   * For weekly challenges: increments progress when daily goal is reached
   */
  async onWaterIntake(userId: string, glasses: number, goalReached: boolean = false): Promise<void> {
    const challenges = await this.challengeModel.find({
      userId,
      type: "water_intake",
      status: "active",
    });

    for (const challenge of challenges) {
      if (challenge.frequency === "daily") {
        // Daily challenge: increment progress for each glass
        challenge.progress = Math.min(challenge.target, challenge.progress + 1);
      } else if (challenge.frequency === "weekly") {
        // Weekly challenge: increment progress when daily goal is reached
        if (goalReached) {
          challenge.progress = Math.min(challenge.target, challenge.progress + 1);
        }
      }

      // Check if completed
      if (challenge.progress >= challenge.target && challenge.status === "active") {
        challenge.status = "completed";
        challenge.completedAt = new Date();
        logger.info(
          `[ChallengeService] Water challenge completed: ${challenge.title} for user ${userId}`
        );
      }

      await challenge.save();
    }
  }

  /**
   * Process water goal reached - update relevant challenges (legacy method for backward compatibility)
   */
  async onWaterGoalReached(userId: string): Promise<void> {
    await this.onWaterIntake(userId, 1, true);
  }

  /**
   * Process workout completion - update relevant challenges
   */
  async onWorkoutCompleted(userId: string): Promise<void> {
    await this.updateProgress(userId, "workout_complete", 1);
  }

  /**
   * Process streak update - update relevant challenges
   */
  async onStreakUpdated(userId: string, currentStreak: number): Promise<void> {
    // Find streak challenges and update their progress directly
    const challenges = await this.challengeModel.find({
      userId,
      type: "streak_days",
      status: "active",
    });

    for (const challenge of challenges) {
      challenge.progress = currentStreak;

      if (challenge.progress >= challenge.target && challenge.status === "active") {
        challenge.status = "completed";
        challenge.completedAt = new Date();
        logger.info(
          `[ChallengeService] Streak challenge completed: ${challenge.title} for user ${userId}`
        );
      }

      await challenge.save();
    }
  }

  /**
   * Process protein goal reached - update relevant challenges
   */
  async onProteinGoalReached(userId: string): Promise<void> {
    await this.updateProgress(userId, "protein_goal", 1);
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
