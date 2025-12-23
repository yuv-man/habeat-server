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

  @Get("user/:userId")
  @ApiOperation({ summary: "Get goals by user ID" })
  @ApiParam({ name: "userId", description: "User ID or 'me' for current user" })
  @ApiResponse({
    status: 200,
    description: "Goals retrieved successfully",
  })
  async getGoalsByUserId(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.goalService.findByUserId(resolvedUserId);
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
  @ApiOperation({ summary: "Create a new goal" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        goal: { type: "string", example: "Lose 10kg" },
        description: {
          type: "string",
          example: "Lose weight through diet and exercise",
        },
        category: { type: "string", example: "weight_loss" },
        targetDate: { type: "string", format: "date", example: "2024-12-31" },
        startDate: { type: "string", format: "date", example: "2024-01-01" },
        target: { type: "number", example: 10 },
      },
      required: [
        "goal",
        "description",
        "category",
        "targetDate",
        "startDate",
        "target",
      ],
    },
  })
  @ApiResponse({
    status: 201,
    description: "Goal created successfully",
  })
  async createGoal(
    @Request() req,
    @Body()
    body: {
      goal: string;
      description: string;
      category: string;
      targetDate: Date;
      startDate: Date;
      target: number;
    }
  ) {
    return this.goalService.create(req.user._id.toString(), body);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update a goal" })
  @ApiParam({ name: "id", description: "Goal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        targetDate: { type: "string", format: "date" },
        startDate: { type: "string", format: "date" },
        target: { type: "number" },
        progress: { type: "number" },
        status: {
          type: "string",
          enum: ["active", "completed", "archived", "deleted"],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Goal updated successfully",
  })
  @ApiResponse({ status: 404, description: "Goal not found" })
  async updateGoal(
    @Param("id") id: string,
    @Body()
    body: {
      goal?: string;
      description?: string;
      category?: string;
      targetDate?: Date;
      startDate?: Date;
      target?: number;
      progress?: number;
      status?: string;
    }
  ) {
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
  @ApiOperation({ summary: "Generate a goal using AI" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        description: { type: "string", example: "I want to lose weight" },
        category: { type: "string", example: "weight_loss" },
        targetDate: { type: "string", format: "date", example: "2024-12-31" },
        startDate: { type: "string", format: "date", example: "2024-01-01" },
        language: { type: "string", example: "en", default: "en" },
      },
      required: ["description", "category", "targetDate", "startDate"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Goal generated successfully",
  })
  @ApiResponse({ status: 400, description: "Failed to generate goal" })
  async generateGoal(
    @Request() req,
    @Body()
    body: {
      description: string;
      category: string;
      targetDate: Date;
      startDate: Date;
      language?: string;
    }
  ) {
    return this.goalService.generateGoal(
      req.user._id.toString(),
      body.description,
      body.category,
      body.targetDate,
      body.startDate,
      body.language
    );
  }
}
