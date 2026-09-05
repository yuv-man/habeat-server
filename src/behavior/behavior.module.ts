import { Module, OnModuleInit } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { BehaviorController } from "./behavior.controller";
import { BehaviorService } from "./behavior.service";
import { BehaviorAnalystAgent } from "./behavior-analyst.agent";
import { BehaviorProfile, BehaviorProfileSchema } from "./behavior-profile.model";

import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import {
  MoodEntry,
  MoodEntrySchema,
  MealMoodCorrelation,
  MealMoodCorrelationSchema,
} from "../cbt/cbt.model";
import { User, UserSchema } from "../user/user.model";
import { Goal, GoalSchema } from "../goals/goal.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { REFRESH_HOUR, scheduleDailyAt } from "./behavior.schedule";
import logger from "../utils/logger";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BehaviorProfile.name, schema: BehaviorProfileSchema },
      // All read-only: the pipeline observes what other modules recorded and
      // owns nothing but its own profile.
      { name: DailyProgress.name, schema: DailyProgressSchema },
      { name: MoodEntry.name, schema: MoodEntrySchema },
      { name: MealMoodCorrelation.name, schema: MealMoodCorrelationSchema },
      { name: User.name, schema: UserSchema },
      { name: Goal.name, schema: GoalSchema },
      // Read-only, and only to know when a plan is about to be regenerated —
      // the profile is refreshed the night before, not during.
      { name: Plan.name, schema: PlanSchema },
    ]),
  ],
  controllers: [BehaviorController],
  providers: [BehaviorService, BehaviorAnalystAgent],
  exports: [BehaviorService],
})
export class BehaviorModule implements OnModuleInit {
  constructor(private readonly service: BehaviorService) {}

  onModuleInit() {
    // The invisible trigger. Analysis runs here on a timer and nowhere else:
    // no request path may cause a model call (see buildPlannerContext), and
    // running overnight means the profile is already current by the morning
    // someone asks for a new week.
    scheduleDailyAt(REFRESH_HOUR, () => {
      this.service
        .runScheduledAnalysis()
        .catch((err) => logger.error(`[BehaviorModule] Scheduled analysis failed: ${err}`));
    });

    logger.info(
      `[BehaviorModule] Nightly profile refresh scheduled for ${REFRESH_HOUR}:00 local`,
    );
  }
}
