import { ApiProperty } from "@nestjs/swagger";

export class UpdateMacrosResponse {
  @ApiProperty({ example: "success" })
  success: boolean;

  @ApiProperty()
  data: {
    plan: any;
    weeklyMacros: any;
  };
}
