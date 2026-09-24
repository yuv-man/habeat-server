import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  Matches,
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

  @ApiProperty({
    example: "22:30",
    required: false,
    description: "When it was eaten, 24h HH:mm local time",
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "time must be HH:mm" })
  time?: string;
}
