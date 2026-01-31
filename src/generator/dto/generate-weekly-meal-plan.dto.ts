import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDate,
  IsBoolean,
  ValidateNested,
  IsNumber,
  IsArray,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";

export class UserDataDto {
  @ApiProperty({ example: "John Doe" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 30 })
  @IsNotEmpty()
  @IsNumber()
  age: number;

  @ApiProperty({ example: "male", enum: ["male", "female"] })
  @IsNotEmpty()
  @IsEnum(["male", "female"])
  gender: "male" | "female";

  @ApiProperty({ example: 175 })
  @IsNotEmpty()
  @IsNumber()
  height: number;

  @ApiProperty({ example: 70 })
  @IsNotEmpty()
  @IsNumber()
  weight: number;

  @ApiProperty({ example: 3 })
  @IsNotEmpty()
  @IsNumber()
  workoutFrequency: number;

  @ApiProperty({ example: "healthy" })
  @IsNotEmpty()
  @IsString()
  path: string;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];
}

export class GenerateWeeklyMealPlanDto {
  @ApiProperty({ example: "2024-01-01", type: String, format: "date" })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  startDate: Date;

  @ApiProperty({ example: "en", required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ example: "My Meal Plan", required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  useMock?: boolean;

  @ApiProperty({
    example: "red-carpet-balance",
    required: false,
    description:
      "Predefined plan template ID. If provided, goals are ignored and the plan follows the template style. Valid values: red-carpet-balance, high-performance-fuel, plant-forward-glow, mindful-living, modern-comfort",
  })
  @IsOptional()
  @IsString()
  planTemplate?: string;
}
