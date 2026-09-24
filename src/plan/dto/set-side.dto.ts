import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class SetSideDto {
  @ApiProperty({ example: "2026-09-24", description: "Date of the meal (YYYY-MM-DD)" })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({ example: "lunch", enum: ["lunch", "dinner"] })
  @IsIn(["lunch", "dinner"])
  mealType: "lunch" | "dinner";

  @ApiProperty({
    example: "rice+israeli-salad",
    required: false,
    nullable: true,
    description: "A side option id from side-options; null for no side",
  })
  @IsOptional()
  @IsString()
  optionId?: string | null;
}
