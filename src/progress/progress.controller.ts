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
import { ProgressService, MissReason, MISS_REASONS } from "./progress.service";
import { AuthGuard } from "../auth/auth.guard";
import { MealSource } from "../types/interfaces";
import { resolveOwnUserId } from "../utils/ownership";
import { AnalyticsService } from "../analytics/analytics.service";

@ApiTags("progress")
@Controller("progress")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class ProgressController {
  constructor(
    private progressService: ProgressService,
    private analyticsService: AnalyticsService
  ) {}

  @Get("today/:userId")
  async getTodayProgress(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.getTodayProgress(resolvedUserId);
  }

  @Delete("today/:userId")
  async resetTodayProgress(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.resetTodayProgress(resolvedUserId);
  }

  @Get("date/:userId/:date")
  async getProgressByDate(
    @Param("userId") userId: string,
    @Param("date") date: string,
    @Request() req
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.getProgressByDate(resolvedUserId, date);
  }

  @Get("range/:userId")
  async getProgressByDateRange(
    @Param("userId") userId: string,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
    @Request() req
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
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
    @Body()
    body: {
      mealType: "breakfast" | "lunch" | "dinner" | "snacks";
      /** Where the food came from, when the user said. Optional: the tick
       *  must never be blocked on answering it. */
      source?: MealSource;
    }
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    const result = await this.progressService.markMealCompleted(
      resolvedUserId,
      mealId,
      body.mealType,
      body.source
    );
    this.analyticsService.capture(resolvedUserId, "meal_completed", {
      mealType: body.mealType,
      source: body.source,
    });
    return result;
  }

  /** "I skipped this meal" — or undo it. */
  @Put("meal-skip/:userId/:mealId")
  async setMealSkipped(
    @Param("userId") userId: string,
    @Param("mealId") mealId: string,
    @Request() req,
    @Body()
    body: {
      mealType: "breakfast" | "lunch" | "dinner" | "snacks";
      skipped: boolean;
      reason?: MissReason;
    }
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    // Unknown reasons are dropped rather than rejected: the skip itself is the
    // fact that matters, and it must not fail over a label.
    const reason = MISS_REASONS.includes(body.reason as MissReason)
      ? body.reason
      : undefined;
    const result = await this.progressService.setMealSkipped(
      resolvedUserId,
      mealId,
      body.mealType,
      body.skipped !== false,
      reason
    );
    this.analyticsService.capture(resolvedUserId, "meal_skipped", {
      mealType: body.mealType,
      skipped: body.skipped !== false,
      reason,
    });
    return result;
  }

  /** Correct when a completed meal was actually eaten ("we planned 08:00, I ate
   *  at 11:00"). Times, not ticks, are what the eating-pattern work reads. */
  @Put("meal-time/:userId/:mealId")
  async updateMealEatenTime(
    @Param("userId") userId: string,
    @Param("mealId") mealId: string,
    @Request() req,
    @Body()
    body: {
      mealType: "breakfast" | "lunch" | "dinner" | "snacks";
      time: string;
      date?: string;
    },
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    const result = await this.progressService.updateMealEatenTime(
      resolvedUserId,
      mealId,
      body.mealType,
      body.time,
      body.date,
    );
    this.analyticsService.capture(resolvedUserId, "meal_time_corrected", {
      mealType: body.mealType,
    });
    return result;
  }

  @Post("custom-calories/:userId")
  async addCustomCalories(
    @Param("userId") userId: string,
    @Body() body: { calories: number; mealName: string },
    @Request() req
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.addCustomCalories(
      resolvedUserId,
      body.calories,
      body.mealName
    );
  }

  @Post("water/:userId")
  async addWaterGlass(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.addWaterGlass(resolvedUserId);
  }

  @Put("water/:userId")
  async updateWaterIntake(
    @Param("userId") userId: string,
    @Body() body: { glasses: number },
    @Request() req
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
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
    const resolvedUserId = resolveOwnUserId(req, userId);
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
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.getWeeklySummary(resolvedUserId);
  }

  @Get("analytics/:userId")
  async getAnalytics(
    @Param("userId") userId: string,
    @Query("period") period: "week" | "month" = "week",
    @Request() req
  ) {
    const resolvedUserId = resolveOwnUserId(req, userId);
    return this.progressService.getAnalytics(resolvedUserId, period);
  }
}
