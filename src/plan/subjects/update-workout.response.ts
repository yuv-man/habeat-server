import { ApiProperty } from "@nestjs/swagger";

export class UpdateWorkoutResponse {
  @ApiProperty({ example: "success" })
  success: boolean;

  @ApiProperty()
  data: {
    plan: any;
    workout: any;
  };
}
