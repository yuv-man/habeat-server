import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { FoodTermsService } from "./food-terms.service";
import { ValidateTermsDto } from "./dto/validate-terms.dto";

@ApiTags("food-terms")
@Controller("food-terms")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class FoodTermsController {
  constructor(private readonly foodTerms: FoodTermsService) {}

  /**
   * Sanity-check custom allergy / dislike / preference entries.
   *
   * Advisory only — the caller decides what to do with an unrecognised term.
   * Nothing here rejects or stores anything, so a term the user insists on
   * keeping is still saved normally.
   */
  @Post("validate")
  // Most terms resolve from the local dictionary; only the leftovers cost an
  // AI call, so this is generous but not unbounded.
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiOperation({ summary: "Check whether custom food terms look food-related" })
  @ApiResponse({
    status: 200,
    description:
      "Verdict per term. `recognised: false` means 'looks like it is not food' — a suggestion, not a rejection.",
  })
  async validate(@Body() body: ValidateTermsDto) {
    const results = await this.foodTerms.classify(body.terms ?? []);
    return {
      results,
      unrecognised: results.filter((r) => !r.recognised).map((r) => r.term),
    };
  }
}
