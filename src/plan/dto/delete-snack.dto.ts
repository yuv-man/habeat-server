import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsNumber, Min } from "class-validator";

export class DeleteSnackDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty()
  @IsString()
  day: string;

  @ApiProperty({
    example: 0,
    description: "Index of the snack in the snacks array to delete",
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  snackIndex: number;
}
