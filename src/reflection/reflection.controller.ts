import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ReflectionService } from "./reflection.service";
import logger from "../utils/logger";

@Controller("reflection")
export class ReflectionController {
  constructor(private readonly reflectionService: ReflectionService) {}

  /**
   * Get daily summary for the current user
   * @param date - Optional date (defaults to today)
   */
  @Get("daily")
  @UseGuards(AuthGuard("jwt"))
  async getDailySummary(@Request() req: any, @Query("date") date?: string) {
    try {
      const userId = req.user._id.toString();
      const summary = await this.reflectionService.getDailySummary(userId, date);

      return {
        success: true,
        data: summary,
      };
    } catch (error: any) {
      logger.error(
        `[ReflectionController] Error getting daily summary: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get daily summary",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get weekly story/reflection for the current user
   */
  @Get("weekly")
  @UseGuards(AuthGuard("jwt"))
  async getWeeklyStory(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const story = await this.reflectionService.getWeeklyStory(userId);

      return {
        success: true,
        data: story,
      };
    } catch (error: any) {
      logger.error(
        `[ReflectionController] Error getting weekly story: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get weekly story",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
