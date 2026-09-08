import { Injectable, NotFoundException, Inject, forwardRef } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import {
  MoodEntry,
  ThoughtEntry,
  CBTExerciseCompletion,
  MealMoodCorrelation,
  IMoodEntry,
  IThoughtEntry,
  ICBTExerciseCompletion,
  IMealMoodCorrelation,
  MoodCategory,
  MealType,
  CBTExerciseCategory,
  IBiometricSnapshot,
} from "./cbt.model";
import {
  LogMoodDto,
  LogThoughtDto,
  UpdateThoughtDto,
  CompleteExerciseDto,
  LinkMoodToMealDto,
} from "./cbt.dto";
import { IUserData, IDailyProgress } from "../types/interfaces";
import { User } from "../user/user.model";
import logger from "../utils/logger";
import {
  computeDominantWindow,
  computeRiskWindows,
  formatWindow,
} from "../utils/risk-windows";
import {
  extractLoggedMeals,
  extractSkippedMeals,
  nearestMood,
  timestampMoods,
  toLocalDateKey,
  LoggedMeal,
  MEAL_SLOTS,
} from "../utils/eating-episodes";
import { DailyProgress } from "../progress/progress.model";
import { ChallengeService } from "../challenge/challenge.service";
import { EngagementService } from "../engagement/engagement.service";
import { BehaviorService } from "../behavior/behavior.service";

// Built-in exercise library
const EXERCISE_LIBRARY = [
  {
    id: "breathing-478",
    type: "breathing",
    title: "4-7-8 Breathing",
    description:
      "A calming breathing technique to reduce anxiety and promote relaxation.",
    duration: 5,
    difficulty: "beginner",
    category: "stress",
    instructions: [
      "Sit or lie down comfortably",
      "Inhale through your nose for 4 seconds",
      "Hold your breath for 7 seconds",
      "Exhale slowly through your mouth for 8 seconds",
      "Repeat 4 times",
    ],
    benefits: ["Reduces anxiety", "Promotes relaxation", "Improves sleep"],
    icon: "🌬️",
  },
  {
    id: "gratitude-reflection",
    type: "gratitude",
    title: "Gratitude Reflection",
    description: "Reflect on three things you are grateful for today.",
    duration: 5,
    difficulty: "beginner",
    category: "mood",
    instructions: [
      "Find a quiet moment",
      "Think of 3 things you're grateful for today",
      "For each one, spend a moment really feeling the gratitude",
      "Notice how your mood shifts",
    ],
    benefits: ["Improves mood", "Increases positivity", "Builds resilience"],
    icon: "🙏",
  },
  {
    id: "mindful-eating",
    type: "mindful_eating",
    title: "Mindful Eating Practice",
    description: "Practice being fully present during your next meal.",
    duration: 10,
    difficulty: "beginner",
    category: "eating",
    instructions: [
      "Before eating, take 3 deep breaths",
      "Notice the colors, textures, and smells of your food",
      "Take small bites and chew slowly",
      "Put your utensils down between bites",
      "Notice flavors and textures as you eat",
      "Check in with your hunger level midway through",
    ],
    benefits: [
      "Reduces overeating",
      "Increases meal satisfaction",
      "Improves digestion",
    ],
    icon: "🧘",
  },
  {
    id: "body-scan",
    type: "body_scan",
    title: "Body Scan Relaxation",
    description: "A guided tour through your body to release tension.",
    duration: 10,
    difficulty: "beginner",
    category: "general",
    instructions: [
      "Lie down or sit comfortably",
      "Close your eyes and take a few deep breaths",
      "Start at your feet - notice any sensations",
      "Slowly move your attention up through each body part",
      "Notice and release any tension you find",
      "End at the top of your head",
    ],
    benefits: [
      "Reduces physical tension",
      "Increases body awareness",
      "Promotes relaxation",
    ],
    icon: "🧘‍♀️",
  },
  {
    id: "progressive-relaxation",
    type: "progressive_relaxation",
    title: "Progressive Muscle Relaxation",
    description: "Systematically tense and release muscle groups to reduce stress.",
    duration: 15,
    difficulty: "intermediate",
    category: "stress",
    instructions: [
      "Find a comfortable position",
      "Start with your feet - tense muscles for 5 seconds",
      "Release and notice the difference for 10 seconds",
      "Move up to calves, thighs, abdomen, etc.",
      "Continue through all major muscle groups",
      "End with a few deep breaths",
    ],
    benefits: [
      "Reduces muscle tension",
      "Decreases anxiety",
      "Improves sleep quality",
    ],
    icon: "💪",
  },
  {
    id: "urge-surfing",
    type: "urge_surfing",
    title: "Urge Surfing",
    description: "Learn to ride out cravings without acting on them.",
    duration: 10,
    difficulty: "intermediate",
    category: "eating",
    instructions: [
      "When you notice a craving, pause",
      "Notice where you feel it in your body",
      "Observe the sensation without judging it",
      "Imagine the urge as a wave - it will rise and fall",
      "Breathe through it and watch it pass",
      "Congratulate yourself for riding it out",
    ],
    benefits: [
      "Reduces impulsive eating",
      "Builds self-control",
      "Increases awareness of triggers",
    ],
    icon: "🌊",
  },
  {
    id: "self-compassion",
    type: "self_compassion",
    title: "Self-Compassion Break",
    description: "Practice kindness toward yourself during difficult moments.",
    duration: 5,
    difficulty: "beginner",
    category: "mood",
    instructions: [
      "Acknowledge that this is a difficult moment",
      "Remind yourself that suffering is part of being human",
      "Place your hand over your heart",
      'Say to yourself: "May I be kind to myself"',
      'Add: "May I give myself the compassion I need"',
    ],
    benefits: [
      "Reduces self-criticism",
      "Increases emotional resilience",
      "Improves self-esteem",
    ],
    icon: "💝",
  },
  {
    id: "cognitive-restructuring",
    type: "cognitive_restructuring",
    title: "Thought Challenge",
    description: "Identify and challenge unhelpful thinking patterns.",
    duration: 15,
    difficulty: "intermediate",
    category: "mood",
    instructions: [
      "Write down the negative thought",
      "Identify what type of distortion it might be",
      "Ask: What evidence supports this thought?",
      "Ask: What evidence contradicts it?",
      "Create a more balanced alternative thought",
      "Rate how you feel now vs. before",
    ],
    benefits: [
      "Reduces negative thinking",
      "Improves mood",
      "Builds cognitive flexibility",
    ],
    icon: "🧠",
  },
  {
    id: "behavioral-activation",
    type: "behavioral_activation",
    title: "Activity Planning",
    description: "Schedule enjoyable activities to improve mood.",
    duration: 10,
    difficulty: "beginner",
    category: "general",
    instructions: [
      "Think of activities that bring you joy or satisfaction",
      "Choose one small activity for today",
      "Schedule a specific time to do it",
      "Commit to doing it regardless of mood",
      "Notice how you feel before and after",
    ],
    benefits: [
      "Increases positive experiences",
      "Breaks cycles of inactivity",
      "Improves motivation",
    ],
    icon: "📅",
  },
  {
    id: "thought-record",
    type: "thought_record",
    title: "Full Thought Record",
    description: "Complete a detailed CBT thought record for deep analysis.",
    duration: 20,
    difficulty: "advanced",
    category: "mood",
    instructions: [
      "Describe the situation that triggered your emotion",
      "Write down your automatic thought",
      "Identify the emotions and rate their intensity",
      "Look for cognitive distortions",
      "Gather evidence for and against the thought",
      "Create a balanced perspective",
      "Re-rate your emotions",
    ],
    benefits: [
      "Deep insight into thought patterns",
      "Long-term cognitive change",
      "Emotional regulation",
    ],
    icon: "📝",
  },
];

/** Everything the emotional-eating signal reads, regardless of where the
 *  episode came from. */
interface SignalInput {
  mealType: MealType;
  /** When the meal was eaten — drives the late-night term and risk windows. */
  at: Date;
  hungerLevelBefore?: number;
  moodBefore?: { moodLevel: number; moodCategory: MoodCategory };
  moodAfter?: { moodLevel: number; moodCategory: MoodCategory };
  /** Only present when the user actually answered. Absent ≠ "no". */
  wasEmotionalEating?: boolean;
  biometrics?: IBiometricSnapshot;
}

/** How an episode came to be known, and therefore how much it can claim.
 *  - `linked`   the user attached a mood to this meal on purpose
 *  - `inferred` the meal was ticked off and a mood was logged close to it
 *  - `unscored` the meal was ticked off with no mood anywhere near it */
