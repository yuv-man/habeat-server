import { ApiProperty } from "@nestjs/swagger";
import { IPlan } from "../../types/interfaces";

export class DeleteWorkoutResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: "Workout deleted successfully" })
  message: string;

  @ApiProperty()
  data: {
    plan: IPlan;
  };
}
