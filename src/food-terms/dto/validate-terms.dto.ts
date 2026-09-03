import { ApiProperty } from "@nestjs/swagger";
import { SafeTermArray } from "../../utils/safe-input.decorator";

export class ValidateTermsDto {
  @ApiProperty({
    type: [String],
    example: ["Peanuts", "white socks", "Shakshuka"],
    description:
      "Custom terms the user typed into allergies / dislikes / preferences.",
  })
  // Same normalisation and injection guards as the fields these terms are
  // headed for — this endpoint must not become a softer way in.
  @SafeTermArray()
  terms: string[];
}
