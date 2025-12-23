import { ApiProperty } from "@nestjs/swagger";
import { IPlan } from "../../types/interfaces";

export class DeleteSnackResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: "Snack deleted successfully" })
  message: string;

  @ApiProperty()
  data: {
    plan: IPlan;
  };
}
