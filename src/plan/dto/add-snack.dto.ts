import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  IsArray,
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

export class AddSnackDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({ example: "Apple with Almond Butter" })
  @IsNotEmpty()
  @IsString()
  name: string;
}
