import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "../user/user.model";
import { DailyProgress } from "../progress/progress.model";
import {
  IUserData,
  INotificationPreferences,
  NotificationType,
} from "../types/interfaces";
import logger from "../utils/logger";

// Motivational messages by category
const MOTIVATIONAL_MESSAGES = {
  morning: [
    { title: "Good morning!", body: "Start your day right with a healthy breakfast" },
    { title: "Rise and shine!", body: "Your body is ready for some fuel" },
    { title: "New day, new goals!", body: "Let's make today count" },
  ],
  streak: [
    { title: "Keep it going!", body: "You're on a roll - don't break your streak!" },
    { title: "Streak power!", body: "Your consistency is paying off" },
    { title: "You're unstoppable!", body: "Another day closer to your goals" },
  ],
  encouragement: [
    { title: "You've got this!", body: "Every healthy choice matters" },
    { title: "Small steps, big results!", body: "Keep making progress" },
    { title: "Believe in yourself!", body: "You're stronger than you think" },
  ],
  achievement: [
    { title: "Amazing progress!", body: "Look how far you've come" },
    { title: "Crushing it!", body: "Your dedication is inspiring" },
    { title: "Star performer!", body: "Keep up the great work" },
  ],
};

// Meal reminder messages
const MEAL_REMINDERS = {
  breakfast: [
    { title: "Breakfast time!", body: "Fuel your morning with a nutritious breakfast" },
    { title: "Good morning!", body: "Don't forget to log your breakfast" },
    { title: "Start your day!", body: "A healthy breakfast awaits" },
  ],
  lunch: [
    { title: "Lunch break!", body: "Time to refuel and recharge" },
    { title: "Midday meal!", body: "Keep your energy up with lunch" },
    { title: "Hungry yet?", body: "Don't forget to log your lunch" },
  ],
  dinner: [
    { title: "Dinner time!", body: "End your day with a balanced meal" },
    { title: "Evening meal!", body: "Time to wind down with dinner" },
    { title: "Almost done!", body: "Log your dinner to complete your day" },
  ],
  snacks: [
    { title: "Snack time!", body: "A healthy snack can boost your energy" },
    { title: "Need a boost?", body: "Time for a nutritious snack" },
  ],
};

