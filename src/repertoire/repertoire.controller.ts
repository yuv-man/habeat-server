import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

import { AuthGuard } from "../auth/auth.guard";
import { RepertoireService, UserSettableStatus } from "./repertoire.service";
import { RepertoireSlot } from "./repertoire.capture";
import { dishIconFor, dishImageFor } from "./dish-images";

export class AddDishDto {
  @ApiProperty({ example: "Chicken soup", description: "The dish as the user calls it" })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ enum: ["breakfast", "lunch", "dinner", "snack"], isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(["breakfast", "lunch", "dinner", "snack"], { each: true })
  slots?: RepertoireSlot[];

  @ApiPropertyOptional({ example: 4, description: "Times a month they eat it" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  usualPerMonth?: number;
}

export class AddDishesDto {
  @ApiProperty({ type: [AddDishDto], description: "The onboarding screen, in one call" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AddDishDto)
  dishes!: AddDishDto[];
}

export class SetDishStatusDto {
  @ApiProperty({ enum: ["active", "paused", "retired"] })
  @IsIn(["active", "paused", "retired"])
  status!: UserSettableStatus;
}

export class TuneLevelDto {
  @ApiProperty({ enum: [0, 1, 2, 3], description: "0 = as the user makes it now" })
  @Type(() => Number)
  @IsIn([0, 1, 2, 3])
  level!: 0 | 1 | 2 | 3;
}

export class RejectTuneDto {
  @ApiProperty({ enum: [1, 2, 3] })
  @Type(() => Number)
  @IsIn([1, 2, 3])
  level!: 1 | 2 | 3;
}

@ApiTags("repertoire")
@Controller("repertoire")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class RepertoireController {
  constructor(private readonly repertoire: RepertoireService) {}

  @Get()
  @ApiOperation({ summary: "The dishes this user cooks — active and paused" })
  @ApiResponse({ status: 200, description: "Dishes returned" })
  async list(@Request() req: any) {
    const dishes = await this.repertoire.list(req.user._id.toString());
    // Art is stamped when a dish is created; filled in here as well so dishes
    // stored before it existed still look like something on the screen.
    return {
      success: true,
      data: {
        dishes: dishes.map((dish) => ({
          ...dish,
          icon: dish.icon ?? dishIconFor(dish.name),
          ...(dish.imageUrl ? {} : { imageUrl: dishImageFor(dish.name) }),
        })),
      },
    };
  }

  @Get("candidates")
  @ApiOperation({
    summary: "Dishes cooked at home often enough to propose adding to the repertoire",
  })
  @ApiResponse({ status: 200, description: "Candidates returned" })
  async candidates(@Request() req: any) {
    const candidates = await this.repertoire.candidates(req.user._id.toString());
    return { success: true, data: { candidates } };
  }

  @Post("candidates/:key/accept")
  @ApiOperation({ summary: "Add a proposed dish to the repertoire" })
  @ApiResponse({ status: 201, description: "Dish added" })
  @ApiResponse({ status: 404, description: "Dish is not being proposed" })
  async accept(@Request() req: any, @Param("key") key: string) {
    const dish = await this.repertoire.accept(req.user._id.toString(), key);
    return { success: true, data: { dish } };
  }

  @Post("candidates/:key/decline")
  @ApiOperation({ summary: "Decline a proposed dish; it will not be proposed again" })
  @ApiResponse({ status: 201, description: "Declined" })
  @ApiResponse({ status: 404, description: "Dish is not being proposed" })
  async decline(@Request() req: any, @Param("key") key: string) {
    await this.repertoire.decline(req.user._id.toString(), key);
    return { success: true };
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "Pause, retire or reactivate a dish" })
  @ApiResponse({ status: 200, description: "Status updated" })
  @ApiResponse({ status: 404, description: "Dish not found" })
  async setStatus(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: SetDishStatusDto,
  ) {
    const dish = await this.repertoire.setStatus(req.user._id.toString(), id, body.status);
    return { success: true, data: { dish } };
  }

  @Post(":id/tune")
  @ApiOperation({
    summary: "Generate tuned versions of a dish (cached; regenerated when the diet path changes)",
  })
  @ApiQuery({ name: "force", required: false, description: "Regenerate even if cached" })
  @ApiResponse({ status: 201, description: "Tunes returned" })
  @ApiResponse({ status: 503, description: "Tuning model unavailable" })
  async tune(@Request() req: any, @Param("id") id: string, @Query("force") force?: string) {
    const result = await this.repertoire.tune(req.user._id.toString(), id, force === "true");
    return { success: true, data: result };
  }

  @Post(":id/tunes/accept")
  @ApiOperation({ summary: "Use this tune level for the dish (0 = as usual)" })
  @ApiResponse({ status: 201, description: "Level set" })
  @ApiResponse({ status: 400, description: "No tune at that level" })
  async acceptTune(@Request() req: any, @Param("id") id: string, @Body() body: TuneLevelDto) {
    const dish = await this.repertoire.acceptTune(req.user._id.toString(), id, body.level);
    return { success: true, data: { dish } };
  }

  @Post(":id/tunes/reject")
  @ApiOperation({
    summary: "Reject a tune level; the dish drops below it, and is pinned there after two rejections",
  })
  @ApiResponse({ status: 201, description: "Rejected" })
  @ApiResponse({ status: 400, description: "No tune at that level" })
  async rejectTune(@Request() req: any, @Param("id") id: string, @Body() body: RejectTuneDto) {
    const dish = await this.repertoire.rejectTune(req.user._id.toString(), id, body.level);
    return { success: true, data: { dish } };
  }

  @Post()
  @ApiOperation({ summary: "Add a dish the user cooks" })
  @ApiResponse({ status: 201, description: "Dish added, already known, or rejected" })
  async addDish(@Request() req: any, @Body() body: AddDishDto) {
    const result = await this.repertoire.addDish(req.user._id.toString(), body, "manual");
    return { success: result.status !== "rejected", data: result };
  }

  @Post("bulk")
  @ApiOperation({
    summary: "Add several dishes at once — the onboarding 'what do you cook?' step",
  })
  @ApiResponse({ status: 201, description: "Per-dish results, in the order sent" })
  async addDishes(@Request() req: any, @Body() body: AddDishesDto) {
    const results = await this.repertoire.addDishes(req.user._id.toString(), body.dishes, "onboarding");
    return {
      success: true,
      data: {
        results,
        added: results.filter((r) => r.status === "added").length,
        plannable: results.filter((r) => r.dish?.status === "active").length,
      },
    };
  }
}
