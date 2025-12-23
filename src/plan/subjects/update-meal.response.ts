import { ApiProperty } from "@nestjs/swagger";

export class UpdateMealResponse {
  @ApiProperty({ example: "success" })
  success: boolean;

  @ApiProperty()
  data: {
    plan: any;
    dayPlan: any;
  };
}
