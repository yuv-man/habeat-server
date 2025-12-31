import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsDate,
} from "class-validator";

export class GenerateGoalDto {
  @ApiProperty({
    example: "1234567890",
    description: "User ID",
  })
  @IsNotEmpty()
  @IsString()
  userId: string;

  @ApiProperty({
    example: "Run 5K",
    description: "Goal title",
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({
    example: "Improve cardiovascular endurance and complete a 5K.",
    description: "Goal description",
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    example: "2024-01-01",
    type: String,
    format: "date",
  })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  startDate: Date;

  @ApiProperty({
    example: "2024-01-01",
    type: String,
    format: "date",
  })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  targetDate?: Date;

  @ApiProperty({ example: "en", description: "Language", required: false })
  @IsOptional()
  @IsString()
  language?: string;
}
