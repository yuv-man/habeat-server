import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { CBTService } from "./cbt.service";
import { AuthGuard } from "../auth/auth.guard";
import {
  LogMoodDto,
  LogThoughtDto,
  UpdateThoughtDto,
  CompleteExerciseDto,
  LinkMoodToMealDto,
  MoodHistoryQueryDto,
  PeriodQueryDto,
  LimitQueryDto,
  CategoryQueryDto,
} from "./cbt.dto";

@ApiTags("cbt")
@Controller("cbt")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class CBTController {
  constructor(private cbtService: CBTService) {}

  // ============== MOOD ENDPOINTS ==============

  @Get("moods/today")
  @ApiOperation({ summary: "Get today's mood entries" })
  @ApiResponse({ status: 200, description: "Today's moods retrieved successfully" })
  async getTodayMoods(@Request() req: any) {
    return this.cbtService.getTodayMoods(req.user._id.toString());
  }

  @Get("moods/history")
  @ApiOperation({ summary: "Get mood history" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (YYYY-MM-DD)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (YYYY-MM-DD)" })
  @ApiResponse({ status: 200, description: "Mood history retrieved successfully" })
  async getMoodHistory(
    @Request() req: any,
    @Query() query: MoodHistoryQueryDto
  ) {
    return this.cbtService.getMoodHistory(
      req.user._id.toString(),
      query.startDate,
      query.endDate
    );
  }

  @Post("moods")
  @ApiOperation({ summary: "Log a new mood entry" })
  @ApiResponse({ status: 201, description: "Mood logged successfully" })
  async logMood(@Request() req: any, @Body() dto: LogMoodDto) {
    return this.cbtService.logMood(req.user._id.toString(), dto);
  }

  @Get("moods/summary")
  @ApiOperation({ summary: "Get mood summary for a period" })
  @ApiQuery({ name: "period", required: false, enum: ["week", "month"], description: "Summary period" })
  @ApiResponse({ status: 200, description: "Mood summary retrieved successfully" })
  async getMoodSummary(
    @Request() req: any,
    @Query() query: PeriodQueryDto
  ) {
    return this.cbtService.getMoodSummary(
      req.user._id.toString(),
      query.period || "week"
    );
  }

  // ============== THOUGHT ENDPOINTS ==============

  @Get("thoughts")
  @ApiOperation({ summary: "Get thought journal entries" })
  @ApiQuery({ name: "limit", required: false, description: "Number of entries to return" })
  @ApiResponse({ status: 200, description: "Thoughts retrieved successfully" })
  async getThoughts(
    @Request() req: any,
    @Query() query: LimitQueryDto
  ) {
    return this.cbtService.getThoughts(
      req.user._id.toString(),
      query.limit || 20
    );
  }

  @Post("thoughts")
  @ApiOperation({ summary: "Log a new thought entry" })
  @ApiResponse({ status: 201, description: "Thought logged successfully" })
  async logThought(@Request() req: any, @Body() dto: LogThoughtDto) {
    return this.cbtService.logThought(req.user._id.toString(), dto);
  }

  @Put("thoughts/:id")
  @ApiOperation({ summary: "Update a thought entry" })
  @ApiParam({ name: "id", description: "Thought entry ID" })
  @ApiResponse({ status: 200, description: "Thought updated successfully" })
  @ApiResponse({ status: 404, description: "Thought entry not found" })
  async updateThought(
    @Request() req: any,
    @Param("id") thoughtId: string,
    @Body() dto: UpdateThoughtDto
  ) {
    return this.cbtService.updateThought(
      req.user._id.toString(),
      thoughtId,
      dto
    );
  }

  @Delete("thoughts/:id")
  @ApiOperation({ summary: "Delete a thought entry" })
  @ApiParam({ name: "id", description: "Thought entry ID" })
  @ApiResponse({ status: 200, description: "Thought deleted successfully" })
  @ApiResponse({ status: 404, description: "Thought entry not found" })
  async deleteThought(
    @Request() req: any,
    @Param("id") thoughtId: string
  ) {
    return this.cbtService.deleteThought(req.user._id.toString(), thoughtId);
  }

  // ============== EXERCISE ENDPOINTS ==============

  @Get("exercises")
  @ApiOperation({ summary: "Get available CBT exercises" })
  @ApiQuery({ name: "category", required: false, enum: ["mood", "eating", "stress", "general"] })
  @ApiResponse({ status: 200, description: "Exercises retrieved successfully" })
  getExercises(@Query() query: CategoryQueryDto) {
    return this.cbtService.getExercises(query.category);
  }

  @Get("exercises/recommended")
  @ApiOperation({ summary: "Get personalized exercise recommendations" })
  @ApiResponse({ status: 200, description: "Recommended exercises retrieved successfully" })
  async getRecommendedExercises(@Request() req: any) {
    return this.cbtService.getRecommendedExercises(req.user._id.toString());
  }

  @Post("exercises/complete")
  @ApiOperation({ summary: "Mark an exercise as completed" })
  @ApiResponse({ status: 201, description: "Exercise completion recorded successfully" })
  async completeExercise(
    @Request() req: any,
    @Body() dto: CompleteExerciseDto
  ) {
    return this.cbtService.completeExercise(req.user._id.toString(), dto);
  }

  @Get("exercises/history")
  @ApiOperation({ summary: "Get exercise completion history" })
  @ApiQuery({ name: "limit", required: false, description: "Number of entries to return" })
  @ApiResponse({ status: 200, description: "Exercise history retrieved successfully" })
  async getExerciseHistory(
    @Request() req: any,
    @Query() query: LimitQueryDto
  ) {
    return this.cbtService.getExerciseHistory(
      req.user._id.toString(),
      query.limit || 20
    );
  }

  // ============== MEAL-MOOD ENDPOINTS ==============

  @Post("meal-mood")
  @ApiOperation({ summary: "Link mood to a meal" })
  @ApiResponse({ status: 201, description: "Meal-mood correlation recorded successfully" })
  async linkMoodToMeal(
    @Request() req: any,
    @Body() dto: LinkMoodToMealDto
  ) {
    return this.cbtService.linkMoodToMeal(req.user._id.toString(), dto);
  }

  @Get("meal-mood/history")
  @ApiOperation({ summary: "Get meal-mood correlation history" })
  @ApiQuery({ name: "limit", required: false, description: "Number of entries to return" })
  @ApiResponse({ status: 200, description: "Meal-mood history retrieved successfully" })
  async getMealMoodHistory(
    @Request() req: any,
    @Query() query: LimitQueryDto
  ) {
    return this.cbtService.getMealMoodHistory(
      req.user._id.toString(),
      query.limit || 20
    );
  }

  @Get("meal-mood/insights")
  @ApiOperation({ summary: "Get emotional eating insights" })
  @ApiQuery({ name: "period", required: false, enum: ["week", "month"] })
  @ApiResponse({ status: 200, description: "Insights retrieved successfully" })
  async getEmotionalEatingInsights(
    @Request() req: any,
    @Query() query: PeriodQueryDto
  ) {
    return this.cbtService.getEmotionalEatingInsights(
      req.user._id.toString(),
      query.period || "week"
    );
  }

  // ============== STATS ENDPOINT ==============

  @Get("stats")
  @ApiOperation({ summary: "Get CBT engagement statistics" })
  @ApiResponse({ status: 200, description: "CBT stats retrieved successfully" })
  async getCBTStats(@Request() req: any) {
    return this.cbtService.getCBTStats(req.user._id.toString());
  }
}
