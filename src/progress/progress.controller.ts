import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ProgressService } from "./progress.service";
import { AuthGuard } from "../auth/auth.guard";

@ApiTags("progress")
@Controller("progress")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class ProgressController {
  constructor(private progressService: ProgressService) {}

  @Get("today/:userId")
  async getTodayProgress(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.getTodayProgress(resolvedUserId);
  }

  @Delete("today/:userId")
  async resetTodayProgress(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.resetTodayProgress(resolvedUserId);
  }

  @Get("date/:userId/:date")
  async getProgressByDate(
    @Param("userId") userId: string,
    @Param("date") date: string,
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.getProgressByDate(resolvedUserId, date);
  }

  @Get("range/:userId")
  async getProgressByDateRange(
    @Param("userId") userId: string,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.getProgressByDateRange(
      resolvedUserId,
      startDate,
      endDate
    );
  }

  @Put("meal/:userId/:mealId")
  async markMealCompleted(
    @Param("userId") userId: string,
    @Param("mealId") mealId: string,
    @Request() req,
    @Body() body: { mealType: "breakfast" | "lunch" | "dinner" | "snacks" }
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.markMealCompleted(
      resolvedUserId,
      mealId,
      body.mealType
    );
  }

  @Post("custom-calories/:userId")
  async addCustomCalories(
    @Param("userId") userId: string,
    @Body() body: { calories: number; mealName: string },
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.addCustomCalories(
      resolvedUserId,
      body.calories,
      body.mealName
    );
  }

  @Post("water/:userId")
  async addWaterGlass(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.addWaterGlass(resolvedUserId);
  }

  @Put("water/:userId")
  async updateWaterIntake(
    @Param("userId") userId: string,
    @Body() body: { glasses: number },
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.updateWaterIntake(resolvedUserId, body.glasses);
  }

  @Put("workout-completed/:userId")
  async markWorkoutCompleted(
    @Param("userId") userId: string,
    @Body()
    body: {
      workout: {
        name: string;
        duration: number;
        caloriesBurned: number;
        category: string;
      };
      date: string;
    },
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    const { name, duration, caloriesBurned, category } = body.workout;
    return this.progressService.markWorkoutCompleted(
      resolvedUserId,
      name,
      duration,
      caloriesBurned,
      category
    );
  }

  @Get("weekly/:userId")
  async getWeeklySummary(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.getWeeklySummary(resolvedUserId);
  }

  @Get("analytics/:userId")
  async getAnalytics(
    @Param("userId") userId: string,
    @Query("period") period: "week" | "month" = "week",
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.progressService.getAnalytics(resolvedUserId, period);
  }
}
