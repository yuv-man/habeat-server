import { Controller, ForbiddenException, Get, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { isAdminRole } from "../enums/enumSubscription";
import { LlmUsageService } from "./llm-usage.service";

@ApiTags("admin")
@Controller("admin/llm-usage")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class LlmUsageController {
  constructor(private usage: LlmUsageService) {}

  @Get()
  @ApiOperation({ summary: "LLM spend: total, per feature, per user (admins only)" })
  @ApiQuery({ name: "days", required: false, description: "Window, default 30" })
  async report(@Request() req: any, @Query("days") days?: string) {
    if (!isAdminRole(req.user?.role)) throw new ForbiddenException("Admins only");
    const n = Math.max(1, Math.min(365, parseInt(days ?? "30", 10) || 30));
    return { success: true, data: await this.usage.report(n) };
  }

  @Post("check")
  @ApiOperation({ summary: "Run the budget check now (admins only)" })
  async check(@Request() req: any) {
    if (!isAdminRole(req.user?.role)) throw new ForbiddenException("Admins only");
    return { success: true, data: { alerts: await this.usage.checkBudgets() } };
  }
}
