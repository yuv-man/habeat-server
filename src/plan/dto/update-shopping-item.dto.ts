import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsBoolean } from "class-validator";

export class UpdateShoppingItemDto {
  @ApiProperty({
    example: "chicken_breast_500g",
    description: "Unique key identifier for the ingredient",
  })
  @IsNotEmpty()
  @IsString()
  ingredientKey: string;

  @ApiProperty({
    example: true,
    description: "Whether the ingredient has been bought (done)",
  })
  @IsNotEmpty()
  @IsBoolean()
  done: boolean;
}
