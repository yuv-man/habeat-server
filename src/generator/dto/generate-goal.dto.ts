import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDate,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";

export enum GoalCategory {
  WEIGHT_LOSS = "weight_loss",
  MUSCLE_GAIN = "muscle_gain",
  FITNESS = "fitness",
  NUTRITION = "nutrition",
  HEALTH = "health",
}

export class GenerateGoalDto {
  @ApiProperty({
    example: "I want to lose 10kg and improve my fitness",
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    example: "weight_loss",
    enum: GoalCategory,
  })
  @IsNotEmpty()
  @IsEnum(GoalCategory)
  category: GoalCategory;

  @ApiProperty({
    example: "2024-12-31",
    type: String,
    format: "date",
  })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  targetDate: Date;

  @ApiProperty({
    example: "2024-01-01",
    type: String,
    format: "date",
  })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  startDate: Date;

  @ApiProperty({ example: "en", required: false })
  @IsOptional()
  @IsString()
  language?: string;
}
