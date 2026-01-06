import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsIn } from "class-validator";

export class ActionDecisionDto {
  @ApiProperty({
    description: "The decision on the proposed action",
    enum: ["accept", "reject"],
    example: "accept",
  })
  @IsString()
  @IsIn(["accept", "reject"])
  decision: "accept" | "reject";
}
