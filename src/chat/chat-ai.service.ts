import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { User } from "../user/user.model";
import { Plan } from "../plan/plan.model";
import { Goal } from "../goals/goal.model";
import { DailyProgress } from "../progress/progress.model";
import {
  IUserData,
  IPlan,
  IGoal,
  IDailyProgress,
  IProposedAction,
  IMeal,
} from "../types/interfaces";
import logger from "../utils/logger";
import { getLocalDateKey } from "../utils/helpers";

interface ChatContext {
  currentScreen?: string;
  selectedDate?: string;
}

interface AIResponse {
  message: string;
  action?: IProposedAction;
}

// Helper to get error message
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

// Helper to extract and clean JSON from response
const extractActionJSON = (text: string): string | null => {
  const actionMatch = text.match(/```action\s*\n?([\s\S]*?)\n?```/);
  if (actionMatch) {
    return actionMatch[1].trim();
  }
  return null;
};

// Helper to get path description
const getPathDescription = (path: string): string => {
  const descriptions: Record<string, string> = {
    "lose-weight": "Weight loss - calorie deficit focus",
    "gain-muscle": "Muscle building - high protein, calorie surplus",
    healthy: "Balanced healthy eating",
    keto: "Ketogenic diet - low carb, high fat",
    running: "Endurance training - high carbs for energy",
    fasting: "Intermittent fasting schedule",
  };
  return descriptions[path] || "General health";
};

