import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { NotificationService } from "./notification.service";
import { INotificationPreferences } from "../types/interfaces";
import logger from "../utils/logger";

@Controller("notifications")
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Get user's notification preferences
   */
  @Get("preferences")
  @UseGuards(AuthGuard("jwt"))
  async getPreferences(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const preferences = await this.notificationService.getPreferences(userId);

      return {
        success: true,
        data: preferences,
      };
    } catch (error: any) {
      logger.error(
        `[NotificationController] Error getting preferences: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get notification preferences",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Update user's notification preferences
   */
  @Put("preferences")
  @UseGuards(AuthGuard("jwt"))
  async updatePreferences(
    @Request() req: any,
    @Body() preferences: Partial<INotificationPreferences>
  ) {
    try {
      const userId = req.user._id.toString();
      const updated = await this.notificationService.updatePreferences(
        userId,
        preferences
      );

      return {
        success: true,
        data: updated,
      };
    } catch (error: any) {
      logger.error(
        `[NotificationController] Error updating preferences: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to update notification preferences",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Register device token for push notifications
   */
  @Post("device-token")
  @UseGuards(AuthGuard("jwt"))
  async registerDeviceToken(
    @Request() req: any,
    @Body() body: { token: string }
  ) {
    try {
      const userId = req.user._id.toString();
      await this.notificationService.registerDeviceToken(userId, body.token);

      return {
        success: true,
        message: "Device token registered successfully",
      };
    } catch (error: any) {
      logger.error(
        `[NotificationController] Error registering device token: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to register device token",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Remove device token
   */
  @Delete("device-token")
  @UseGuards(AuthGuard("jwt"))
  async removeDeviceToken(@Request() req: any, @Body() body: { token: string }) {
    try {
      const userId = req.user._id.toString();
      await this.notificationService.removeDeviceToken(userId, body.token);

      return {
        success: true,
        message: "Device token removed successfully",
      };
    } catch (error: any) {
      logger.error(
        `[NotificationController] Error removing device token: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to remove device token",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get scheduled notifications for client to display
   * Client uses this to set up local notifications
   */
  @Get("scheduled")
  @UseGuards(AuthGuard("jwt"))
  async getScheduledNotifications(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const notifications =
        await this.notificationService.getScheduledNotifications(userId);

      return {
        success: true,
        data: notifications,
      };
    } catch (error: any) {
      logger.error(
        `[NotificationController] Error getting scheduled notifications: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to get scheduled notifications",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Check if user needs a streak warning notification
   */
  @Get("streak-warning")
  @UseGuards(AuthGuard("jwt"))
  async checkStreakWarning(@Request() req: any) {
    try {
      const userId = req.user._id.toString();
      const notification =
        await this.notificationService.checkStreakWarning(userId);

      return {
        success: true,
        data: notification,
      };
    } catch (error: any) {
      logger.error(
        `[NotificationController] Error checking streak warning: ${error.message}`
      );
      throw new HttpException(
        error.message || "Failed to check streak warning",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get default notification preferences
   */
  @Get("defaults")
  async getDefaultPreferences() {
    return {
      success: true,
      data: this.notificationService.getDefaultPreferences(),
    };
  }
}
