import { Module, OnModuleInit } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { BrainController } from "./brain.controller";
import { BrainService } from "./brain.service";
import { PatternEngine } from "./patterns/pattern.engine";
import { StageEngine } from "./behavior/stage.engine";
import { DecisionEngine } from "./decision/decision.engine";

import { BehaviorEvent, BehaviorEventSchema } from "./schemas/behavior-event.schema";
import {
  BehaviorPattern,
  BehaviorPatternSchema,
} from "./schemas/behavior-pattern.schema";
import { BrainStateDoc, BrainStateSchema } from "./schemas/brain-state.model";

import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { User, UserSchema } from "../user/user.model";
import {
  MoodEntry,
  MoodEntrySchema,
  MealMoodCorrelation,
  MealMoodCorrelationSchema,
} from "../cbt/cbt.model";
import { BehaviorModule } from "../behavior/behavior.module";
import { REFRESH_HOUR, scheduleDailyAt } from "../behavior/behavior.schedule";
import logger from "../utils/logger";

/**
 * The Brain module.
 *
 * It imports BehaviorModule because the behaviour analyst is now a component
 * *of* the Brain rather than a peer to it: `BrainService` is the only thing on
 * the planning path that calls `BehaviorService`, and the meal generator talks
 * only to the Brain. That is the whole point of the arrangement — one place
 * decides, so two systems can never hand the model conflicting instructions.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BehaviorEvent.name, schema: BehaviorEventSchema },
      { name: BehaviorPattern.name, schema: BehaviorPatternSchema },
      { name: BrainStateDoc.name, schema: BrainStateSchema },
      // Read-only. The Brain observes what other modules recorded and owns
      // nothing but its own events, patterns and state.
      { name: DailyProgress.name, schema: DailyProgressSchema },
      { name: MoodEntry.name, schema: MoodEntrySchema },
      { name: MealMoodCorrelation.name, schema: MealMoodCorrelationSchema },
      // Not read by the Brain itself. `BrainController` is behind `AuthGuard`,
      // and the guard injects the User model — a module-scoped Mongoose
      // provider, so it has to be registered in whichever module hosts the
      // guarded controller. AuthModule being @Global() covers JwtService and
      // ConfigService but cannot cover this.
      { name: User.name, schema: UserSchema },
    ]),
    BehaviorModule,
  ],
  controllers: [BrainController],
  providers: [BrainService, PatternEngine, StageEngine, DecisionEngine],
  exports: [BrainService],
})
export class BrainModule implements OnModuleInit {
  constructor(private readonly service: BrainService) {}

  onModuleInit() {
    // The Brain runs an hour after the behaviour analyst, so each night's
    // decision is made over a freshly written profile rather than yesterday's.
    scheduleDailyAt(REFRESH_HOUR + 1, () => {
      this.service
        .runScheduledAnalysis()
        .catch((err) =>
          logger.error(`[BrainModule] Scheduled analysis failed: ${err}`),
        );
    });

    logger.info(
      `[BrainModule] Nightly analysis scheduled for ${REFRESH_HOUR + 1}:00 local`,
    );
  }
}
