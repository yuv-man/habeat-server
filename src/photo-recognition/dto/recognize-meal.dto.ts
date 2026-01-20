import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RecognizeMealDto {
  @ApiProperty({
    description: "Base64 encoded image string (with or without data URI prefix)",
    example: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;
}

export class GetNutritionDto {
  @ApiProperty({
    description: "Name of the meal to look up nutrition for",
    example: "Grilled Chicken Salad",
  })
  @IsNotEmpty()
  @IsString()
  mealName: string;
}

export interface RecognizedMealResponse {
  mealName: string;
  confidence: "high" | "medium" | "low" | "none";
  description: string;
  aiEstimates?: {
    calories: number;
    macros: {
      protein: number;
      carbs: number;
      fat: number;
    };
  };
}

export interface NutritionResponse {
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  servingSize: string;
  source: string;
  fdcId?: string;
}
