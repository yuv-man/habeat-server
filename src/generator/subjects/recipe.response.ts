import { ApiProperty } from "@nestjs/swagger";

class MacrosDto {
  @ApiProperty({ example: 500 })
  calories: number;

  @ApiProperty({ example: 30 })
  protein: number;

  @ApiProperty({ example: 50 })
  carbs: number;

  @ApiProperty({ example: 15 })
  fat: number;
}

class IngredientDto {
  @ApiProperty({ example: "chicken breast" })
  name: string;

  @ApiProperty({ example: "200" })
  amount: string;

  @ApiProperty({ example: "g" })
  unit: string;
}

class InstructionDto {
  @ApiProperty({ example: 1 })
  step: number;

  @ApiProperty({ example: "Preheat the oven to 180°C" })
  instruction: string;

  @ApiProperty({ required: false, example: 5 })
  time?: number;

  @ApiProperty({ required: false, example: 180 })
  temperature?: number;
}

class DietaryInfoDto {
  @ApiProperty({ example: false })
  isVegetarian: boolean;

  @ApiProperty({ example: false })
  isVegan: boolean;

  @ApiProperty({ example: false })
  isGlutenFree: boolean;

  @ApiProperty({ example: false })
  isDairyFree: boolean;

  @ApiProperty({ example: false })
  isKeto: boolean;

  @ApiProperty({ example: false })
  isLowCarb: boolean;
}

class RecipeDataDto {
  @ApiProperty({ example: "Grilled Chicken Salad" })
  mealName: string;

  @ApiProperty({ example: "grilled_chicken_salad_001" })
  mealId: string;

  @ApiProperty({
    example:
      "A delicious and healthy grilled chicken salad with fresh vegetables",
  })
  description: string;

  @ApiProperty({
    example: "lunch",
    enum: ["breakfast", "lunch", "dinner", "snack"],
  })
  category: string;

  @ApiProperty({ example: 2 })
  servings: number;

  @ApiProperty({ example: 15 })
  prepTime: number;

  @ApiProperty({ example: 20 })
  cookTime: number;

  @ApiProperty({ example: "easy", enum: ["easy", "medium", "hard"] })
  difficulty: string;

  @ApiProperty({ type: MacrosDto })
  macros: MacrosDto;

  @ApiProperty({ type: [IngredientDto] })
  ingredients: IngredientDto[];

  @ApiProperty({ type: [InstructionDto] })
  instructions: InstructionDto[];

  @ApiProperty({ type: [String], example: ["pan", "oven"] })
  equipment: string[];

  @ApiProperty({ type: [String], example: ["healthy", "high-protein"] })
  tags: string[];

  @ApiProperty({ type: DietaryInfoDto })
  dietaryInfo: DietaryInfoDto;

  @ApiProperty({ example: "en" })
  language: string;

  @ApiProperty({ example: 1 })
  usageCount: number;
}

export class RecipeResponse {
  @ApiProperty({ example: "success" })
  status: string;

  @ApiProperty({ example: "Recipe generated successfully" })
  message: string;

  @ApiProperty({ type: RecipeDataDto })
  data: RecipeDataDto;
}
