import { ApiProperty } from "@nestjs/swagger";
import { IWorkout, IPlan } from "../../types/interfaces";

export class AddWorkoutResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty()
  data: {
    plan: IPlan;
    workout: IWorkout;
  };
}
