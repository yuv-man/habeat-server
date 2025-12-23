import { ApiProperty } from "@nestjs/swagger";
import { IMeal } from "src/types/interfaces";

class MacrosDto {
  @ApiProperty()
  protein: number;

  @ApiProperty()
  carbs: number;

  @ApiProperty()
  fat: number;
}

export class MealSuggestionsResponse {
  @ApiProperty({ example: "success" })
  status: string;

  @ApiProperty({ example: "Meal suggestions generated successfully" })
  message: string;

  @ApiProperty()
  data: IMeal[];
}
