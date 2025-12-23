import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsNumber, Min } from "class-validator";

export class DeleteWorkoutDto {
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

  @ApiProperty({
    example: 0,
    description: "Index of the workout in the workouts array to delete",
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  workoutIndex: number;
}
