import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  UseGuards,
  Request,
  Param,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { PlanService } from "./plan.service";
import { AuthGuard } from "../auth/auth.guard";
import {
  UpdateMealDto,
  ReplaceMealDto,
  UpdateWorkoutDto,
  UpdateMacrosDto,
  AddSnackDto,
  AddWorkoutDto,
  DeleteSnackDto,
  DeleteWorkoutDto,
} from "./dto";
import {
  WeeklyPlanResponse,
  UpdateMealResponse,
  UpdateWorkoutResponse,
  UpdateMacrosResponse,
  AddSnackResponse,
  AddWorkoutResponse,
  DeleteSnackResponse,
  DeleteWorkoutResponse,
} from "./subjects";
import { IMeal } from "src/types/interfaces";

@ApiTags("plan")
@Controller("plan")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class PlanController {
  constructor(private planService: PlanService) {}

  @Get("current-week")
  @ApiOperation({
    summary:
      "Get current weekly plan (starts from last Monday). Generates plan if it doesn't exist.",
  })
  @ApiResponse({
    status: 200,
    description: "Current weekly plan retrieved successfully",
    type: WeeklyPlanResponse,
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async getCurrentWeeklyPlan(@Request() req) {
    return this.planService.getCurrentWeeklyPlan(req.user._id.toString());
  }

  @Put("meal")
  @ApiOperation({ summary: "Update a meal in the plan" })
  @ApiResponse({
    status: 200,
    description: "Meal updated successfully",
    type: UpdateMealResponse,
  })
  @ApiResponse({ status: 404, description: "Plan or day not found" })
  @ApiResponse({ status: 400, description: "Invalid meal data" })
  async updateMeal(@Request() req, @Body() body: UpdateMealDto) {
    return this.planService.updateMealInPlan(
      req.user._id.toString(),
      body.day,
      body.mealType,
      body.mealData as any,
      body.snackIndex
    );
  }

  @Put(":userId/meal-replace/:planId")
  @ApiOperation({
    summary:
      "Replace a meal in the plan - either generate with AI or choose from favorites",
  })
  @ApiResponse({
    status: 200,
    description: "Meal replaced successfully",
  })
  @ApiResponse({ status: 404, description: "Plan, day, or meal not found" })
  @ApiResponse({ status: 400, description: "Invalid meal replacement data" })
  async replaceMeal(
    @Param("userId") userId: string,
    @Param("planId") planId: string,
    @Body() body: ReplaceMealDto
  ) {
    return this.planService.replaceMeal(
      userId,
      planId,
      body.date,
      body.mealType,
      body.newMeal as IMeal,
      body.snackIndex
    );
  }

  @Put(":userId/workout")
  @ApiOperation({ summary: "Update a workout in the plan" })
  @ApiResponse({
    status: 200,
    description: "Workout updated successfully",
    type: UpdateWorkoutResponse,
  })
  @ApiResponse({ status: 404, description: "Plan, day, or workout not found" })
  @ApiResponse({ status: 400, description: "Invalid workout data" })
  async updateWorkout(
    @Param("userId") userId: string,
    @Body() body: UpdateWorkoutDto,
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.planService.updateWorkoutInPlan(
      resolvedUserId.toString(),
      body.date,
      body.workoutIndex,
      {
        name: body.name,
        category: body.category,
        duration: body.duration,
        caloriesBurned: body.caloriesBurned,
        time: body.time,
      }
    );
  }

  @Put("macros")
  @ApiOperation({
    summary: "Update macros for a day (updates weekly consumed totals)",
  })
  @ApiResponse({
    status: 200,
    description: "Macros updated successfully",
    type: UpdateMacrosResponse,
  })
  @ApiResponse({ status: 404, description: "Plan or day not found" })
  @ApiResponse({ status: 400, description: "Invalid macros data" })
  async updateMacros(@Request() req, @Body() body: UpdateMacrosDto) {
    return this.planService.updateMacrosInPlan(
      req.user._id.toString(),
      body.day,
      {
        calories: body.calories,
        protein: body.protein,
        carbs: body.carbs,
        fat: body.fat,
      }
    );
  }

  @Post(":planId/add-snack")
  @ApiOperation({ summary: "Add a snack to a specific day in the plan" })
  @ApiResponse({
    status: 201,
    description: "Snack added successfully",
    type: AddSnackResponse,
  })
  @ApiResponse({ status: 404, description: "Plan or day not found" })
  @ApiResponse({ status: 400, description: "Invalid snack data" })
  async addSnack(@Param("planId") planId: string, @Body() body: AddSnackDto) {
    return this.planService.addSnack(planId, body.date, body.name);
  }

  @Post(":userId/workout")
  @ApiOperation({ summary: "Add a workout to a specific day in the plan" })
  @ApiResponse({
    status: 201,
    description: "Workout added successfully",
    type: AddWorkoutResponse,
  })
  @ApiResponse({ status: 404, description: "Plan or day not found" })
  @ApiResponse({ status: 400, description: "Invalid workout data" })
  async addWorkout(
    @Param("userId") userId: string,
    @Body() body: AddWorkoutDto,
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.planService.addWorkout(
      resolvedUserId.toString(),
      body.date,
      body.name,
      body.category,
      body.duration,
      body.caloriesBurned,
      body.time
    );
  }

  @Delete(":planId/snack/:date/:snackId")
  @ApiOperation({ summary: "Delete a snack from a specific day in the plan" })
  @ApiResponse({
    status: 200,
    description: "Snack deleted successfully",
    type: DeleteSnackResponse,
  })
  @ApiResponse({ status: 404, description: "Plan, day, or snack not found" })
  @ApiResponse({ status: 400, description: "Invalid snack index" })
  async deleteSnack(
    @Param("planId") planId: string,
    @Param("date") date: string,
    @Param("snackId") snackId: string
  ) {
    return this.planService.deleteSnack(planId, date, snackId);
  }

  @Delete(":userId/workout/:date/:workoutName")
  @ApiOperation({ summary: "Delete a workout from a specific day in the plan" })
  @ApiResponse({
    status: 200,
    description: "Workout deleted successfully",
    type: DeleteWorkoutResponse,
  })
  @ApiResponse({ status: 404, description: "Plan, date, or workout not found" })
  @ApiResponse({ status: 400, description: "Invalid workout index" })
  async deleteWorkout(
    @Param("userId") userId: string,
    @Param("date") date: string,
    @Param("workoutName") workoutName: string,
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.planService.deleteWorkout(
      resolvedUserId.toString(),
      date,
      workoutName
    );
  }
}
