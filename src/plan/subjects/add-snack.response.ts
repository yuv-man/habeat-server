import { ApiProperty } from "@nestjs/swagger";
import { IMeal, IPlan } from "../../types/interfaces";

export class AddSnackResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty()
  data: {
    plan: IPlan;
    snack: IMeal;
  };
}
