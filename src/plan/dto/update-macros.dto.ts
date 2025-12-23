import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
} from "class-validator";

export class UpdateMacrosDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty()
  @IsString()
  day: string;

  @ApiProperty({ example: 2000, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  calories?: number;

  @ApiProperty({ example: 150, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  protein?: number;

  @ApiProperty({ example: 200, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  carbs?: number;

  @ApiProperty({ example: 65, required: false, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fat?: number;
}
