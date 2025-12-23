import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
} from "class-validator";

export class UpdateWorkoutDto {
  @ApiProperty({
    example: "2024-01-15",
    description:
      "Date in YYYY-MM-DD format or day name (monday, tuesday, etc.)",
  })
  @IsNotEmpty({ message: "date is required (e.g., '2024-01-15' or 'monday')" })
  @IsString({ message: "date must be a string in YYYY-MM-DD format or day name" })
  date: string;

  @ApiProperty({
    example: 0,
    description: "Index of the workout in the workouts array",
  })
  @IsNotEmpty({ message: "workoutIndex is required" })
  @IsNumber({}, { message: "workoutIndex must be a number" })
  @Min(0, { message: "workoutIndex must be at least 0" })
  workoutIndex: number;

  @ApiProperty({ example: "Running", required: false, description: "Name of the workout" })
  @IsOptional()
  @IsString({ message: "name must be a string" })
  name?: string;

  @ApiProperty({ example: "cardio", required: false, description: "Workout category" })
  @IsOptional()
  @IsString({ message: "category must be a string" })
  category?: string;

  @ApiProperty({ example: 30, required: false, minimum: 0, description: "Duration in minutes" })
  @IsOptional()
  @IsNumber({}, { message: "duration must be a number (in minutes)" })
  @Min(0, { message: "duration must be at least 0 minutes" })
  duration?: number;

  @ApiProperty({ example: 300, required: false, minimum: 0, description: "Calories burned" })
  @IsOptional()
  @IsNumber({}, { message: "caloriesBurned must be a number" })
  @Min(0, { message: "caloriesBurned must be at least 0" })
  caloriesBurned?: number;

  @ApiProperty({
    example: "12:00",
    required: false,
    description: "Scheduled time in HH:MM format",
  })
  @IsOptional()
  @IsString({ message: "time must be a string in HH:MM format (e.g., '08:00')" })
  time?: string;
}
