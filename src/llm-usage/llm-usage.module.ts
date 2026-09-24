import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { LlmUsageDay, LlmUsageDaySchema } from "./llm-usage.model";
import { User, UserSchema } from "../user/user.model";
import { LlmUsageService } from "./llm-usage.service";
import { LlmUsageController } from "./llm-usage.controller";
import { UsageContextInterceptor } from "./usage-context.interceptor";

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LlmUsageDay.name, schema: LlmUsageDaySchema },
      // For AuthGuard on the admin controller (AuthModule is global).
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [LlmUsageController],
  providers: [LlmUsageService, { provide: APP_INTERCEPTOR, useClass: UsageContextInterceptor }],
  exports: [LlmUsageService],
})
export class LlmUsageModule {}
