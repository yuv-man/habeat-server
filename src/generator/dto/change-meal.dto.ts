import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  ValidateNested,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { SafeLLMInput, SafeLLMArray } from "../../utils/safe-input.decorator";

export enum MealCategory {
  BREAKFAST = "breakfast",
  LUNCH = "lunch",
  DINNER = "dinner",
  SNACK = "snack",
}

class CurrentMoodDto {
  @ApiProperty({ example: "stressed", description: "Current mood category" })
  @SafeLLMInput(50)
  moodCategory: string;

  @ApiProperty({ example: 3, description: "Current mood level (1-5)", minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  moodLevel: number;
}

class MealCriteriaDto {
  @ApiProperty({ example: "lunch", enum: MealCategory })
  @IsNotEmpty()
  @IsEnum(MealCategory)
  category: MealCategory;

  @ApiProperty({ example: 500, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetCalories?: number;

  @ApiProperty({ type: [String], example: ["vegetarian"], required: false })
  @IsOptional()
  @SafeLLMArray(100)
  dietaryRestrictions?: string[];

  @ApiProperty({ type: [String], example: ["high protein"], required: false })
  @IsOptional()
  @SafeLLMArray(100)
  preferences?: string[];

  @ApiProperty({ type: [String], example: ["chicken"], required: false })
  @IsOptional()
  @SafeLLMArray(100)
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

  @ApiProperty({ type: CurrentMoodDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => CurrentMoodDto)
  currentMood?: CurrentMoodDto;

  @ApiProperty({ type: [String], required: false, description: "Foods recommended based on current mood" })
  @IsOptional()
  @SafeLLMArray(100)
  moodFoodSuggestions?: string[];
}

export class ChangeMealDto {
  @ApiProperty({ type: MealCriteriaDto })
  @ValidateNested()
  @Type(() => MealCriteriaDto)
  @IsNotEmpty()
  mealCriteria: MealCriteriaDto;

  /** Free-text rules the user types — goes directly into the AI prompt */
  @ApiProperty({ example: "Make it low carb", required: false })
  @IsOptional()
  @SafeLLMInput(500)
  aiRules?: string;

  @ApiProperty({ example: "en", required: false })
  @IsOptional()
  @SafeLLMInput(10)
  language?: string;
}
