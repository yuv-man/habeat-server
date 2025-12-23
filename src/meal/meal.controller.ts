import { Controller, Get, Query, Param, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { MealService } from "./meal.service";
import { AuthGuard } from "../auth/auth.guard";

@ApiTags("meals")
@Controller("meals")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class MealController {
  constructor(private mealService: MealService) {}

  @Get("recipe")
  @ApiOperation({ summary: "Get recipe details for a meal" })
  @ApiQuery({
    name: "mealName",
    required: true,
    description: "Name of the meal",
  })
  @ApiQuery({
    name: "targetCalories",
    required: false,
    description: "Target calories",
  })
  @ApiQuery({
    name: "language",
    required: false,
    description: "Language code",
    example: "en",
  })
  @ApiResponse({
    status: 200,
    description: "Recipe details retrieved successfully",
  })
  @ApiResponse({ status: 400, description: "Meal name is required" })
  async getRecipeDetails(
    @Param("userId") userId: string,
    @Query("mealName") mealName: string,
    @Query("language") language?: string
  ) {
    return this.mealService.getRecipeDetails(mealName, userId, language);
  }

  @Get("popular")
  @ApiOperation({ summary: "Get popular meals" })
  @ApiQuery({ name: "category", required: false, description: "Meal category" })
  @ApiQuery({ name: "path", required: false, description: "Diet path" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Number of results",
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: "Popular meals retrieved successfully",
  })
  async getPopularMeals(
    @Query("category") category?: string,
    @Query("path") path?: string,
    @Query("limit") limit?: string
  ) {
    return this.mealService.getPopularMeals(
      category,
      path,
      limit ? parseInt(limit) : 10
    );
  }

  @Get("details")
  @ApiOperation({ summary: "Get meal details by name" })
  @ApiQuery({
    name: "mealName",
    required: true,
    description: "Name of the meal",
  })
  @ApiQuery({ name: "language", required: false, description: "Language code" })
  @ApiResponse({
    status: 200,
    description: "Meal details retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "Meal not found" })
  async getMealDetailsByName(
    @Query("mealName") mealName: string,
    @Query("language") language?: string
  ) {
    return this.mealService.getMealDetailsByName(mealName, language);
  }
}
