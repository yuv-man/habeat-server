import { Injectable, NotFoundException } from "@nestjs/common";
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
} from "./cbt.model";
import {
  LogMoodDto,
  LogThoughtDto,
  UpdateThoughtDto,
  CompleteExerciseDto,
  LinkMoodToMealDto,
} from "./cbt.dto";
import logger from "../utils/logger";

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

@Injectable()
export class CBTService {
  constructor(
    @InjectModel(MoodEntry.name) private moodModel: Model<IMoodEntry>,
    @InjectModel(ThoughtEntry.name) private thoughtModel: Model<IThoughtEntry>,
    @InjectModel(CBTExerciseCompletion.name)
    private exerciseCompletionModel: Model<ICBTExerciseCompletion>,
    @InjectModel(MealMoodCorrelation.name)
    private mealMoodModel: Model<IMealMoodCorrelation>
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

    return {
      success: true,
      data: { mood: moodEntry },
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
    const correlation = await this.mealMoodModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      mealId: new mongoose.Types.ObjectId(dto.mealId),
      mealName: dto.mealName,
      mealType: dto.mealType,
      date: dto.date,
      moodBefore: dto.moodBefore,
      moodAfter: dto.moodAfter,
      wasEmotionalEating: dto.wasEmotionalEating,
      hungerLevelBefore: dto.hungerLevelBefore,
      satisfactionAfter: dto.satisfactionAfter,
      notes: dto.notes,
    });

    logger.info(
      `Meal-mood correlation logged for user ${userId}: ${dto.mealName}`
    );

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

  async getEmotionalEatingInsights(
    userId: string,
    period: "week" | "month" = "week"
  ) {
    const now = new Date();
    const startDate = new Date();

    if (period === "week") {
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate.setMonth(now.getMonth() - 1);
    }

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = now.toISOString().split("T")[0];

    const correlations = await this.mealMoodModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        date: { $gte: startDateStr, $lte: endDateStr },
      })
      .lean()
      .exec();

    // Calculate insights
    const totalMeals = correlations.length;
    const emotionalEatingInstances = correlations.filter(
      (c) => c.wasEmotionalEating
    ).length;
    const emotionalEatingPercentage =
      totalMeals > 0
        ? Math.round((emotionalEatingInstances / totalMeals) * 100)
        : 0;

    // Analyze triggers from related mood entries
    const emotionalMoods = await this.moodModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        date: { $gte: startDateStr, $lte: endDateStr },
        linkedMealId: { $exists: true },
      })
      .lean()
      .exec();

    const triggerCounts: Record<string, number> = {};
    const emotionCounts: Record<string, number> = {};

    emotionalMoods.forEach((mood) => {
      mood.triggers?.forEach((trigger) => {
        triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
      });
      emotionCounts[mood.moodCategory] =
        (emotionCounts[mood.moodCategory] || 0) + 1;
    });

    // Meal type breakdown
    const mealTypeBreakdown = {
      breakfast: correlations.filter(
        (c) => c.mealType === "breakfast" && c.wasEmotionalEating
      ).length,
      lunch: correlations.filter(
        (c) => c.mealType === "lunch" && c.wasEmotionalEating
      ).length,
      dinner: correlations.filter(
        (c) => c.mealType === "dinner" && c.wasEmotionalEating
      ).length,
      snacks: correlations.filter(
        (c) => c.mealType === "snacks" && c.wasEmotionalEating
      ).length,
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (emotionalEatingPercentage > 30) {
      recommendations.push(
        "Consider practicing urge surfing when you feel the urge to eat emotionally"
      );
    }

    if (mealTypeBreakdown.snacks > mealTypeBreakdown.breakfast + mealTypeBreakdown.lunch + mealTypeBreakdown.dinner) {
      recommendations.push(
        "Snacking seems to be your main emotional eating pattern. Try the mindful eating exercise before snacks"
      );
    }

    const topTrigger = Object.entries(triggerCounts).sort(
      ([, a], [, b]) => b - a
    )[0];
    if (topTrigger) {
      recommendations.push(
        `${topTrigger[0]} appears to be a common trigger. Try breathing exercises when you notice this trigger`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        "Keep tracking your meals and moods to identify patterns"
      );
    }

    return {
      success: true,
      data: {
        insight: {
          period: { start: startDateStr, end: endDateStr },
          totalMeals,
          emotionalEatingInstances,
          emotionalEatingPercentage,
          commonTriggers: Object.entries(triggerCounts)
            .map(([trigger, count]) => ({ trigger, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
          commonEmotions: Object.entries(emotionCounts)
            .map(([emotion, count]) => ({ emotion, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
          mealTypeBreakdown,
          recommendations,
        },
      },
    };
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
