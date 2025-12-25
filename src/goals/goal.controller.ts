import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from "@nestjs/swagger";
import { GoalService } from "./goal.service";
import { AuthGuard } from "../auth/auth.guard";
import { CreateGoalDto, UpdateGoalDto, GenerateGoalDto } from "./dto";

@ApiTags("goals")
@Controller("goals")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class GoalController {
  constructor(private goalService: GoalService) {}

  @Get()
  @ApiOperation({ summary: "Get all goals for the authenticated user" })
  @ApiResponse({
    status: 200,
    description: "Goals retrieved successfully",
  })
  async getGoals(@Request() req) {
    return this.goalService.findAll(req.user._id.toString());
  }

  @Get(":id")
  @ApiOperation({ summary: "Get goal by ID" })
  @ApiParam({ name: "id", description: "Goal ID" })
  @ApiResponse({
    status: 200,
    description: "Goal retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "Goal not found" })
  async getGoalById(@Param("id") id: string) {
    return this.goalService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a new goal manually" })
  @ApiBody({ type: CreateGoalDto })
  @ApiResponse({
    status: 201,
    description: "Goal created successfully",
  })
  async createGoal(@Request() req, @Body() body: CreateGoalDto) {
    return this.goalService.create(req.user._id.toString(), body);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update a goal" })
  @ApiParam({ name: "id", description: "Goal ID" })
  @ApiBody({ type: UpdateGoalDto })
  @ApiResponse({
    status: 200,
    description: "Goal updated successfully",
  })
  @ApiResponse({ status: 404, description: "Goal not found" })
  async updateGoal(@Param("id") id: string, @Body() body: UpdateGoalDto) {
    return this.goalService.update(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a goal" })
  @ApiParam({ name: "id", description: "Goal ID" })
  @ApiResponse({
    status: 200,
    description: "Goal deleted successfully",
  })
  @ApiResponse({ status: 404, description: "Goal not found" })
  async deleteGoal(@Param("id") id: string) {
    return this.goalService.delete(id);
  }

  @Post("generate")
  @ApiOperation({
    summary: "Generate a goal using AI based on rules, workouts, and diet type",
  })
  @ApiBody({ type: GenerateGoalDto })
  @ApiResponse({
    status: 200,
    description: "Goal generated successfully",
  })
  @ApiResponse({ status: 400, description: "Failed to generate goal" })
  async generateGoal(@Request() req, @Body() body: GenerateGoalDto) {
    return this.goalService.generateGoal(req.user._id.toString(), body);
  }

  @Post(":id/progress")
  @ApiOperation({ summary: "Add a progress entry to a goal" })
  @ApiParam({ name: "id", description: "Goal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        value: { type: "number", example: 3.5 },
        date: {
          type: "string",
          format: "date",
          example: "2024-12-13",
        },
      },
      required: ["value"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Progress entry added successfully",
  })
  @ApiResponse({ status: 404, description: "Goal not found" })
  async addProgressEntry(
    @Param("id") id: string,
    @Body() body: { value: number; date?: string }
  ) {
    return this.goalService.addProgressEntry(id, body.value, body.date);
  }

  @Put(":id/milestones/:milestoneId")
  @ApiOperation({ summary: "Update a milestone completion status" })
  @ApiParam({ name: "id", description: "Goal ID" })
  @ApiParam({ name: "milestoneId", description: "Milestone ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        completed: { type: "boolean", example: true },
      },
      required: ["completed"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Milestone updated successfully",
  })
  @ApiResponse({ status: 404, description: "Goal or milestone not found" })
  async updateMilestone(
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
    @Body() body: { completed: boolean }
  ) {
    return this.goalService.updateMilestone(id, milestoneId, body.completed);
  }
}
