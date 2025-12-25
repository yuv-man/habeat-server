import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsDate,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class MilestoneDto {
  @ApiProperty({ example: "m1", description: "Milestone ID" })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    example: "Run 1K without stopping",
    description: "Milestone title",
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ example: 1, description: "Target value for this milestone" })
  @IsNotEmpty()
  @IsNumber()
  targetValue: number;

  @ApiProperty({
    example: false,
    description: "Whether milestone is completed",
    required: false,
  })
  @IsOptional()
  completed?: boolean;

  @ApiProperty({
    example: "2024-11-10",
    description: "Completion date",
    required: false,
  })
  @IsOptional()
  @IsString()
  completedDate?: string;
}

export class ProgressHistoryDto {
  @ApiProperty({ example: "2024-11-01", description: "Date of progress entry" })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({ example: 0.5, description: "Progress value on this date" })
  @IsNotEmpty()
  @IsNumber()
  value: number;
}

export class CreateGoalDto {
  @ApiProperty({ example: "Run 5K", description: "Goal title" })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({
    example: "Improve cardiovascular endurance and complete a 5K.",
    description: "Goal description",
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ example: 0, description: "Current progress value" })
  @IsOptional()
  @IsNumber()
  current?: number;

  @ApiProperty({ example: 5, description: "Target value" })
  @IsNotEmpty()
  @IsNumber()
  target: number;

  @ApiProperty({ example: "km", description: "Unit of measurement" })
  @IsNotEmpty()
  @IsString()
  unit: string;

  @ApiProperty({ example: "run", description: "Icon name" })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({
    example: "active",
    enum: ["active", "achieved", "in_progress", "paused"],
    description: "Goal status",
    required: false,
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ example: "2024-11-01", description: "Start date" })
  @IsNotEmpty()
  @IsString()
  startDate: string;

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
