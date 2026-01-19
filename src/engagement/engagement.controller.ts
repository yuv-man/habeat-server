import {
  Controller,
  Get,
  Post,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { EngagementService, XP_REWARDS, BADGE_DEFINITIONS } from "./engagement.service";
import logger from "../utils/logger";

@Controller("engagement")
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  /**
   * Get current user's engagement stats
   */
  @Get("stats")
  @UseGuards(AuthGuard("jwt"))
  async getStats(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const stats = await this.engagementService.getEngagementStats(userId);

      return {
        success: true,
        data: stats,
      };
    } catch (error: any) {
      logger.error(`[EngagementController] Error getting stats: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to get engagement stats",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get streak information
   */
  @Get("streak")
  @UseGuards(AuthGuard("jwt"))
  async getStreak(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const streak = await this.engagementService.calculateStreak(userId);

      return {
        success: true,
        data: streak,
      };
    } catch (error: any) {
      logger.error(`[EngagementController] Error getting streak: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to get streak",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Use streak freeze
   */
  @Post("streak-freeze")
  @UseGuards(AuthGuard("jwt"))
  async useStreakFreeze(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const result = await this.engagementService.useStreakFreeze(userId);

      return {
        success: result.success,
        message: result.message,
      };
    } catch (error: any) {
      logger.error(`[EngagementController] Error using streak freeze: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to use streak freeze",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get XP rewards configuration (for frontend display)
   */
  @Get("rewards")
  async getRewards() {
    return {
      success: true,
      data: {
        xpRewards: XP_REWARDS,
        levelFormula: "level = floor(sqrt(xp / 100)) + 1",
        badges: Object.entries(BADGE_DEFINITIONS).map(([id, badge]) => ({
          id,
          ...badge,
        })),
      },
    };
  }

  /**
   * Get level information for a given XP
   */
  @Get("level-info")
  @UseGuards(AuthGuard("jwt"))
  async getLevelInfo(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const stats = await this.engagementService.getEngagementStats(userId);

      return {
        success: true,
        data: {
          currentLevel: stats.level,
          currentXp: stats.xp,
          xpProgress: stats.xpProgress,
          xpToNextLevel: stats.xpProgress.required - stats.xpProgress.current,
          progressPercentage: Math.round(
            (stats.xpProgress.current / stats.xpProgress.required) * 100
          ),
        },
      };
    } catch (error: any) {
      logger.error(`[EngagementController] Error getting level info: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to get level info",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
