import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { EngagementController } from "./engagement.controller";
import { EngagementService } from "./engagement.service";
import { WeeklySummaryService } from "./weekly-summary.service";
import { User, UserSchema } from "../user/user.model";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { ProgressModule } from "../progress/progress.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: DailyProgress.name, schema: DailyProgressSchema },
    ]),
    forwardRef(() => ProgressModule),
  ],
  controllers: [EngagementController],
  providers: [EngagementService, WeeklySummaryService],
  exports: [EngagementService, WeeklySummaryService],
})
export class EngagementModule {}
