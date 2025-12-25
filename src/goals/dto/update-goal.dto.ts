import { ApiProperty } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { MilestoneDto, ProgressHistoryDto } from "./create-goal.dto";

export class UpdateGoalDto {
  @ApiProperty({
    example: "Run 5K",
    description: "Goal title",
    required: false,
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    example: "Improve cardiovascular endurance and complete a 5K.",
    description: "Goal description",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 3.5,
    description: "Current progress value",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  current?: number;

  @ApiProperty({ example: 5, description: "Target value", required: false })
  @IsOptional()
  @IsNumber()
  target?: number;

  @ApiProperty({
    example: "km",
    description: "Unit of measurement",
    required: false,
  })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ example: "run", description: "Icon name", required: false })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({
    example: "achieved",
    enum: ["active", "achieved", "in_progress", "paused"],
    description: "Goal status",
    required: false,
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({
    example: "2024-11-01",
    description: "Start date",
    required: false,
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({
    type: [MilestoneDto],
    description: "Goal milestones",
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneDto)
  milestones?: MilestoneDto[];

  @ApiProperty({
    type: [ProgressHistoryDto],
    description: "Progress history",
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgressHistoryDto)
  progressHistory?: ProgressHistoryDto[];
}
