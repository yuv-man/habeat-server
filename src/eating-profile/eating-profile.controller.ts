import { Controller, Get, Post, UseGuards, Request } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { EatingProfileService } from "./eating-profile.service";

@Controller("eating-profile")
@UseGuards(AuthGuard)
export class EatingProfileController {
  constructor(private readonly service: EatingProfileService) {}

  @Get()
  async getProfile(@Request() req: any) {
    const userId = req.user.userId;
    const { profile, patterns, suggestions } = await this.service.getProfileWithBank(userId);
    return { success: true, data: { profile, patterns, suggestions } };
  }

  @Post("sync")
  async sync(@Request() req: any) {
    const userId = req.user.userId;
    const { profile, patterns, suggestions } = await this.service.sync(userId);
    return { success: true, data: { profile, patterns, suggestions } };
  }
}
