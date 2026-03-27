import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class AddCommentDto {
  @ApiProperty({ example: "Great job! Keep it up!" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  text: string;
}