type EpisodeSource = "linked" | "inferred" | "unscored";

interface EatingEpisode {
  date: string;
  at: Date;
  atIsExact: boolean;
  mealType: MealType;
  mealName: string;
  source: EpisodeSource;
  /** 0–1 emotional-eating signal, or null for an unscored episode. */
  score: number | null;
  emotional: boolean;
  moodCategory: MoodCategory | null;
  hungerLevelBefore: number | null;
}

/** A pattern the data actually supports. Never a placeholder — the client has
 *  its own clearly-labelled example rows for the empty case. */
export interface ObservedPattern {
  key: string;
  emoji: string;
  name: string;
  context: string;
  frequency: string;
  impact: "positive" | "negative" | "neutral";
  /** Number of observations behind the row, so the client can rank or filter. */
  evidence: number;
}

@Injectable()
export class CBTService {
  constructor(
    @InjectModel(MoodEntry.name) private moodModel: Model<IMoodEntry>,
    @InjectModel(ThoughtEntry.name) private thoughtModel: Model<IThoughtEntry>,
    @InjectModel(CBTExerciseCompletion.name)
    private exerciseCompletionModel: Model<ICBTExerciseCompletion>,
    @InjectModel(MealMoodCorrelation.name)
    private mealMoodModel: Model<IMealMoodCorrelation>,
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>,
    @Inject(forwardRef(() => ChallengeService))
    private challengeService: ChallengeService,
    @Inject(forwardRef(() => EngagementService))
    private engagementService: EngagementService,
    @Inject(forwardRef(() => BehaviorService))
    private behaviorService: BehaviorService,
  ) {}

  // ============== MOOD ENDPOINTS ==============

  async getTodayMoods(userId: string) {
    const today = new Date().toISOString().split("T")[0];
    const moods = await this.moodModel
      .find({ userId: new mongoose.Types.ObjectId(userId), date: today })
      .sort({ time: -1 })
      .lean()
      .exec();

    return {
      success: true,
      data: { moods },
    };
  }

  async getMoodHistory(userId: string, startDate?: string, endDate?: string) {
    const query: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const moods = await this.moodModel
      .find(query)
      .sort({ date: -1, time: -1 })
      .lean()
      .exec();

    return {
      success: true,
      data: { moods },
    };
  }

