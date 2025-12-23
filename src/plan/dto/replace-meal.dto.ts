import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsObject,
  ValidateNested,
  IsArray,
} from "class-validator";
import { Type } from "class-transformer";

class MacrosDto {
  @IsOptional()
  @IsNumber()
  protein?: number;

  @IsOptional()
  @IsNumber()
  carbs?: number;

  @IsOptional()
  @IsNumber()
  fat?: number;
}

class MealDto {
  @IsOptional()
  @IsString()
  _id?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNumber()
  calories: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => MacrosDto)
  macros?: MacrosDto;

  @IsOptional()
  @IsEnum(["breakfast", "lunch", "dinner", "snack"])
  category?: "breakfast" | "lunch" | "dinner" | "snack";

  @IsOptional()
  @IsArray()
  ingredients?: any[];

  @IsOptional()
  @IsNumber()
  prepTime?: number;
}

export class ReplaceMealDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({
    example: "breakfast",
    enum: ["breakfast", "lunch", "dinner", "snack"],
  })
  @IsNotEmpty()
  @IsEnum(["breakfast", "lunch", "dinner", "snack"])
  mealType: "breakfast" | "lunch" | "dinner" | "snack";

  @ApiProperty({
    example: {
      name: "Grilled Chicken Salad",
      calories: 500,
      macros: {
        protein: 20,
        carbs: 30,
        fat: 10,
      },
      category: "lunch",
      ingredients: [
        ["chicken", "200g"],
        ["lettuce", "100g"],
      ],
      prepTime: 30,
    },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => MealDto)
  newMeal: MealDto;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @IsNumber()
  snackIndex?: number;
}
