import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ChallengeService } from "./challenge.service";
import logger from "../utils/logger";

@Controller("challenges")
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  /**
   * Get active challenges for the current user
   * Also assigns new challenges if user has fewer than 3
   */
  @Get()
  @UseGuards(AuthGuard("jwt"))
  async getActiveChallenges(@Request() req: any) {
    try {
      const userId = req.user._id.toString();

      // Assign challenges if needed, then return active ones
      const challenges = await this.challengeService.assignChallenges(userId);

      return {
        success: true,
        data: {
          challenges,
          count: challenges.length,
        },
      };
    } catch (error: any) {
      logger.error(
        `[ChallengeController] Error getting challenges: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get challenges",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get all challenges including completed/expired (history)
   */
  @Get("history")
  @UseGuards(AuthGuard("jwt"))
  async getChallengeHistory(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const challenges = await this.challengeService.getAllChallenges(userId);

      return {
        success: true,
        data: {
          challenges,
          count: challenges.length,
        },
      };
    } catch (error: any) {
      logger.error(
        `[ChallengeController] Error getting challenge history: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get challenge history",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get challenges that are completed but not yet claimed
   */
  @Get("claimable")
  @UseGuards(AuthGuard("jwt"))
  async getClaimableChallenges(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const challenges = await this.challengeService.getClaimableChallenges(userId);

      return {
        success: true,
        data: {
          challenges,
          count: challenges.length,
        },
      };
    } catch (error: any) {
      logger.error(
        `[ChallengeController] Error getting claimable challenges: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get claimable challenges",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Claim reward for a completed challenge
   */
  @Post(":id/claim")
  @UseGuards(AuthGuard("jwt"))
  async claimReward(@Request() req: any, @Param("id") challengeId: string) {
    try {
      const userId = req.user._id.toString();
      const result = await this.challengeService.claimReward(userId, challengeId);

      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      logger.error(
        `[ChallengeController] Error claiming reward: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to claim reward",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Force refresh challenges (expire old ones and assign new)
   */
  @Post("refresh")
  @UseGuards(AuthGuard("jwt"))
  async refreshChallenges(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const challenges = await this.challengeService.assignChallenges(userId);

      return {
        success: true,
        data: {
          challenges,
          count: challenges.length,
        },
      };
    } catch (error: any) {
      logger.error(
        `[ChallengeController] Error refreshing challenges: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to refresh challenges",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
