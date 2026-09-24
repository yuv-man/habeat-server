import { Controller, Get, Post, Query, Request, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { BrainService, BRAIN_WINDOW_DAYS } from "./brain.service";
import { PATTERN_DEFINITIONS } from "./patterns/pattern.definitions";
import { INTERVENTIONS } from "./behavior/intervention.definitions";
import { AuthGuard } from "../auth/auth.guard";

@ApiTags("brain")
@Controller("brain")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class BrainController {
  constructor(private readonly brainService: BrainService) {}

  @Get("state")
  @ApiOperation({
    summary: "The current Brain state — active behaviour, stage and patterns",
  })
  @ApiResponse({ status: 200, description: "State returned" })
  async getState(@Request() req: any) {
    const userId = req.user._id.toString();
    const [state, patterns, focus, progress] = await Promise.all([
      this.brainService.getState(userId),
      this.brainService.getPatterns(userId),
      // The composed, user-facing view. `state` and `patterns` are the raw
      // records behind it; a screen should render `focus` and leave the rest
      // to debugging.
      this.brainService.getUserFacingState(userId),
      // How every confirmed pattern is moving, with things to try.
      this.brainService.getPatternProgress(userId),
    ]);
    return { success: true, data: { focus, state, patterns, progress } };
  }

  @Post("analyze")
  @ApiOperation({
    summary: "Run an analysis now, rather than waiting for the nightly pass",
  })
  @ApiQuery({ name: "days", required: false, description: "Window size, default 30" })
  @ApiResponse({ status: 200, description: "Analysis complete" })
  async analyze(@Request() req: any, @Query("days") days?: string) {
    const parsed = days ? parseInt(days, 10) : BRAIN_WINDOW_DAYS;
    const windowDays = Number.isFinite(parsed)
      ? Math.max(7, Math.min(90, parsed))
      : BRAIN_WINDOW_DAYS;

    const state = await this.brainService.analyzeUser(
      req.user._id.toString(),
      windowDays,
    );
    return { success: true, data: { state } };
  }

  @Get("planner-context")
  @ApiOperation({
    summary: "The brief the meal generator receives — useful for debugging a plan",
  })
  @ApiResponse({ status: 200, description: "Context returned" })
  async plannerContext(@Request() req: any) {
    const context = await this.brainService.buildPlannerContext(
      req.user._id.toString(),
    );
    return { success: true, data: { context } };
  }

  @Get("catalogue")
  @ApiOperation({
    summary: "The pattern and intervention catalogue this deployment knows",
  })
  @ApiResponse({ status: 200, description: "Catalogue returned" })
  async catalogue() {
    return {
      success: true,
      data: { patterns: PATTERN_DEFINITIONS, interventions: INTERVENTIONS },
    };
  }
}
