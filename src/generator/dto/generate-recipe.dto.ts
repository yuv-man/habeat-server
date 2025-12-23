import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  Min,
} from "class-validator";

export class GenerateRecipeDto {
  @ApiProperty({ example: "Grilled Chicken Salad" })
  @IsNotEmpty()
  @IsString()
  dishName: string;

  @ApiProperty({ example: "dinner", required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    example: [
      ["chicken", "100g"],
      ["salad", "100g"],
    ],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredients?: [string, string, string?][];

  @ApiProperty({ example: 4, required: false, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  servings?: number;

  @ApiProperty({ example: 500, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetCalories?: number;

  @ApiProperty({
    type: [String],
    example: ["gluten-free"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @ApiProperty({ example: "en", required: false })
  @IsOptional()
  @IsString()
  language?: string;
}
