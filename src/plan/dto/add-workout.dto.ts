import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
} from "class-validator";

export class AddWorkoutDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty({ message: "date is required (e.g., '2024-01-15' or 'monday')" })
  @IsString({
    message: "date must be a string in YYYY-MM-DD format or day name",
  })
  date: string;

  @ApiProperty({ example: "Running", description: "Name of the workout" })
  @IsNotEmpty({ message: "name is required (e.g., 'Morning Run')" })
  @IsString({ message: "name must be a string" })
  name: string;

  @ApiProperty({
    example: "cardio",
    required: false,
    description: "Workout category",
  })
  @IsOptional()
  @IsString({
    message: "category must be a string (e.g., 'cardio', 'strength')",
  })
  category?: string;

  @ApiProperty({ example: 30, minimum: 0, description: "Duration in minutes" })
  @IsNotEmpty({ message: "duration is required (in minutes)" })
  @IsNumber({}, { message: "duration must be a number (in minutes)" })
  @Min(0, { message: "duration must be at least 0 minutes" })
  duration: number;

  @ApiProperty({ example: 300, minimum: 0, description: "Calories burned" })
  @IsNotEmpty({ message: "caloriesBurned is required" })
  @IsNumber({}, { message: "caloriesBurned must be a number" })
  @Min(0, { message: "caloriesBurned must be at least 0" })
  caloriesBurned: number;

  @ApiProperty({
    example: "12:00",
    required: false,
    description: "Scheduled time in HH:MM format",
  })
  @IsOptional()
  @IsString({
    message: "time must be a string in HH:MM format (e.g., '08:00')",
  })
  time?: string;
}
