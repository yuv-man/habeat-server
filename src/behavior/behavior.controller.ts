import { Controller, Get, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { BehaviorService, ANALYSIS_WINDOW_DAYS } from "./behavior.service";
import { AuthGuard } from "../auth/auth.guard";

@ApiTags("behavior")
@Controller("behavior")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class BehaviorController {
  constructor(private behaviorService: BehaviorService) {}

  @Get("summary")
  @ApiOperation({
    summary:
      "Aggregated behavioural summary — the exact input the analyst reasons over",
  })
  @ApiQuery({ name: "days", required: false, description: "Window size, default 30" })
  @ApiResponse({ status: 200, description: "Summary computed" })
  async getSummary(@Request() req: any, @Query("days") days?: string) {
    const parsed = days ? parseInt(days, 10) : ANALYSIS_WINDOW_DAYS;
    const periodDays = Number.isFinite(parsed)
      ? Math.max(7, Math.min(90, parsed))
      : ANALYSIS_WINDOW_DAYS;

    const summary = await this.behaviorService.buildSummary(
      req.user._id.toString(),
      periodDays,
    );
    return { success: true, data: { summary } };
  }

  @Get("profile")
  @ApiOperation({
    summary:
      "The living behavioural profile, with its pattern and suggestion rows resolved",
  })
  @ApiResponse({ status: 200, description: "Profile returned" })
  async getProfile(@Request() req: any) {
    const { profile, patterns, suggestions } =
      await this.behaviorService.getProfileWithBank(req.user._id.toString());
    return { success: true, data: { profile, patterns, suggestions } };
  }

  @Get("profile/verify")
  @ApiOperation({
    summary:
      "Re-run the checks behind the stored profile and report how its claims held up",
  })
  @ApiResponse({ status: 200, description: "Verification returned; null when nothing was claimed" })
  async verifyProfile(@Request() req: any) {
    const selfCheck = await this.behaviorService.verifyProfile(
      req.user._id.toString(),
    );
    return { success: true, data: { selfCheck } };
  }

  @Post("profile/refresh")
  @ApiOperation({
    summary:
      "Force a full re-analysis now. Routine refreshes happen on a schedule — this is the manual override, and it does call the model.",
  })
  @ApiResponse({ status: 201, description: "Profile rebuilt" })
  async refreshProfile(@Request() req: any) {
    const { profile, patterns, suggestions } = await this.behaviorService.sync(
      req.user._id.toString(),
    );
    return { success: true, data: { profile, patterns, suggestions } };
  }

  @Get("planner-context")
  @ApiOperation({
    summary: "The behavioural context the weekly planner receives, as sent",
  })
  @ApiResponse({ status: 200, description: "Context returned; null when too thin" })
  async getPlannerContext(@Request() req: any) {
    const context = await this.behaviorService.buildPlannerContext(
      req.user._id.toString(),
    );
    return { success: true, data: { context } };
  }
}
