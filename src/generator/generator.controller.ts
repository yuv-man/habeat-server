import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
  ParseBoolPipe,
  Param,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { GeneratorService } from "./generator.service";
import { AuthGuard } from "../auth/auth.guard";
import {
  GenerateWeeklyMealPlanDto,
  GenerateRecipeDto,
  GenerateGoalDto,
  ChangeMealDto,
} from "./dto";
import {
  WeeklyMealPlanResponse,
  RecipeResponse,
  GoalResponse,
  MealSuggestionsResponse,
} from "./subjects";

@ApiTags("generate")
@Controller("generate")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class GeneratorController {
  constructor(
    private generatorService: GeneratorService,
    private configService: ConfigService
  ) {}

  @Post("weekly-meal-plan/:userId")
  @ApiOperation({
    summary: "Generate a weekly meal plan using AI",
    description: `Generates a personalized weekly meal plan based on user data. 

**Authenticated User Context:**
The user information is automatically extracted from the JWT token via the AuthGuard. The following user fields are available:
- \`_id\`: User ID (automatically used)
- \`email\`: User email
- \`name\`: User name
- \`age\`: User age
- \`gender\`: User gender (male/female)
- \`height\`: User height in cm
- \`weight\`: User weight in kg
- \`workoutFrequency\`: Number of workouts per week (1-7)
- \`path\`: Health path (healthy/lose/muscle/keto/fasting/custom)
- \`allergies\`: Food allergies array
- \`dietaryRestrictions\`: Dietary restrictions array

**Query Parameters:**
Optional parameters that can be passed as query strings or in the request body. Query parameters take precedence.`,
  })
  @ApiQuery({
    name: "language",
    required: false,
    type: String,
    description:
      "Language for the meal plan (e.g., 'en', 'es', 'fr'). Default: 'en'",
    example: "en",
  })
  @ApiQuery({
    name: "title",
    required: false,
    type: String,
    description: "Title for the meal plan. Default: 'My Meal Plan'",
    example: "My Meal Plan",
  })
  @ApiQuery({
    name: "useMock",
    required: false,
    type: Boolean,
    description: "Use mock data instead of AI generation. Default: false",
    example: false,
  })
  @ApiResponse({
    status: 201,
    description: "Weekly meal plan generated successfully",
    type: WeeklyMealPlanResponse,
  })
  @ApiResponse({
    status: 400,
    description:
      "Invalid user data or meal plan generation failed. The AI service may have failed to generate a valid meal plan.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({
    status: 500,
    description:
      "Internal server error. The meal plan generation service may be unavailable or overloaded.",
  })
  async generateWeeklyMealPlan(
    @Param("userId") userId: string,
    @Body() body: GenerateWeeklyMealPlanDto,
    @Query("language") language?: string,
    @Query("title") title?: string,
    @Query("useMock", new ParseBoolPipe({ optional: true })) useMock?: boolean
  ) {
    // User information is automatically extracted from JWT token via AuthGuard
    // req.user contains: _id, email, name, age, gender, height, weight, etc.

    return this.generatorService.generateWeeklyMealPlan(
      userId,
      body.startDate,
      language || body.language,
      title || body.title,
      useMock !== undefined ? useMock : body.useMock || false
    );
  }

  @Post("recipe")
  @ApiOperation({ summary: "Generate detailed recipe for a meal" })
  @ApiResponse({
    status: 200,
    description: "Recipe generated successfully",
    type: RecipeResponse,
  })
  @ApiResponse({ status: 400, description: "Dish name is required" })
  async generateRecipeForMeal(@Body() body: GenerateRecipeDto) {
    return this.generatorService.generateRecipeForMeal(
      body.dishName,
      body.category || "dinner",
      body.ingredients || [],
      body.servings || 1,
      body.targetCalories || 500,
      body.dietaryRestrictions || [],
      body.language || "en"
    );
  }

  @Post("goal")
  @ApiOperation({ summary: "Generate a goal based on user criteria" })
  @ApiResponse({
    status: 200,
    description: "Goal generated successfully",
    type: GoalResponse,
  })
  @ApiResponse({ status: 400, description: "Invalid criteria" })
  @ApiResponse({ status: 404, description: "User not found" })
  async generateGoal(@Request() req, @Body() body: GenerateGoalDto) {
    return this.generatorService.generateGoal(
      req.user._id.toString(),
      body.title,
      body.description,
      body.category,
      body.targetDate,
      body.startDate,
      body.language || "en"
    );
  }

  @Post("meal-suggestions/:userId")
  @ApiOperation({
    summary: "Generate meal suggestions based on user and meal criteria",
  })
  @ApiResponse({
    status: 200,
    description: "Meal generated successfully",
    type: MealSuggestionsResponse,
  })
  @ApiResponse({ status: 400, description: "Invalid meal criteria" })
  @ApiResponse({ status: 404, description: "User not found" })
  async changeMeal(
    @Param("userId") userId: string,
    @Body() body: ChangeMealDto
  ) {
    return this.generatorService.generateMealSuggestions(
      userId,
      {
        ...body.mealCriteria,
        aiRules: body.aiRules,
        numberOfSuggestions:
          body.mealCriteria.numberOfSuggestions ||
          this.configService.get<number>("NUMBER_OF_SUGGESTIONS") ||
          3,
      },
      body.language || "en"
    );
  }

  @Post("rescue-meal/:userId/:planId")
  @ApiOperation({
    summary: 'Generate and swap a quick rescue meal (I\'m Tired button)',
    description: `Instantly generates a quick "rescue meal" (<=10 min prep time) and swaps it with the current meal.

**Features:**
- Maximum 10 minute preparation time
- Matches similar macros to the original meal (±20% tolerance)
- Follows user's dietary restrictions and preferences
- AI-generated for variety
- Atomic operation: generates and swaps in one API call

**Use Case:**
This endpoint powers the "I'm Tired / No Time" button feature, providing instant meal swaps when users don't have time to cook the planned meal.`,
  })
  @ApiResponse({
    status: 200,
    description: "Rescue meal generated and swapped successfully",
    schema: {
      example: {
        success: true,
        message: "Swapped to quick meal: Greek Yogurt Power Bowl",
        data: {
          rescueMeal: {
            _id: "65a123...",
            name: "Greek Yogurt Power Bowl",
            calories: 485,
            macros: { protein: 32, carbs: 48, fat: 14 },
            category: "lunch",
            ingredients: [["greek_yogurt", "200 g"], ["mixed_berries", "100 g"]],
            prepTime: 5,
            done: false,
          },
          originalMealName: "Grilled Chicken Salad",
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid meal type (must be breakfast, lunch, or dinner)" })
  @ApiResponse({ status: 404, description: "User, plan, or meal not found" })
  async generateRescueMeal(
    @Param("userId") userId: string,
    @Param("planId") planId: string,
    @Body()
    body: {
      date: string;
      mealType: "breakfast" | "lunch" | "dinner";
      targetCalories?: number;
      targetMacros?: { protein: number; carbs: number; fat: number };
      language?: string;
    }
  ) {
    // Validate mealType is not snack (rescue meals only for main meals)
    if (!["breakfast", "lunch", "dinner"].includes(body.mealType)) {
      throw new Error(
        "Rescue meals are only available for breakfast, lunch, or dinner"
      );
    }

    return this.generatorService.generateAndSwapRescueMeal(
      userId,
      planId,
      body.date,
      body.mealType,
      {
        calories: body.targetCalories || 500,
        macros: body.targetMacros,
      },
      body.language || "en"
    );
  }
}