  async logMood(userId: string, dto: LogMoodDto) {
    const moodEntry = await this.moodModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      ...dto,
      linkedMealId: dto.linkedMealId
        ? new mongoose.Types.ObjectId(dto.linkedMealId)
        : undefined,
    });

    logger.info(`Mood logged for user ${userId}: ${dto.moodCategory}`);

    // Update challenge progress
    try {
      await this.challengeService.onMoodLogged(userId);

      // Check for mood tracking milestones and award badges
      const moodCount = await this.moodModel.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (moodCount === 1) {
        await this.engagementService.awardBadge(userId, "mood_explorer");
      }

      // Check mood streak for badge
      const moodStreak = await this.calculateStreak(
        new mongoose.Types.ObjectId(userId),
        "mood"
      );
      if (moodStreak === 7) {
        await this.engagementService.awardBadge(userId, "mood_tracker");
      }
      if (moodStreak === 30) {
        await this.engagementService.awardBadge(userId, "mood_master");
      }
    } catch (error) {
      logger.error(`Failed to update challenge progress for mood: ${error}`);
    }

    return {
      success: true,
      data: { mood: moodEntry },
    };
  }

  async updateMood(userId: string, moodId: string, updates: Partial<LogMoodDto>) {
    const mood = await this.moodModel
      .findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(moodId),
          userId: new mongoose.Types.ObjectId(userId),
        },
        { $set: updates },
        { new: true }
      )
      .lean()
      .exec();

    if (!mood) {
      throw new NotFoundException("Mood entry not found");
    }

    logger.info(`Mood updated for user ${userId}: ${moodId}`);

    return {
      success: true,
      data: { mood },
    };
  }

  async deleteMood(userId: string, moodId: string) {
    const result = await this.moodModel.deleteOne({
      _id: new mongoose.Types.ObjectId(moodId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException("Mood entry not found");
    }

    logger.info(`Mood deleted for user ${userId}: ${moodId}`);

    return {
      success: true,
      message: "Mood entry deleted successfully",
    };
  }

  async getMoodSummary(userId: string, period: "week" | "month" = "week") {
    const now = new Date();
    const startDate = new Date();

    if (period === "week") {
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate.setMonth(now.getMonth() - 1);
    }

    const moods = await this.moodModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        date: {
          $gte: startDate.toISOString().split("T")[0],
          $lte: now.toISOString().split("T")[0],
        },
      })
      .lean()
      .exec();

    // Calculate summary statistics
    const totalMoods = moods.length;
    const avgMoodLevel =
      totalMoods > 0
        ? moods.reduce((sum, m) => sum + m.moodLevel, 0) / totalMoods
        : 0;

    // Count mood categories
    const moodCategoryCounts: Record<string, number> = {};
    const triggerCounts: Record<string, number> = {};

    moods.forEach((mood) => {
      moodCategoryCounts[mood.moodCategory] =
        (moodCategoryCounts[mood.moodCategory] || 0) + 1;

      mood.triggers?.forEach((trigger) => {
        triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
      });
    });

    // Find most common mood and trigger
    const mostCommonMood = Object.entries(moodCategoryCounts).sort(
      ([, a], [, b]) => b - a
    )[0];
    const mostCommonTrigger = Object.entries(triggerCounts).sort(
      ([, a], [, b]) => b - a
    )[0];

    return {
      success: true,
      data: {
        summary: {
          period,
          totalMoodEntries: totalMoods,
          averageMoodLevel: Math.round(avgMoodLevel * 10) / 10,
          moodDistribution: moodCategoryCounts,
          triggerDistribution: triggerCounts,
          mostCommonMood: mostCommonMood ? mostCommonMood[0] : null,
          mostCommonTrigger: mostCommonTrigger ? mostCommonTrigger[0] : null,
        },
      },
    };
  }

  // ============== THOUGHT ENDPOINTS ==============

  async getThoughts(userId: string, limit: number = 20) {
    const thoughts = await this.thoughtModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return {
      success: true,
      data: { thoughts },
    };
  }

  async logThought(userId: string, dto: LogThoughtDto) {
    const thoughtEntry = await this.thoughtModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      ...dto,
      linkedMealId: dto.linkedMealId
        ? new mongoose.Types.ObjectId(dto.linkedMealId)
        : undefined,
    });

    logger.info(`Thought entry logged for user ${userId}`);

    // Update challenge progress
    try {
      await this.challengeService.onThoughtLogged(userId);

      // Check for thought journaling milestones
      const thoughtCount = await this.thoughtModel.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (thoughtCount === 5) {
        await this.engagementService.awardBadge(userId, "thought_challenger");
      }
      if (thoughtCount === 20) {
        await this.engagementService.awardBadge(userId, "cognitive_warrior");
      }
    } catch (error) {
      logger.error(`Failed to update challenge progress for thought: ${error}`);
    }

    return {
      success: true,
      data: { thought: thoughtEntry },
    };
  }

  async updateThought(userId: string, thoughtId: string, dto: UpdateThoughtDto) {
    const thought = await this.thoughtModel
      .findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(thoughtId),
          userId: new mongoose.Types.ObjectId(userId),
        },
        { $set: dto },
        { new: true }
      )
      .lean()
      .exec();

    if (!thought) {
      throw new NotFoundException("Thought entry not found");
    }

    return {
      success: true,
      data: { thought },
    };
  }

  async deleteThought(userId: string, thoughtId: string) {
    const result = await this.thoughtModel.deleteOne({
      _id: new mongoose.Types.ObjectId(thoughtId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException("Thought entry not found");
    }

    return {
      success: true,
      message: "Thought entry deleted successfully",
    };
  }

  // ============== EXERCISE ENDPOINTS ==============

  getExercises(category?: CBTExerciseCategory) {
    let exercises = EXERCISE_LIBRARY;

    if (category) {
      exercises = exercises.filter((e) => e.category === category);
    }

    return {
      success: true,
      data: { exercises },
    };
  }

  async getRecommendedExercises(userId: string) {
    // Get user's recent moods to recommend relevant exercises
    const recentMoods = await this.moodModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()
      .exec();

    // Get user's exercise history to avoid recommending recently completed
    const recentCompletions = await this.exerciseCompletionModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .exec();

    const recentExerciseIds = new Set(recentCompletions.map((c) => c.exerciseId));

    // Determine recommended category based on mood patterns
    let recommendedCategory: CBTExerciseCategory = "general";

    if (recentMoods.length > 0) {
      const stressedCount = recentMoods.filter(
        (m) => m.moodCategory === "stressed" || m.moodCategory === "anxious"
      ).length;
      const sadCount = recentMoods.filter(
        (m) => m.moodCategory === "sad" || m.moodCategory === "tired"
      ).length;

      if (stressedCount >= 2) {
        recommendedCategory = "stress";
      } else if (sadCount >= 2) {
        recommendedCategory = "mood";
      }
    }

    // Check for emotional eating patterns
    const recentEmotionalEating = await this.mealMoodModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        wasEmotionalEating: true,
      })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean()
      .exec();

    if (recentEmotionalEating.length >= 2) {
      recommendedCategory = "eating";
    }

    // Get exercises, prioritizing the recommended category and excluding recent completions
    let recommended = EXERCISE_LIBRARY.filter(
      (e) => e.category === recommendedCategory && !recentExerciseIds.has(e.id)
    );

    // Add some variety from other categories
    const others = EXERCISE_LIBRARY.filter(
      (e) => e.category !== recommendedCategory && !recentExerciseIds.has(e.id)
    ).slice(0, 2);

    recommended = [...recommended.slice(0, 3), ...others];

    return {
      success: true,
      data: {
        exercises: recommended,
        recommendedCategory,
        reason:
          recommendedCategory === "stress"
            ? "Based on recent stress levels"
            : recommendedCategory === "eating"
            ? "To help with emotional eating patterns"
            : recommendedCategory === "mood"
            ? "To help improve your mood"
            : "General wellness exercises",
      },
    };
  }

  async completeExercise(userId: string, dto: CompleteExerciseDto) {
    const completion = await this.exerciseCompletionModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      ...dto,
      linkedMealId: dto.linkedMealId
        ? new mongoose.Types.ObjectId(dto.linkedMealId)
        : undefined,
    });

    logger.info(
      `Exercise completed for user ${userId}: ${dto.exerciseType}`
    );

    // Update challenge progress
    try {
      await this.challengeService.onCBTExerciseCompleted(userId, dto.exerciseType);

      // Check for exercise completion milestones
      const exerciseCount = await this.exerciseCompletionModel.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (exerciseCount === 1) {
        await this.engagementService.awardBadge(userId, "mindfulness_starter");
      }
      if (exerciseCount === 7) {
        await this.engagementService.awardBadge(userId, "mindfulness_habit");
      }
      if (exerciseCount === 30) {
        await this.engagementService.awardBadge(userId, "mindfulness_master");
      }

      // Track mindful eating specifically
      if (dto.exerciseType === "mindful_eating") {
        const mindfulMealCount = await this.exerciseCompletionModel.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
          exerciseType: "mindful_eating",
        });
        if (mindfulMealCount === 7) {
          await this.engagementService.awardBadge(userId, "mindful_eater");
        }
      }
    } catch (error) {
      logger.error(`Failed to update challenge progress for exercise: ${error}`);
    }

    return {
      success: true,
      data: { completion },
    };
  }

  async getExerciseHistory(userId: string, limit: number = 20) {
    const completions = await this.exerciseCompletionModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return {
      success: true,
      data: { completions },
    };
  }

  // ============== MEAL-MOOD ENDPOINTS ==============

  async linkMoodToMeal(userId: string, dto: LinkMoodToMealDto) {
    // The post-meal check-in saves on every tap instead of behind a Save
    // button, so this arrives several times for one meal: mode first, then the
    // mood, then whatever detail the user chose to add. Each call carries only
    // what that tap knew, so it upserts and merges rather than creating — a
    // create per tap left three partial rows where there was one meal, and
    // inflated every count built on top of them.
    const set: Record<string, unknown> = {
      mealName: dto.mealName,
      mealType: dto.mealType,
      wasEmotionalEating: dto.wasEmotionalEating,
    };

    // Only fields the caller actually sent. A later tap that says nothing
    // about hunger must not erase the hunger an earlier one recorded.
    const optional = {
      moodBefore: dto.moodBefore,
      moodAfter: dto.moodAfter,
      eatingMode: dto.eatingMode,
      hungerLevelBefore: dto.hungerLevelBefore,
      satisfactionAfter: dto.satisfactionAfter,
      notes: dto.notes,
      biometrics: dto.biometrics,
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) set[key] = value;
    }

    const key = {
      userId: new mongoose.Types.ObjectId(userId),
      mealId: new mongoose.Types.ObjectId(dto.mealId),
      date: dto.date,
    };

    const before = await this.mealMoodModel.findOne(key).select("_id").lean();
    let isNew = !before;

    let correlation: IMealMoodCorrelation;
    try {
      correlation = await this.mealMoodModel.findOneAndUpdate(
        key,
        { $set: set, $setOnInsert: key },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    } catch (error: any) {
      // Two taps close enough together can both read "not found" and both try
      // to insert; the unique index lets exactly one win. The loser is a plain
      // update, not an error the user should ever see.
      if (error?.code !== 11000) throw error;
      isNew = false;
      correlation = await this.mealMoodModel.findOneAndUpdate(
        key,
        { $set: set },
        { new: true }
      );
    }

    logger.info(
      `Meal-mood correlation ${isNew ? "logged" : "updated"} for user ${userId}: ${dto.mealName}`
    );

    // Refresh the cheap rule-based scores on the behaviour profile
    // (fire-and-forget). The expensive analysis is deliberately not triggered
    // here — it runs on a schedule, away from anything a user is waiting on.
    this.behaviorService.onNewCorrelation(userId).catch((e) =>
      logger.error(`[CBTService] Behaviour profile update failed: ${e}`)
    );

    // Challenge progress and the awareness badge count meals reflected on, not
    // taps. Refining an existing correlation must not advance either.
    if (isNew) {
      try {
        await this.challengeService.onMealMoodLinked(userId);

        // Check for emotional awareness milestones
        const correlationCount = await this.mealMoodModel.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (correlationCount === 10) {
          await this.engagementService.awardBadge(userId, "emotional_eater_aware");
        }
      } catch (error) {
        logger.error(`Failed to update challenge progress for meal-mood link: ${error}`);
      }
    }

    return {
      success: true,
      data: { correlation },
    };
  }

  async getMealMoodHistory(userId: string, limit: number = 20) {
    const correlations = await this.mealMoodModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return {
      success: true,
      data: { correlations },
    };
  }

  /**
   * The inputs the emotional-eating signal actually needs. Extracted from the
   * correlation document so the same scoring can run over a meal that was
   * merely ticked off on the tracker with a mood logged beside it — the far
   * more common case, and previously invisible to this pipeline.
   */
  private toSignalInput(correlation: IMealMoodCorrelation): SignalInput {
    return {
      mealType: correlation.mealType,
      at: new Date(correlation.createdAt),
      hungerLevelBefore: correlation.hungerLevelBefore,
      moodBefore: correlation.moodBefore,
      moodAfter: correlation.moodAfter,
      wasEmotionalEating: correlation.wasEmotionalEating,
      biometrics: correlation.biometrics,
    };
  }

  private calculateRawSignalScore(input: SignalInput): number {
    let score = 0;

    const hunger = input.hungerLevelBefore ?? 0;
    if (hunger === 1) score += 0.40;
    else if (hunger === 2) score += 0.25;
    else if (hunger === 3) score += 0.10;

    const emotionalCategories = ["stressed", "anxious", "sad", "angry"];
    const moodCat = input.moodBefore?.moodCategory ?? "";
    if (emotionalCategories.includes(moodCat)) score += 0.25;
    else if (moodCat === "tired") score += 0.15;

    if (
      emotionalCategories.includes(moodCat) &&
      (input.moodBefore?.moodLevel ?? 0) >= 4
    ) {
      score += 0.15;
    }

    const hour = input.at.getHours();
    if (input.mealType === "snacks" && hour >= 21) score += 0.10;

    if (
      input.moodAfter &&
      input.moodBefore &&
      input.moodAfter.moodLevel <= input.moodBefore.moodLevel
    ) {
      score += 0.10;
    }

    const bio = input.biometrics;
    if (bio) {
      if (bio.stressLevel === 'high') score += 0.20;
      else if (bio.stressLevel === 'moderate') score += 0.10;

      if (bio.heartRate !== undefined) {
        const elevated =
          bio.heartRate > 100 ||
          (bio.restingHeartRate !== undefined && bio.heartRate > bio.restingHeartRate * 1.15);
        if (elevated) score += 0.10;
      }

      if (bio.sleepQuality === 'poor') score += 0.10;
      else if (bio.sleepQuality === 'fair') score += 0.05;

      if (bio.stepCount !== undefined && bio.stepCount < 3000) score += 0.05;
    }

    // Self-report is a strong signal, but weighted alongside others rather than overriding them
    if (input.wasEmotionalEating) score += 0.30;

    return Math.min(1.0, score);
  }

  private applyScoreOverrides(
    raw: number,
    wasEmotionalEating: boolean
  ): number {
    // If the user explicitly said this wasn't emotional eating, trust them
    if (!wasEmotionalEating) return Math.min(raw, 0.35);
    return raw;
  }

  private async buildPatternMap(
    userId: string
  ): Promise<Map<string, number>> {
    const totalCount = await this.mealMoodModel.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (totalCount < 5) return new Map();

    const history = await this.mealMoodModel
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .lean()
      .exec();

    const counts = new Map<string, number>();
    history.forEach((c) => {
      if (c.moodBefore?.moodCategory) {
        const dow = new Date(c.createdAt).getDay();
        const key = `${dow}-${c.moodBefore.moodCategory}-${c.mealType}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    });
    return counts;
  }

  private calculateFinalScore(
    correlation: IMealMoodCorrelation,
    patternMap: Map<string, number>
  ): number {
    return this.scoreSignal(this.toSignalInput(correlation), patternMap, {
      selfReported: true,
    });
  }

  /**
   * Score one eating episode, 0–1.
   *
   * `selfReported` says whether `wasEmotionalEating` is an answer the user
   * actually gave. On an inferred pairing it is absent rather than false, so
   * the "trust the user's denial" cap must not fire — treating silence as a
   * denial would score every inferred meal as mindful by default.
   */
  private scoreSignal(
    input: SignalInput,
    patternMap: Map<string, number>,
    opts: { selfReported: boolean }
  ): number {
    let raw = this.calculateRawSignalScore(input);

    if (input.moodBefore?.moodCategory && patternMap.size > 0) {
      const dow = input.at.getDay();
      const key = `${dow}-${input.moodBefore.moodCategory}-${input.mealType}`;
      if ((patternMap.get(key) ?? 0) >= 3) {
        raw = Math.min(1.0, raw + 0.15);
      }
    }

    return opts.selfReported
      ? this.applyScoreOverrides(raw, Boolean(input.wasEmotionalEating))
      : raw;
  }

  private generatePatternSpotlight(
    patternMap: Map<string, number>
  ): string | null {
    const top = [...patternMap.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)[0];

    if (!top) return null;

    const [key] = top;
    const [dow, moodCategory, mealType] = key.split("-");
    const dayNames = [
      "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
    ];
    return `We noticed you tend to reach for ${mealType} when feeling ${moodCategory} on ${dayNames[parseInt(dow)]}s`;
  }

  /**
   * Four weeks of mindful-eating scores.
   *
   * Built from the same episodes the headline score is — correlations *and*
   * meals ticked off with a mood logged nearby. When it read correlations only
   * the trend beneath the score was measuring a different, much smaller thing
   * than the score itself.
   */
  private async calculateWeeklyTrend(
    userId: string
  ): Promise<{ week: string; score: number }[]> {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffKey = toLocalDateKey(cutoff);

    const [allCorrelations, progressDocs, moodEntries] = await Promise.all([
      this.mealMoodModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: cutoffKey },
        })
        .lean()
        .exec(),
      this.progressModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          dateKey: { $gte: cutoffKey },
        })
        .lean()
        .exec(),
      this.moodModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: cutoffKey },
        })
        .lean()
        .exec(),
    ]);

    const emptyMap = new Map<string, number>();
    const episodes = this.buildEpisodes({
      correlations: allCorrelations,
      loggedMeals: extractLoggedMeals(progressDocs as any[]),
      moodEntries,
      patternMap: emptyMap,
    }).filter((e): e is EatingEpisode & { score: number } => e.score !== null);

    const result: { week: string; score: number }[] = [];

    for (let i = 3; i >= 0; i--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 7);

      const startStr = toLocalDateKey(weekStart);
      const endStr = toLocalDateKey(weekEnd);

      const week = episodes.filter(
        (e) => e.date >= startStr && e.date <= endStr
      );

      if (week.length === 0) {
        result.push({ week: startStr, score: 100 });
      } else {
        const eePercent = Math.round(
          (week.reduce((s, e) => s + e.score, 0) / week.length) * 100
        );
        result.push({ week: startStr, score: 100 - eePercent });
      }
    }

    return result;
  }

  async getEmotionalEatingInsights(
    userId: string,
    period: "week" | "month" = "week"
  ) {
    const now = new Date();
    const startDate = new Date();
    const days = period === "week" ? 7 : 30;
    if (period === "week") {
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate.setMonth(now.getMonth() - 1);
    }
    // Local, not UTC: progress writes its dateKey in the user's local day, and
    // a UTC boundary was dropping (or borrowing) the edges of the window.
    const startDateStr = toLocalDateKey(startDate);
    const endDateStr = toLocalDateKey(now);

    const [
      correlations,
      moodEntries,
      mealLinkedMoods,
      progressDocs,
      user,
      patternMap,
      weeklyTrend,
    ] = await Promise.all([
      this.mealMoodModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: startDateStr, $lte: endDateStr },
        })
        .lean()
        .exec(),
      this.moodModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: startDateStr, $lte: endDateStr },
        })
        .lean()
        .exec(),
      this.moodModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: startDateStr, $lte: endDateStr },
          linkedMealId: { $exists: true },
        })
        .lean()
        .exec(),
      // The meals the user actually ticked off. Without these the whole page
      // was blind to eating unless the user had gone out of their way to
      // attach a mood to it.
      this.progressModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          dateKey: { $gte: startDateStr, $lte: endDateStr },
        })
        .lean()
        .exec(),
      this.userModel.findById(userId).lean().exec(),
      this.buildPatternMap(userId),
      this.calculateWeeklyTrend(userId),
    ]);

    // ── Build the unified episode list ───────────────────────────────────────
    const loggedMeals = extractLoggedMeals(progressDocs as any[]);
    const skippedMeals = extractSkippedMeals(progressDocs as any[], endDateStr);
    const episodes = this.buildEpisodes({
      correlations,
      loggedMeals,
      moodEntries,
      patternMap,
    });

    const scoredEpisodes = episodes.filter(
      (e): e is EatingEpisode & { score: number } => e.score !== null
    );

    const mealsLogged = loggedMeals.length;
    const linkedMeals = correlations.length;
    const inferredMeals = episodes.filter((e) => e.source === "inferred").length;
    const unscoredMeals = episodes.filter((e) => e.source === "unscored").length;

    // `totalMeals` stays the count of *analysable* episodes — the number the
    // score is actually computed from — so the client's "do we have enough to
    // show a score" gate keeps meaning what it meant.
    const totalMeals = scoredEpisodes.length;
    const scoreSum = scoredEpisodes.reduce((s, e) => s + e.score, 0);

    const emotionalEatingPercentage =
      totalMeals > 0 ? Math.round((scoreSum / totalMeals) * 100) : 0;
    const mindfulEatingScore = 100 - emotionalEatingPercentage;
    const emotionalEatingInstances = scoredEpisodes.filter((e) => e.emotional).length;

    // ── Satiety rate: meals eaten for genuine hunger (hungerLevelBefore ≥ 3) ──
    // Only meals where hunger was actually asked can answer this, so they are
    // also the denominator — diluting it with meals that were never asked
    // would report a low rate for a question the user was never put.
    const hungerRated = episodes.filter((e) => (e.hungerLevelBefore ?? 0) > 0);
    const hungerDrivenMeals = hungerRated.filter(
      (e) => (e.hungerLevelBefore ?? 0) >= 3
    ).length;
    const satietyRate =
      hungerRated.length > 0
        ? Math.round((hungerDrivenMeals / hungerRated.length) * 100)
        : 0;

    // ── Triggers: derive from emotional eating correlations + meal-linked mood entries ──
    // Maps moodCategory → eating trigger vocabulary
    const MOOD_TO_EATING_TRIGGER: Partial<Record<MoodCategory, string>> = {
      stressed: "stress",
      anxious: "anxiety",
      sad: "sadness",
      tired: "tiredness",
      angry: "stress",
      neutral: "habit",
    };

    const triggerCounts: Record<string, number> = {};
    // Timestamps per trigger, so each pattern can report the window it fires in
    // rather than a generic "observed from your logs".
    const triggerTimes: Record<string, Date[]> = {};

    const noteTrigger = (trigger: string, at?: Date) => {
      triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
      if (at) (triggerTimes[trigger] ??= []).push(at);
    };

    // From eating episodes that read as emotional — the mood beside the meal
    // names the trigger. Inferred episodes count here too: the meal is real and
    // so is the mood, only the link between them is our inference.
    episodes
      .filter((e) => e.emotional && e.moodCategory)
      .forEach((e) => {
        const trigger = MOOD_TO_EATING_TRIGGER[e.moodCategory!];
        if (trigger) noteTrigger(trigger, e.atIsExact ? e.at : undefined);
      });

    // From mood entries explicitly linked to meals — use their trigger tags.
    // The entry's own date+time is the moment that matters, not createdAt (which
    // is when it was saved and can be hours later for a back-dated log).
    mealLinkedMoods.forEach((m) => {
      const at = m.date && m.time ? new Date(`${m.date}T${m.time}`) : undefined;
      const validAt = at && !isNaN(at.getTime()) ? at : undefined;

      m.triggers?.forEach((t) => {
        // Map situational triggers to eating trigger vocabulary
        const mapped =
          t === "work" || t === "health" || t === "finances" ? "stress"
          : t === "social" ? "social"
          : t === "sleep" ? "tiredness"
          : null;
        if (mapped) noteTrigger(mapped, validAt);
      });
    });

    // From the daily reflection on the tracker's mood check-in. These ids are
    // already in the eating vocabulary, so they need no mapping — but they're
    // day-level self-report, not a logged eating episode, so they're tracked
    // separately and never claim to describe a specific meal.
    const reflectionCounts: Record<string, number> = {};
    moodEntries.forEach((m) => {
      const hinderedBy = m.reflection?.hinderedBy;
      if (!hinderedBy?.length) return;

      const at = m.date && m.time ? new Date(`${m.date}T${m.time}`) : undefined;
      const validAt = at && !isNaN(at.getTime()) ? at : undefined;

      hinderedBy.forEach((t) => {
        reflectionCounts[t] = (reflectionCounts[t] || 0) + 1;
        noteTrigger(t, validAt);
      });
    });

    // What the user says helped. Kept apart from triggers so it can be read
    // back as a win rather than counted as a problem.
    const facilitatorCounts: Record<string, number> = {};
    moodEntries.forEach((m) => {
      m.reflection?.easedBy?.forEach((f) => {
        facilitatorCounts[f] = (facilitatorCounts[f] || 0) + 1;
      });
    });

    // Distinct days answered — the honest denominator for the summary, since
    // one day can contribute several chips and summing counts would overstate it.
    const reflectionDays = new Set(
      moodEntries
        .filter(
          (m) => m.reflection?.easedBy?.length || m.reflection?.hinderedBy?.length
        )
        .map((m) => m.date)
    ).size;

    // Nothing observed yet — fall back to what they told us at signup. This is
    // surfaced as `source: "onboarding"` so the client can say where it came
    // from; presenting it as observed behaviour would be a claim we can't make.
    const observedTriggerCount = Object.keys(triggerCounts).length;
    if (observedTriggerCount === 0 && user?.emotionalTriggers?.length) {
      user.emotionalTriggers.forEach((t) => {
        triggerCounts[t] = 0;
      });
    }
    const triggersAreFromOnboarding = observedTriggerCount === 0;

    // ── Emotions: every mood we were able to place beside a meal ──
    // A mood entry linked to a meal usually also produced a correlation, so it
    // is already in `episodes`. Counting both sources unconditionally scored
    // one feeling as two, inflating whichever emotion the user was most
    // diligent about logging.
    const emotionCounts: Record<string, number> = {};
    const episodeSlots = new Set(episodes.map((e) => `${e.date}|${e.mealType}`));
    episodes.forEach((e) => {
      if (!e.moodCategory) return;
      emotionCounts[e.moodCategory] = (emotionCounts[e.moodCategory] || 0) + 1;
    });
    mealLinkedMoods
      .filter((m) => !episodeSlots.has(`${m.date}|${m.linkedMealType}`))
      .forEach((m) => {
        emotionCounts[m.moodCategory] = (emotionCounts[m.moodCategory] || 0) + 1;
      });

    // ── Meal type breakdown ──
    // `mealTypeBreakdown` counts emotional episodes per slot (what it always
    // meant); `mealTypeLogged` counts every meal logged in that slot, which is
    // what makes a "you log dinner most days" pattern statable.
    const mealTypeBreakdown = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
    const mealTypeLogged = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
    const mealTypeScoreSum: Record<string, number> = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
    const mealTypeCount: Record<string, number> = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };

    episodes.forEach((e) => {
      mealTypeLogged[e.mealType]++;
      if (e.score === null) return;
      if (e.emotional) mealTypeBreakdown[e.mealType]++;
      mealTypeScoreSum[e.mealType] += e.score;
      mealTypeCount[e.mealType]++;
    });

    const slotAverages = MEAL_SLOTS.filter((slot) => mealTypeCount[slot] >= 2).map(
      (slot) => ({
        type: slot,
        avg: mealTypeScoreSum[slot] / mealTypeCount[slot],
        count: mealTypeCount[slot],
      })
    );
    const rankedSlots = [...slotAverages].sort((a, b) => a.avg - b.avg);
    const strongestMealType = rankedSlots[0]?.type ?? null;
    const weakestSlot =
      rankedSlots.length > 1 ? rankedSlots[rankedSlots.length - 1] : null;

    // ── Daily breakdown for the 7/30-day chart ──
    const dailyBreakdown: {
      date: string;
      mindfulScore: number | null;
      moodAvg: number | null;
      mealsLogged: number;
      mealsScored: number;
      hasData: boolean;
    }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateKey(d);

      const dayEpisodes = episodes.filter((e) => e.date === dateStr);
      const dayScored = dayEpisodes.filter(
        (e): e is EatingEpisode & { score: number } => e.score !== null
      );
      const dayMoods = moodEntries.filter((m) => m.date === dateStr);

      const dayMindfulScore =
        dayScored.length > 0
          ? 100 -
            Math.round(
              (dayScored.reduce((s, e) => s + e.score, 0) / dayScored.length) * 100
            )
          : null;

      const dayMoodAvg =
        dayMoods.length > 0
          ? dayMoods.reduce((s, m) => s + m.moodLevel, 0) / dayMoods.length
          : null;

      dailyBreakdown.push({
        date: dateStr,
        mindfulScore: dayMindfulScore,
        moodAvg: dayMoodAvg,
        // Every meal ticked off that day, scored or not — so a day with meals
        // and no mood reads as "meals logged", not as an empty day.
        mealsLogged: dayEpisodes.length,
        mealsScored: dayScored.length,
        hasData: dayEpisodes.length > 0 || dayMoods.length > 0,
      });
    }

    // ── Pattern spotlight — include KYC-seeded insight for new users ──
    // `patternMap` only ever saw deliberate correlations, so the spotlight sat
    // silent for users whose evidence is meals-plus-moods. Fall back to the
    // same shape computed over every episode we have.
    let patternSpotlight =
      this.generatePatternSpotlight(patternMap) ??
      this.generatePatternSpotlight(this.buildEpisodePatternMap(episodes));
    if (!patternSpotlight && totalMeals < 3 && user?.foodRelationship) {
      patternSpotlight = this.buildOnboardingSpotlight(
        user.foodRelationship,
        user.emotionalTriggers ?? []
      );
    }

    // ── The patterns table, built from what actually happened ──
    const patterns = this.buildObservedPatterns({
      period,
      days,
      episodes,
      skippedMeals,
      slotAverages,
      strongestMealType,
      weakestSlot,
      mealTypeLogged,
      triggerCounts,
      triggerTimes,
      triggersAreFromOnboarding,
    });

    // ── Personalised recommendations ──
    const recommendations = this.buildRecommendations(
      triggerCounts,
      emotionalEatingPercentage,
      mealTypeBreakdown,
      user?.foodRelationship ?? ""
    );

    return {
      success: true,
      data: {
        insight: {
          period: { start: startDateStr, end: endDateStr },
          totalMeals,
          // How the analysed episodes were come by, so the client can say
          // where its numbers stand rather than implying they're all
          // deliberate check-ins.
          mealsLogged,
          linkedMeals,
          inferredMeals,
          unscoredMeals,
          emotionalEatingInstances,
          emotionalEatingPercentage,
          mindfulEatingScore,
          satietyRate,
          // How many meals the satiety rate is actually computed over — 0 means
          // the question was never asked, not that the answer was "never".
          satietyBasis: hungerRated.length,
          patternSpotlight,
          weeklyTrend,
          strongestMealType,
          dailyBreakdown,
          patterns,
          commonTriggers: Object.entries(triggerCounts)
            .map(([trigger, count]) => {
              const window = computeDominantWindow(triggerTimes[trigger] ?? []);
              return {
                trigger,
                count,
                // Where this came from, so the UI never dresses up a signup
                // answer as something we watched the user do.
                source: triggersAreFromOnboarding
                  ? ("onboarding" as const)
                  : ("observed" as const),
                // null when there isn't enough signal to name a time of day —
                // the client then falls back to a generic description.
                window,
                windowLabel: window ? formatWindow(window) : null,
              };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
          // Day-level self-report from the tracker reflection, kept distinct
          // from meal-linked evidence.
          reflectionDays,
          reflectionTriggers: Object.entries(reflectionCounts)
            .map(([trigger, count]) => ({ trigger, count }))
            .sort((a, b) => b.count - a.count),
          reflectionFacilitators: Object.entries(facilitatorCounts)
            .map(([facilitator, count]) => ({ facilitator, count }))
            .sort((a, b) => b.count - a.count),
          riskWindows: computeRiskWindows(
            scoredEpisodes
              .filter((e) => e.atIsExact)
              .map((e) => ({ at: e.at, emotional: e.emotional })),
          ),
          commonEmotions: Object.entries(emotionCounts)
            .map(([emotion, count]) => ({ emotion, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
          mealTypeBreakdown,
          mealTypeLogged,
          recommendations,
        },
      },
    };
  }

  /** day-of-week × mood × meal-slot counts over every episode, for the
   *  spotlight sentence. Needs a handful of episodes before it will say
   *  anything — one repeat is a coincidence, not a pattern. */
  private buildEpisodePatternMap(episodes: EatingEpisode[]): Map<string, number> {
    const withMood = episodes.filter((e) => e.moodCategory);
    if (withMood.length < 5) return new Map();

    const counts = new Map<string, number>();
    withMood.forEach((e) => {
      const key = `${e.at.getDay()}-${e.moodCategory}-${e.mealType}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }

  /**
   * Fold correlations, ticked-off meals and mood check-ins into one list of
   * eating episodes.
   *
   * A correlation always wins over the meal it describes: it carries answers
   * the user actually gave, where a pairing by time is only ever our reading of
   * two independent logs.
   */
  private buildEpisodes(input: {
    correlations: IMealMoodCorrelation[];
    loggedMeals: LoggedMeal[];
    moodEntries: { date?: string; time?: string; moodLevel: number; moodCategory: MoodCategory }[];
    patternMap: Map<string, number>;
  }): EatingEpisode[] {
    const { correlations, loggedMeals, moodEntries, patternMap } = input;
    const timedMoods = timestampMoods(moodEntries);

    const claimedMealIds = new Set(
      correlations.map((c) => c.mealId?.toString()).filter(Boolean) as string[]
    );
    const claimedSlots = new Set(
      correlations.map((c) => `${c.date}|${c.mealType}`)
    );

    const episodes: EatingEpisode[] = correlations.map((c) => {
      const score = this.calculateFinalScore(c, patternMap);
      const at = new Date(c.createdAt);
      return {
        date: c.date,
        at,
        atIsExact: !isNaN(at.getTime()),
        mealType: c.mealType,
        mealName: c.mealName,
        source: "linked" as const,
        score,
        emotional: score > 0.5,
        moodCategory: c.moodBefore?.moodCategory ?? null,
        hungerLevelBefore: c.hungerLevelBefore ?? null,
      };
    });

    loggedMeals
      .filter(
        (m) =>
          !claimedMealIds.has(m.mealId) &&
          !claimedSlots.has(`${m.date}|${m.mealType}`)
      )
      .forEach((meal) => {
        const match = nearestMood(meal, timedMoods);

        // No mood anywhere near it. The meal is still real and still counted as
        // logged — it simply can't be scored, and saying so beats scoring it
        // neutral and calling that a finding.
        if (!match) {
          episodes.push({
            date: meal.date,
            at: meal.at,
            atIsExact: meal.atIsExact,
            mealType: meal.mealType,
            mealName: meal.mealName,
            source: "unscored",
            score: null,
            emotional: false,
            moodCategory: null,
            hungerLevelBefore: null,
          });
          return;
        }

        const mood = match.entry;
        const score = this.scoreSignal(
          {
            mealType: meal.mealType,
            at: meal.at,
            moodBefore: {
              moodLevel: mood.moodLevel,
              moodCategory: mood.moodCategory,
            },
          },
          patternMap,
          { selfReported: false }
        );

        episodes.push({
          date: meal.date,
          at: meal.at,
          atIsExact: meal.atIsExact,
          mealType: meal.mealType,
          mealName: meal.mealName,
          source: "inferred",
          score,
          emotional: score > 0.5,
          moodCategory: mood.moodCategory,
          hungerLevelBefore: null,
        });
      });

    return episodes.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  /**
   * The "Top Recurring Patterns" rows.
   *
   * Every row here is something that happened, counted from logged meals, the
   * moods around them, and the meals that never got ticked off. The client
   * keeps its own example rows for the case where this comes back empty — the
   * one thing this must never do is manufacture a row to fill the table.
   */
  private buildObservedPatterns(input: {
    period: "week" | "month";
    days: number;
    episodes: EatingEpisode[];
    skippedMeals: { date: string; mealType: MealType }[];
    slotAverages: { type: MealType; avg: number; count: number }[];
    strongestMealType: MealType | null;
    weakestSlot: { type: MealType; avg: number; count: number } | null;
    mealTypeLogged: Record<MealType, number>;
    triggerCounts: Record<string, number>;
    triggerTimes: Record<string, Date[]>;
    triggersAreFromOnboarding: boolean;
  }): ObservedPattern[] {
    const {
      period,
      days,
      episodes,
      skippedMeals,
      strongestMealType,
      weakestSlot,
      mealTypeLogged,
      triggerCounts,
      triggerTimes,
      triggersAreFromOnboarding,
    } = input;

    const rows: ObservedPattern[] = [];
    const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
    const perPeriod = (n: number) => `${n}× this ${period}`;

    const SLOT_EMOJI: Record<MealType, string> = {
      breakfast: "🌅",
      lunch: "🥗",
      dinner: "🍽️",
      snacks: "🍎",
    };

    const TRIGGER_EMOJIS: Record<string, string> = {
      stress: "😤", boredom: "😑", sadness: "😢", anxiety: "😰",
      social: "👥", tiredness: "😴", habit: "🔄", celebration: "🎉",
      procrastination: "📱", "late-night": "🌙", cravings: "🍫",
      "time-pressure": "🏃",
    };

    // 1. The slot the user eats most mindfully in.
    if (strongestMealType) {
      const scored = episodes.filter(
        (e) => e.mealType === strongestMealType && e.score !== null
      ).length;
      rows.push({
        key: `slot-strongest-${strongestMealType}`,
        emoji: SLOT_EMOJI[strongestMealType],
        name: `${cap(strongestMealType)} mindfulness`,
        context: "Your calmest meal of the day",
        frequency: `${scored} meal${scored === 1 ? "" : "s"} analysed`,
        impact: "positive",
        evidence: scored,
      });
    }

    // 2. The slot that runs most emotional — only when it genuinely does.
    if (weakestSlot && weakestSlot.avg >= 0.4 && weakestSlot.type !== strongestMealType) {
      const emotionalCount = episodes.filter(
        (e) => e.mealType === weakestSlot.type && e.emotional
      ).length;
      rows.push({
        key: `slot-weakest-${weakestSlot.type}`,
        emoji: SLOT_EMOJI[weakestSlot.type],
        name: `${cap(weakestSlot.type)} under pressure`,
        context: "Most often eaten on emotion rather than hunger",
        frequency: `${emotionalCount} of ${weakestSlot.count} logged`,
        impact: "negative",
        evidence: weakestSlot.count,
      });
    }

    // 3. Late-night eating — real timestamps only, since the claim is entirely
    //    about the clock.
    const lateNights = episodes.filter((e) => e.atIsExact && e.at.getHours() >= 21);
    const lateNightDays = new Set(lateNights.map((e) => e.date)).size;
    if (lateNightDays >= 2) {
      const window = computeDominantWindow(lateNights.map((e) => e.at));
      rows.push({
        key: "late-night",
        emoji: "🌙",
        name: "Late-night eating",
        context: window ? formatWindow(window) : "After 9 PM",
        frequency: `${lateNightDays} night${lateNightDays === 1 ? "" : "s"}`,
        impact: "negative",
        evidence: lateNightDays,
      });
    }

    // 4. A slot logged so consistently it counts as a habit worth naming.
    MEAL_SLOTS.filter((slot) => slot !== "snacks").forEach((slot) => {
      const logged = mealTypeLogged[slot] ?? 0;
      if (logged < 3 || logged / days < 0.6) return;
      rows.push({
        key: `consistency-${slot}`,
        emoji: SLOT_EMOJI[slot],
        name: `${cap(slot)} most days`,
        context: `Logged on ${logged} of the last ${days} days`,
        frequency: `${Math.round((logged / days) * 100)}% of days`,
        impact: "positive",
        evidence: logged,
      });
    });

    // 5. A slot that keeps getting skipped.
    const skipCounts = new Map<MealType, number>();
    skippedMeals.forEach((s) =>
      skipCounts.set(s.mealType, (skipCounts.get(s.mealType) ?? 0) + 1)
    );
    [...skipCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1)
      .forEach(([slot, count]) => {
        rows.push({
          key: `skipped-${slot}`,
          emoji: "⏭️",
          name: `Skipped ${slot}`,
          context: "Planned, never logged",
          frequency: perPeriod(count),
          impact: "negative",
          evidence: count,
        });
      });

    // 6. Emotional triggers we actually watched fire.
    if (!triggersAreFromOnboarding) {
      Object.entries(triggerCounts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .forEach(([trigger, count]) => {
          const window = computeDominantWindow(triggerTimes[trigger] ?? []);
          rows.push({
            key: `trigger-${trigger}`,
            emoji: TRIGGER_EMOJIS[trigger] ?? "⚡",
            name: `${cap(trigger)}-eating`,
            context: window ? formatWindow(window) : "Observed from your logs",
            frequency: perPeriod(count),
            impact: "negative",
            evidence: count,
          });
        });
    }

    // Strongest evidence first, and keep the table readable.
    return rows.sort((a, b) => b.evidence - a.evidence).slice(0, 6);
  }


  private buildOnboardingSpotlight(
    foodRelationship: string,
    emotionalTriggers: string[]
  ): string {
    const triggerList = emotionalTriggers.slice(0, 2).join(" and ");
    switch (foodRelationship) {
      case "very-emotional":
        return triggerList
          ? `You've told us ${triggerList} drive your eating. Log a meal with a mood check to start seeing your real pattern.`
          : "You've shared that food and emotions are connected for you. Your first mood-linked meal will reveal your pattern.";
      case "sometimes-emotional":
        return triggerList
          ? `You mentioned ${triggerList} sometimes pushes you to eat. Log meals to track when it happens vs. when you eat for hunger.`
          : "You sometimes eat emotionally. Logging a meal with mood context will help identify when and why.";
      case "fuel":
        return "You eat mostly for fuel. Your first mood-linked meal will confirm that — and flag any exceptions worth noticing.";
      default:
        return "Log your first meal with a mood check to start discovering your eating patterns.";
    }
  }

  private buildRecommendations(
    triggerCounts: Record<string, number>,
    eePercentage: number,
    mealTypeBreakdown: { breakfast: number; lunch: number; dinner: number; snacks: number },
    foodRelationship: string
  ): string[] {
    const recs: string[] = [];
    const topTrigger = Object.entries(triggerCounts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)[0]?.[0];

    // Trigger-specific recommendations
    const TRIGGER_RECS: Record<string, string> = {
      stress: "When stress hits, try the 4-7-8 breathing exercise before reaching for food — it reduces cortisol within minutes.",
      boredom: "Boredom eating? Try a 10-minute delay: drink water and do one physical activity before deciding to eat.",
      sadness: "Sadness can trigger comfort eating. The self-compassion exercise can meet that emotional need without food.",
      anxiety: "Anxiety-driven eating responds well to body scan exercises — they calm the nervous system before a meal.",
      habit: "Mindless habit eating is broken by adding friction: put your snacks out of sight and use the mindful eating exercise.",
      social: "Social eating is natural. Focus on slowing down and rating your hunger before second portions.",
      tiredness: "Tiredness cravings are often thirst or need for movement. Try 5 minutes of walking before eating.",
      procrastination: "Procrastination eating? Set a 25-minute focus timer before allowing yourself a snack break.",
      "late-night": "Late-night eating is hard to resist. Try herbal tea and the body scan exercise instead — both signal rest to your body.",
      celebration: "Celebratory eating is healthy. Focus on mindful enjoyment rather than restriction during these moments.",
    };

    if (topTrigger && TRIGGER_RECS[topTrigger]) {
      recs.push(TRIGGER_RECS[topTrigger]);
    }

    if (eePercentage > 40) {
      recs.push("Your emotional eating score shows a pattern worth addressing — try the urge surfing exercise the next time a craving hits.");
    }

    if (
      mealTypeBreakdown.snacks >
      mealTypeBreakdown.breakfast + mealTypeBreakdown.lunch + mealTypeBreakdown.dinner
    ) {
      recs.push("Snacks are your highest-risk window. Try the mindful eating exercise before any unplanned snack.");
    }

    if (foodRelationship === "very-emotional" && recs.length < 2) {
      recs.push("Pause before eating and ask: 'Am I actually hungry?' Rating hunger 1–10 is the single most effective habit for emotional eaters.");
    }

    if (recs.length === 0) {
      recs.push("Keep logging meals with mood context — patterns become visible after 5–7 entries.");
    }

    return recs.slice(0, 3);
  }

  // ============== MOOD-BASED MEAL RECOMMENDATIONS ==============

  /**
   * Get meal recommendations based on mood analysis
   * Uses historical data to find meals that improved user's mood
   */
  async getMoodBasedMealRecommendations(
    userId: string,
    currentMood?: {
      moodCategory: MoodCategory;
      moodLevel: number;
    }
  ) {
    const userIdObj = new mongoose.Types.ObjectId(userId);

    // Get meal-mood correlations where mood improved after eating
    const correlationsWithImprovement = await this.mealMoodModel
      .find({
        userId: userIdObj,
        moodBefore: { $exists: true },
        moodAfter: { $exists: true },
      })
      .lean()
      .exec();

    // Analyze which meals improved mood
    const mealScores: Record<string, {
      mealName: string;
      mealType: MealType;
      timesImproved: number;
      totalOccurrences: number;
      avgMoodImprovement: number;
      moods: MoodCategory[];
    }> = {};

    correlationsWithImprovement.forEach((correlation) => {
      const moodBefore = correlation.moodBefore?.moodLevel || 3;
      const moodAfter = correlation.moodAfter?.moodLevel || 3;
      const improvement = moodAfter - moodBefore;
      const mealKey = correlation.mealName.toLowerCase();

      if (!mealScores[mealKey]) {
        mealScores[mealKey] = {
          mealName: correlation.mealName,
          mealType: correlation.mealType,
          timesImproved: 0,
          totalOccurrences: 0,
          avgMoodImprovement: 0,
          moods: [],
        };
      }

      mealScores[mealKey].totalOccurrences++;
      if (improvement > 0) {
        mealScores[mealKey].timesImproved++;
      }
      mealScores[mealKey].avgMoodImprovement =
        (mealScores[mealKey].avgMoodImprovement * (mealScores[mealKey].totalOccurrences - 1) + improvement) /
        mealScores[mealKey].totalOccurrences;

      if (correlation.moodBefore?.moodCategory) {
        mealScores[mealKey].moods.push(correlation.moodBefore.moodCategory);
      }
    });

    // Sort meals by improvement score
    const sortedMeals = Object.values(mealScores)
      .filter((m) => m.totalOccurrences >= 1) // At least used once
      .sort((a, b) => {
        // Primary: average mood improvement
        // Secondary: consistency (times improved / total)
        const aScore = a.avgMoodImprovement + (a.timesImproved / a.totalOccurrences);
        const bScore = b.avgMoodImprovement + (b.timesImproved / b.totalOccurrences);
        return bScore - aScore;
      });

    // Get mood-specific recommendations based on current mood
    let moodSpecificSuggestions: string[] = [];
    if (currentMood) {
      const moodCategory = currentMood.moodCategory;

      // Find meals that specifically helped when user had this mood before
      const mealsForMood = sortedMeals.filter((m) =>
        m.moods.includes(moodCategory) && m.avgMoodImprovement > 0
      );

      moodSpecificSuggestions = mealsForMood.slice(0, 3).map((m) => m.mealName);
    }

    // Generate AI suggestions based on mood
    const moodFoodSuggestions = this.getMoodBasedFoodSuggestions(
      currentMood?.moodCategory || "neutral",
      currentMood?.moodLevel || 3
    );

    return {
      success: true,
      data: {
        historicalRecommendations: sortedMeals.slice(0, 5).map((m) => ({
          mealName: m.mealName,
          mealType: m.mealType,
          avgMoodImprovement: Math.round(m.avgMoodImprovement * 100) / 100,
          successRate: Math.round((m.timesImproved / m.totalOccurrences) * 100),
        })),
        moodSpecificRecommendations: moodSpecificSuggestions,
        currentMood: currentMood || null,
        foodSuggestions: moodFoodSuggestions,
      },
    };
  }

  /**
   * Get food suggestions based on mood (nutritional science)
   */
  private getMoodBasedFoodSuggestions(
    moodCategory: MoodCategory,
    moodLevel: number
  ): {
    recommended: string[];
    nutrients: string[];
    avoid: string[];
    reasoning: string;
  } {
    const suggestions: Record<MoodCategory, {
      recommended: string[];
      nutrients: string[];
      avoid: string[];
      reasoning: string;
    }> = {
      stressed: {
        recommended: [
          "dark chocolate",
          "avocado",
          "green tea",
          "blueberries",
          "salmon",
          "chamomile tea",
          "nuts and seeds",
          "oatmeal",
        ],
        nutrients: ["magnesium", "omega-3", "vitamin B", "antioxidants"],
        avoid: ["caffeine", "sugar", "processed foods", "alcohol"],
        reasoning: "When stressed, foods rich in magnesium and omega-3s help reduce cortisol levels and promote relaxation.",
      },
      anxious: {
        recommended: [
          "turkey",
          "eggs",
          "yogurt",
          "fermented foods",
          "leafy greens",
          "turmeric",
          "chamomile",
          "fatty fish",
        ],
        nutrients: ["tryptophan", "probiotics", "zinc", "omega-3"],
        avoid: ["caffeine", "alcohol", "refined sugar", "artificial sweeteners"],
        reasoning: "Anxiety is linked to gut health. Probiotic-rich foods and tryptophan help produce calming neurotransmitters.",
      },
      sad: {
        recommended: [
          "salmon",
          "walnuts",
          "dark chocolate",
          "bananas",
          "berries",
          "spinach",
          "lentils",
          "mushrooms",
        ],
        nutrients: ["omega-3", "vitamin D", "vitamin B12", "folate", "serotonin precursors"],
        avoid: ["processed foods", "excess sugar", "alcohol"],
        reasoning: "Low mood can be improved with omega-3s, vitamin D, and foods that support serotonin production.",
      },
      tired: {
        recommended: [
          "eggs",
          "sweet potatoes",
          "quinoa",
          "lean meats",
          "beans",
          "spinach",
          "oranges",
          "almonds",
        ],
        nutrients: ["iron", "complex carbs", "protein", "B vitamins", "vitamin C"],
        avoid: ["simple sugars", "heavy meals", "excessive caffeine"],
        reasoning: "Fatigue often indicates need for steady energy. Complex carbs and iron-rich foods provide sustained energy.",
      },
      energetic: {
        recommended: [
          "lean proteins",
          "whole grains",
          "fresh fruits",
          "vegetables",
          "water",
          "green smoothies",
        ],
        nutrients: ["balanced macros", "hydration", "antioxidants"],
        avoid: ["excess sugar", "heavy fried foods"],
        reasoning: "Maintain your energy with balanced, nutritious meals that won't cause a crash.",
      },
      happy: {
        recommended: [
          "colorful vegetables",
          "fresh fruits",
          "whole grains",
          "lean proteins",
          "social foods",
        ],
        nutrients: ["balanced nutrition", "fiber", "vitamins"],
        avoid: ["overindulgence", "ultra-processed foods"],
        reasoning: "When happy, maintain your mood with balanced, nutritious meals and mindful eating.",
      },
      calm: {
        recommended: [
          "herbal teas",
          "light meals",
          "Mediterranean foods",
          "fresh salads",
          "fish",
          "olive oil",
        ],
        nutrients: ["healthy fats", "light proteins", "hydration"],
        avoid: ["heavy meals", "stimulants"],
        reasoning: "Maintain your peaceful state with light, nutritious Mediterranean-style eating.",
      },
      neutral: {
        recommended: [
          "balanced meals",
          "variety of colors",
          "whole foods",
          "lean proteins",
          "vegetables",
          "fruits",
        ],
        nutrients: ["balanced macros", "fiber", "vitamins", "minerals"],
        avoid: ["processed foods", "excess sugar"],
        reasoning: "Balanced nutrition helps maintain stable mood and energy throughout the day.",
      },
      angry: {
        recommended: [
          "chamomile tea",
          "complex carbs",
          "bananas",
          "almonds",
          "leafy greens",
          "whole grains",
          "avocado",
        ],
        nutrients: ["magnesium", "B vitamins", "complex carbs", "omega-3"],
        avoid: ["caffeine", "alcohol", "spicy foods", "excess sugar"],
        reasoning: "Anger can be soothed with calming foods. Magnesium and complex carbs help stabilize mood.",
      },
    };

    return suggestions[moodCategory] || suggestions.neutral;
  }

  // ============== STATS ENDPOINT ==============

  async getCBTStats(userId: string) {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const today = new Date().toISOString().split("T")[0];

    // Get counts
    const [
      moodEntriesLogged,
      thoughtEntriesLogged,
      exercisesCompleted,
      mealMoodCorrelationsLogged,
    ] = await Promise.all([
      this.moodModel.countDocuments({ userId: userIdObj }),
      this.thoughtModel.countDocuments({ userId: userIdObj }),
      this.exerciseCompletionModel.countDocuments({ userId: userIdObj }),
      this.mealMoodModel.countDocuments({ userId: userIdObj }),
    ]);

    // Calculate mood check streak
    const moodCheckStreak = await this.calculateStreak(userIdObj, "mood");

    // Calculate CBT activity streak (any activity)
    const cbtActivityStreak = await this.calculateActivityStreak(userIdObj);

    // Calculate emotional eating awareness score
    const emotionalEatingAwareness =
      await this.calculateEmotionalEatingAwareness(userIdObj);

    return {
      success: true,
      data: {
        stats: {
          moodEntriesLogged,
          thoughtEntriesLogged,
          exercisesCompleted,
          moodCheckStreak,
          cbtActivityStreak,
          emotionalEatingAwareness,
          mealMoodCorrelationsLogged,
        },
      },
    };
  }

  private async calculateStreak(
    userId: mongoose.Types.ObjectId,
    type: "mood"
  ): Promise<number> {
    const dates = await this.moodModel.distinct("date", { userId });
    return this.countConsecutiveDays(dates);
  }

  private async calculateActivityStreak(
    userId: mongoose.Types.ObjectId
  ): Promise<number> {
    // Get all dates with any CBT activity
    const [moodDates, thoughtDates, exerciseDates] = await Promise.all([
      this.moodModel.distinct("date", { userId }),
      this.thoughtModel.distinct("date", { userId }),
      this.exerciseCompletionModel.distinct("date", { userId }),
    ]);

    const allDates = [...new Set([...moodDates, ...thoughtDates, ...exerciseDates])];
    return this.countConsecutiveDays(allDates);
  }

  private countConsecutiveDays(dates: string[]): number {
    if (dates.length === 0) return 0;

    const sortedDates = dates.sort((a, b) => b.localeCompare(a)); // Sort descending
    const today = new Date().toISOString().split("T")[0];

    // Check if most recent activity was today or yesterday
    if (sortedDates[0] !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (sortedDates[0] !== yesterday.toISOString().split("T")[0]) {
        return 0; // Streak is broken
      }
    }

    let streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const currentDate = new Date(sortedDates[i - 1]);
      const prevDate = new Date(sortedDates[i]);

      const diffDays = Math.floor(
        (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  private async calculateEmotionalEatingAwareness(
    userId: mongoose.Types.ObjectId
  ): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split("T")[0];

    const [totalCorrelations, identifiedEmotional] = await Promise.all([
      this.mealMoodModel.countDocuments({
        userId,
        date: { $gte: startDate },
      }),
      this.mealMoodModel.countDocuments({
        userId,
        date: { $gte: startDate },
        wasEmotionalEating: true,
      }),
    ]);

    // Score based on tracking consistency and awareness
    // Max 100 points: 50 for tracking, 50 for identifying emotional eating
    if (totalCorrelations === 0) return 0;

    const trackingScore = Math.min(50, totalCorrelations * 2); // 2 points per entry, max 50
    const awarenessScore = identifiedEmotional > 0 ? 50 : 25; // Full points if identifying, partial if just tracking

    return Math.round(trackingScore + awarenessScore);
  }
}
