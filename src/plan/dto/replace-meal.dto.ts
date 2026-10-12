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
  IsIn,
  IsBoolean,
} from "class-validator";
import { SWAP_REASONS, type SwapReason } from "../../utils/meal-learning";

/** Where a swap came from. Free text would make the analytics unusable. */
export const SWAP_VIAS = [
  "swap_modal", "my_meals", "quicker", "favorites", "manual", "ai_suggestion",
  "photo", "chat", "undo",
] as const;
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

  /**
   * Where the food came from, when the user said.
   *
   * Must be declared here or the global `whitelist: true` ValidationPipe
   * strips it off the nested object before the service ever sees it — the
   * request would look accepted and the field would silently vanish.
   */
  @IsOptional()
  @IsEnum(["cooked", "ordered", "eaten-out"])
  source?: "cooked" | "ordered" | "eaten-out";

  // Declared for the same reason as `source`: undeclared, the whitelist pipe
  // drops them, and a swapped-in own dish lost its "Your dish" label.
  @ApiProperty({ required: false, description: "English name, used to pick the meal's photo" })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiProperty({ required: false, description: "Repertoire dish this meal is, when it is the user's own" })
  @IsOptional()
  @IsString()
  fromRepertoire?: string;
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

  @ApiProperty({ required: false, enum: SWAP_REASONS, description: "Why the planned meal didn't work" })
  @IsOptional()
  @IsIn(SWAP_REASONS as unknown as string[])
  reason?: SwapReason;

  @ApiProperty({ required: false, enum: SWAP_VIAS })
  @IsOptional()
  @IsIn(SWAP_VIAS as unknown as string[])
  via?: (typeof SWAP_VIAS)[number];

  @ApiProperty({ required: false, description: "Putting back the meal a previous swap replaced" })
  @IsOptional()
  @IsBoolean()
  undo?: boolean;
}
