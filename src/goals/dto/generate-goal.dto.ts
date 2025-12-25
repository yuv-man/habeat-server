import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsDate,
} from "class-validator";

export class GenerateGoalDto {
  @ApiProperty({
    example: "I want to run a 5K race and improve my cardiovascular fitness",
    description: "Free text describing the goal",
  })
  @IsNotEmpty()
  @IsString()
  aiRules: string;

  @ApiProperty({
    example: "2024-01-01",
    type: String,
    format: "date",
  })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  startDate: Date;

  @ApiProperty({
    example: "2024-01-01",
    type: String,
    format: "date",
  })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  targetDate: Date;

  @ApiProperty({
    example: 3,
    description: "Number of workouts per week",
  })
  @IsNotEmpty()
  @IsNumber()
  numberOfWorkouts: number;

  @ApiProperty({
    example: "balanced",
    enum: ["balanced", "keto", "vegan", "vegetarian", "paleo", "mediterranean"],
    description: "Diet type",
  })
  @IsNotEmpty()
  @IsString()
  dietType: string;

  @ApiProperty({ example: "en", description: "Language", required: false })
  @IsOptional()
  @IsString()
  language?: string;
}
