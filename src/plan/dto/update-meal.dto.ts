import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsObject,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class MacrosDto {
  @ApiProperty({ required: false })
  @IsOptional()
  protein?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  carbs?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  fat?: number;
}

class MealDataDto {
  @ApiProperty({ example: "Grilled Chicken Salad", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 500, required: false })
  @IsOptional()
  calories?: number;

  @ApiProperty({ type: MacrosDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => MacrosDto)
  macros?: MacrosDto;

  @ApiProperty({
    example: [
      ["chicken", "200g"],
      ["lettuce", "100g"],
    ],
    required: false,
  })
  @IsOptional()
  ingredients?: [string, string][];

  @ApiProperty({ example: 30, required: false })
  @IsOptional()
  prepTime?: number;
}

export class UpdateMealDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty()
  @IsString()
  day: string;

  @ApiProperty({
    example: "breakfast",
    enum: ["breakfast", "lunch", "dinner", "snack"],
  })
  @IsNotEmpty()
  @IsString()
  mealType: "breakfast" | "lunch" | "dinner" | "snack";

  @ApiProperty({ type: MealDataDto })
  @ValidateNested()
  @Type(() => MealDataDto)
  @IsNotEmpty()
  mealData: MealDataDto;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  snackIndex?: number;
}
