import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  IsEnum,
  ValidateNested,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export enum MealCategory {
  BREAKFAST = "breakfast",
  LUNCH = "lunch",
  DINNER = "dinner",
  SNACK = "snack",
}

class CurrentMoodDto {
  @ApiProperty({
    example: "stressed",
    description: "Current mood category",
  })
  @IsString()
  moodCategory: string;

  @ApiProperty({
    example: 3,
    description: "Current mood level (1-5)",
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  moodLevel: number;
}

class MealCriteriaDto {
  @ApiProperty({
    example: "lunch",
    enum: MealCategory,
  })
  @IsNotEmpty()
  @IsEnum(MealCategory)
  category: MealCategory;

  @ApiProperty({ example: 500, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetCalories?: number;

  @ApiProperty({
    type: [String],
    example: ["vegetarian"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @ApiProperty({
    type: [String],
    example: ["high protein"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferences?: string[];

  @ApiProperty({
    type: [String],
    example: ["chicken"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dislikes?: string[];

  @ApiProperty({
    example: 3,
    required: false,
    minimum: 1,
    maximum: 10,
    description: "Number of meal suggestions to generate",
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  numberOfSuggestions?: number;

  @ApiProperty({
    type: CurrentMoodDto,
    required: false,
    description: "Current user mood for mood-aware suggestions",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CurrentMoodDto)
  currentMood?: CurrentMoodDto;

  @ApiProperty({
    type: [String],
    required: false,
    description: "Foods recommended based on current mood",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  moodFoodSuggestions?: string[];
}

export class ChangeMealDto {
  @ApiProperty({ type: MealCriteriaDto })
  @ValidateNested()
  @Type(() => MealCriteriaDto)
  @IsNotEmpty()
  mealCriteria: MealCriteriaDto;

  @ApiProperty({ example: "Explain the meal in detail", required: false })
  @IsOptional()
  @IsString()
  aiRules?: string;

  @ApiProperty({ example: "en", required: false })
  @IsOptional()
  @IsString()
  language?: string;
}