@Injectable()
export class ChatAIService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    @InjectModel(Goal.name) private goalModel: Model<IGoal>,
    @InjectModel(DailyProgress.name)
    private progressModel: Model<IDailyProgress>
  ) {}

  /**
   * Get user's current plan
   */
  async getUserPlan(userId: string): Promise<IPlan | null> {
    return this.planModel
      .findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .exec();
  }

  /**
   * Build context from user data, plan, goals, and progress
   */
  private async buildContext(userId: string): Promise<{
    user: IUserData | null;
    plan: IPlan | null;
    goals: IGoal[];
    todayProgress: IDailyProgress | null;
    todayMeals: any;
  }> {
    const objectId = new mongoose.Types.ObjectId(userId);
    const today = getLocalDateKey(new Date());

    const [user, plan, goals, todayProgress] = await Promise.all([
      this.userModel.findById(objectId).lean().exec(),
      this.planModel.findOne({ userId: objectId }).lean().exec(),
      this.goalModel.find({ userId: objectId, status: "active" }).lean().exec(),
      this.progressModel.findOne({ userId: objectId, dateKey: today }).lean().exec(),
    ]);

    // Get today's meals from plan
    let todayMeals = null;
    if (plan?.weeklyPlan?.[today]) {
      todayMeals = plan.weeklyPlan[today].meals;
    }

    return {
      user: user as IUserData | null,
      plan: plan as IPlan | null,
      goals: goals as IGoal[],
      todayProgress: todayProgress as IDailyProgress | null,
      todayMeals,
    };
  }

  /**
   * Generate system prompt with user context
   */
  private generateSystemPrompt(
    user: IUserData | null,
    plan: IPlan | null,
    goals: IGoal[],
    todayProgress: IDailyProgress | null,
    todayMeals: any,
    context?: ChatContext
  ): string {
    const today = getLocalDateKey(new Date());

    let prompt = `You are a friendly and knowledgeable nutrition assistant for the Habeat meal planning app.

## Your Role:
- Provide personalized nutrition advice based on the user's profile and goals
- Answer questions about nutrition, meals, and fitness
- Suggest improvements to the user's meal plan when appropriate
- Help users make healthier choices aligned with their goals

## Important Guidelines:
- Be conversational, supportive, and encouraging
- Keep responses concise (2-4 paragraphs max)
- When suggesting changes, be specific and practical
- Consider user's allergies, restrictions, and preferences
- Only propose actions when the user asks for a change or there's a clear benefit

`;

    if (user) {
      prompt += `## User Profile:
- Name: ${user.name || "User"}
- Age: ${user.age || "Not specified"}, Gender: ${user.gender || "Not specified"}
- Height: ${user.height ? `${user.height}cm` : "Not specified"}, Weight: ${user.weight ? `${user.weight}kg` : "Not specified"}
- Goal Path: ${user.path || "healthy"} (${getPathDescription(user.path || "healthy")})
- Allergies: ${user.allergies?.length ? user.allergies.join(", ") : "None"}
- Dietary Restrictions: ${user.dietaryRestrictions?.length ? user.dietaryRestrictions.join(", ") : "None"}
- Food Preferences: ${user.foodPreferences?.length ? user.foodPreferences.join(", ") : "None"}
- Dislikes: ${user.dislikes?.length ? user.dislikes.join(", ") : "None"}
${user.fastingHours ? `- Fasting: ${user.fastingHours} hours starting at ${user.fastingStartTime || "not specified"}` : ""}

`;
    }

    if (plan?.userMetrics) {
      prompt += `## Daily Targets:
- Calories: ${plan.userMetrics.targetCalories || "Not set"} kcal
- Protein: ${plan.userMetrics.dailyMacros?.protein || "Not set"}g
- Carbs: ${plan.userMetrics.dailyMacros?.carbs || "Not set"}g
- Fat: ${plan.userMetrics.dailyMacros?.fat || "Not set"}g

`;
    }

    if (goals.length > 0) {
      prompt += `## Active Goals:
${goals.map((g) => `- ${g.title}: ${g.current}/${g.target} ${g.unit}`).join("\n")}

`;
    }

    if (todayProgress) {
      prompt += `## Today's Progress (${today}):
- Calories: ${todayProgress.caloriesConsumed || 0}/${todayProgress.caloriesGoal || 0} kcal
- Protein: ${todayProgress.protein?.consumed || 0}/${todayProgress.protein?.goal || 0}g
- Carbs: ${todayProgress.carbs?.consumed || 0}/${todayProgress.carbs?.goal || 0}g
- Fat: ${todayProgress.fat?.consumed || 0}/${todayProgress.fat?.goal || 0}g
- Water: ${todayProgress.water?.consumed || 0}/${todayProgress.water?.goal || 8} glasses
- Workouts: ${todayProgress.workouts?.filter((w) => w.done).length || 0}/${todayProgress.workouts?.length || 0} completed

`;
    }

    if (todayMeals) {
      prompt += `## Today's Meal Plan:
- Breakfast: ${todayMeals.breakfast?.name || "Not planned"} (${todayMeals.breakfast?.calories || 0} kcal)
- Lunch: ${todayMeals.lunch?.name || "Not planned"} (${todayMeals.lunch?.calories || 0} kcal)
- Dinner: ${todayMeals.dinner?.name || "Not planned"} (${todayMeals.dinner?.calories || 0} kcal)
- Snacks: ${todayMeals.snacks?.length ? todayMeals.snacks.map((s: IMeal) => s.name).join(", ") : "None"}

`;
    }

    if (context?.currentScreen) {
      prompt += `## Current Context:
- User is viewing: ${context.currentScreen}
${context.selectedDate ? `- Selected date: ${context.selectedDate}` : ""}

`;
    }

    prompt += `## Proposing Actions:
When you want to suggest a specific change to the meal plan or workouts, include a JSON block at the END of your response in this EXACT format:

For meal swaps:
\`\`\`action
{
  "type": "meal_swap",
  "dateKey": "${today}",
  "mealType": "lunch",
  "currentMeal": {
    "name": "Current Meal Name",
    "calories": 500
  },
  "proposedMeal": {
    "name": "Grilled Chicken Salad",
    "calories": 450,
    "macros": { "protein": 35, "carbs": 20, "fat": 15 },
    "category": "lunch",
    "ingredients": [["chicken breast", "150g", "Proteins"], ["mixed greens", "100g", "Vegetables"]],
    "prepTime": 15
  },
  "reason": "Better aligned with your protein goals"
}
\`\`\`

For adding workouts:
\`\`\`action
{
  "type": "workout_change",
  "dateKey": "${today}",
  "action": "add",
  "proposedWorkout": {
    "name": "Morning Run",
    "category": "cardio",
    "duration": 30,
    "caloriesBurned": 300
  },
  "reason": "Great for your weight loss goal"
}
\`\`\`

For adding snacks:
\`\`\`action
{
  "type": "add_snack",
  "dateKey": "${today}",
  "proposedSnack": {
    "name": "Greek Yogurt with Berries",
    "calories": 150,
    "macros": { "protein": 15, "carbs": 20, "fat": 3 },
    "category": "snack",
    "ingredients": [["greek yogurt", "150g", "Dairy"], ["mixed berries", "50g", "Fruits"]],
    "prepTime": 5
  },
  "reason": "Healthy protein-rich snack"
}
\`\`\`

IMPORTANT:
- Only propose ONE action per response
- Only propose actions when the user asks for a change or it's clearly beneficial
- The action block must be at the very end of your response
- Make sure the JSON is valid and complete
`;

    return prompt;
  }

  /**
   * Generate AI response for user message
   */
  async generateResponse(
    userId: string,
    userMessage: string,
    context?: ChatContext
  ): Promise<AIResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error("[ChatAI] GEMINI_API_KEY not configured");
      return {
        message:
          "I apologize, but I'm unable to respond right now. Please try again later.",
      };
    }

    try {
      // Build context
      const { user, plan, goals, todayProgress, todayMeals } =
        await this.buildContext(userId);

      // Generate system prompt
      const systemPrompt = this.generateSystemPrompt(
        user,
        plan,
        goals,
        todayProgress,
        todayMeals,
        context
      );

      // Call Gemini
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const fullPrompt = `${systemPrompt}

## User Message:
${userMessage}

## Your Response:`;

      logger.info(`[ChatAI] Sending message to Gemini...`);

      const result = await model.generateContent([{ text: fullPrompt }]);

      if (!result?.response) {
        throw new Error("Empty response from Gemini");
      }

      const responseText = result.response.text();
      logger.info(`[ChatAI] Received response: ${responseText.length} chars`);

      // Parse response for actions
      const actionJSON = extractActionJSON(responseText);
      let action: IProposedAction | undefined;

      if (actionJSON) {
        try {
          const parsedAction = JSON.parse(actionJSON);
          action = {
            type: parsedAction.type,
            payload: parsedAction,
            status: "pending",
          };
          logger.info(`[ChatAI] Extracted action: ${parsedAction.type}`);
        } catch (parseError) {
          logger.warn(
            `[ChatAI] Failed to parse action JSON: ${getErrorMessage(parseError)}`
          );
        }
      }

      // Clean the message (remove action block)
      let cleanMessage = responseText
        .replace(/```action\s*\n?[\s\S]*?\n?```/g, "")
        .trim();

      return {
        message: cleanMessage,
        action,
      };
    } catch (error) {
      logger.error(`[ChatAI] Error generating response: ${getErrorMessage(error)}`);

      // Try fallback models
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const fallbackModels = ["gemini-2.0-flash", "gemini-2.0-flash-001"];

        for (const modelName of fallbackModels) {
          try {
            logger.info(`[ChatAI] Trying fallback model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent([
              {
                text: `You are a helpful nutrition assistant. Answer this question briefly: ${userMessage}`,
              },
            ]);

            if (result?.response) {
              return {
                message: result.response.text(),
              };
            }
          } catch (fallbackError) {
            logger.warn(
              `[ChatAI] Fallback ${modelName} failed: ${getErrorMessage(fallbackError)}`
            );
          }
        }
      } catch (fallbackError) {
        logger.error(
          `[ChatAI] All fallbacks failed: ${getErrorMessage(fallbackError)}`
        );
      }

      return {
        message:
          "I'm having trouble connecting right now. Please try again in a moment.",
      };
    }
  }
}