// Streak warning messages
const STREAK_WARNINGS = [
  { title: "Don't lose your streak!", body: "Log a meal today to keep your {streak}-day streak alive" },
  { title: "Streak alert!", body: "Your {streak}-day streak is on the line - log something!" },
  { title: "Quick reminder!", body: "One meal away from keeping your {streak}-day streak" },
];

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(DailyProgress.name) private progressModel: Model<any>
  ) {}

  /**
   * Get default notification preferences
   */
  getDefaultPreferences(): INotificationPreferences {
    return {
      enabled: true,
      mealReminders: {
        enabled: true,
        breakfast: { enabled: true, time: "08:00" },
        lunch: { enabled: true, time: "12:00" },
        dinner: { enabled: true, time: "19:00" },
        snacks: { enabled: false, time: "15:00" },
      },
      streakAlerts: { enabled: true, warningTime: "20:00" },
      challengeUpdates: { enabled: true, onComplete: true, onExpiring: true },
      achievements: { enabled: true, levelUp: true, badgeEarned: true },
      weeklySummary: { enabled: true, dayOfWeek: 0, time: "09:00" },
      dailySummary: { enabled: false, time: "21:00" },
      motivationalNudges: { enabled: true, frequency: "occasional" },
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
    };
  }

  /**
   * Get user's notification preferences
   */
  async getPreferences(userId: string): Promise<INotificationPreferences> {
    const user = await this.userModel.findById(userId).lean() as any;
    if (!user) {
      throw new Error("User not found");
    }
    return user.notificationPreferences || this.getDefaultPreferences();
  }

  /**
   * Update user's notification preferences
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<INotificationPreferences>
  ): Promise<INotificationPreferences> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Merge with existing preferences
    const currentPrefs = (user as any).notificationPreferences || this.getDefaultPreferences();
    const updatedPrefs = this.deepMerge(currentPrefs, preferences);

    (user as any).notificationPreferences = updatedPrefs;
    user.markModified("notificationPreferences");
    await user.save();

    logger.info(`[NotificationService] Updated preferences for user ${userId}`);
    return updatedPrefs;
  }

  /**
   * Register device token for push notifications
   */
  async registerDeviceToken(userId: string, token: string): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const tokens = (user as any).deviceTokens || [];
    if (!tokens.includes(token)) {
      tokens.push(token);
      (user as any).deviceTokens = tokens;
      await user.save();
      logger.info(`[NotificationService] Registered device token for user ${userId}`);
    }
  }

  /**
   * Remove device token
   */
  async removeDeviceToken(userId: string, token: string): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const tokens = (user as any).deviceTokens || [];
    const index = tokens.indexOf(token);
    if (index > -1) {
      tokens.splice(index, 1);
      (user as any).deviceTokens = tokens;
      await user.save();
      logger.info(`[NotificationService] Removed device token for user ${userId}`);
    }
  }

  /**
   * Check if current time is within quiet hours
   */
  isQuietHours(preferences: INotificationPreferences): boolean {
    if (!preferences.quietHours?.enabled) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = preferences.quietHours.start.split(":").map(Number);
    const [endHour, endMinute] = preferences.quietHours.end.split(":").map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    }

    return currentTime >= startTime && currentTime <= endTime;
  }

  /**
   * Get meal reminder notification payload
   */
  getMealReminderPayload(
    mealType: "breakfast" | "lunch" | "dinner" | "snacks"
  ): NotificationPayload {
    const messages = MEAL_REMINDERS[mealType];
    const message = messages[Math.floor(Math.random() * messages.length)];
    return {
      type: "meal_reminder",
      title: message.title,
      body: message.body,
      data: { mealType },
    };
  }

  /**
   * Get streak warning notification payload
   */
  getStreakWarningPayload(currentStreak: number): NotificationPayload {
    const template = STREAK_WARNINGS[Math.floor(Math.random() * STREAK_WARNINGS.length)];
    return {
      type: "streak_warning",
      title: template.title,
      body: template.body.replace("{streak}", currentStreak.toString()),
      data: { streak: currentStreak },
    };
  }

  /**
   * Get challenge complete notification payload
   */
  getChallengeCompletePayload(
    challengeTitle: string,
    xpReward: number
  ): NotificationPayload {
    return {
      type: "challenge_complete",
      title: "Challenge Complete!",
      body: `You completed "${challengeTitle}" and earned ${xpReward} XP!`,
      data: { challengeTitle, xpReward },
    };
  }

  /**
   * Get challenge expiring notification payload
   */
  getChallengeExpiringPayload(
    challengeTitle: string,
    hoursLeft: number
  ): NotificationPayload {
    return {
      type: "challenge_expiring",
      title: "Challenge Expiring Soon!",
      body: `"${challengeTitle}" expires in ${hoursLeft} hours. Finish it to earn XP!`,
      data: { challengeTitle, hoursLeft },
    };
  }

  /**
   * Get level up notification payload
   */
  getLevelUpPayload(newLevel: number): NotificationPayload {
    return {
      type: "level_up",
      title: "Level Up!",
      body: `Congratulations! You've reached Level ${newLevel}!`,
      data: { level: newLevel },
    };
  }

  /**
   * Get badge earned notification payload
   */
  getBadgeEarnedPayload(badgeName: string, badgeDescription: string): NotificationPayload {
    return {
      type: "badge_earned",
      title: "New Badge Earned!",
      body: `You earned "${badgeName}" - ${badgeDescription}`,
      data: { badgeName },
    };
  }

  /**
   * Get motivational notification payload
   */
  getMotivationalPayload(category?: keyof typeof MOTIVATIONAL_MESSAGES): NotificationPayload {
    const categories = Object.keys(MOTIVATIONAL_MESSAGES) as (keyof typeof MOTIVATIONAL_MESSAGES)[];
    const selectedCategory = category || categories[Math.floor(Math.random() * categories.length)];
    const messages = MOTIVATIONAL_MESSAGES[selectedCategory];
    const message = messages[Math.floor(Math.random() * messages.length)];

    return {
      type: "motivational",
      title: message.title,
      body: message.body,
      data: { category: selectedCategory },
    };
  }

  /**
   * Get scheduled notifications for a user
   * This returns the notifications that should be scheduled on the client
   */
  async getScheduledNotifications(userId: string): Promise<NotificationPayload[]> {
    const preferences = await this.getPreferences(userId);
    const notifications: NotificationPayload[] = [];

    if (!preferences.enabled) {
      return notifications;
    }

    // Add meal reminders
    if (preferences.mealReminders.enabled) {
      const mealTypes: ("breakfast" | "lunch" | "dinner" | "snacks")[] = [
        "breakfast",
        "lunch",
        "dinner",
        "snacks",
      ];
      for (const mealType of mealTypes) {
        const mealPref = preferences.mealReminders[mealType];
        if (mealPref.enabled) {
          notifications.push(this.getMealReminderPayload(mealType));
        }
      }
    }

    return notifications;
  }

  /**
   * Check if user needs streak warning today
   */
  async checkStreakWarning(userId: string): Promise<NotificationPayload | null> {
    const user = await this.userModel.findById(userId).lean() as any;
    if (!user?.engagement) return null;

    const preferences = user.notificationPreferences || this.getDefaultPreferences();
    if (!preferences.enabled || !preferences.streakAlerts.enabled) return null;

    const streak = user.engagement.streakDays;
    if (streak <= 0) return null;

    // Check if user has logged anything today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split("T")[0];

    const todayProgress = await this.progressModel.findOne({
      userId,
      dateKey: todayKey,
    }).lean() as any;

    // If no progress today and user has a streak, send warning
    if (!todayProgress) {
      return this.getStreakWarningPayload(streak);
    }

    // Check if any meals are logged
    const meals = todayProgress.meals;
    const hasActivity =
      meals?.breakfast?.done ||
      meals?.lunch?.done ||
      meals?.dinner?.done ||
      meals?.snacks?.some((s: any) => s.done);

    if (!hasActivity) {
      return this.getStreakWarningPayload(streak);
    }

    return null;
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === "object" && !Array.isArray(item);
  }
}
