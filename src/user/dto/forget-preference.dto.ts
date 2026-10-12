import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ForgetPreferenceDto {
  @ApiProperty({ enum: ["enjoyed", "avoided"], description: "Which inference the user is correcting" })
  @IsIn(["enjoyed", "avoided"])
  kind: "enjoyed" | "avoided";

  @ApiProperty({ example: "Beef Tacos" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}
