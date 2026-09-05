import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { CBTController } from "./cbt.controller";
import { CBTService } from "./cbt.service";
import {
  MoodEntry,
  MoodEntrySchema,
  ThoughtEntry,
  ThoughtEntrySchema,
  CBTExerciseCompletion,
  CBTExerciseCompletionSchema,
  MealMoodCorrelation,
  MealMoodCorrelationSchema,
} from "./cbt.model";
import { User, UserSchema } from "../user/user.model";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { ChallengeModule } from "../challenge/challenge.module";
import { EngagementModule } from "../engagement/engagement.module";
import { BehaviorModule } from "../behavior/behavior.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MoodEntry.name, schema: MoodEntrySchema },
      { name: ThoughtEntry.name, schema: ThoughtEntrySchema },
      { name: CBTExerciseCompletion.name, schema: CBTExerciseCompletionSchema },
      { name: MealMoodCorrelation.name, schema: MealMoodCorrelationSchema },
      { name: User.name, schema: UserSchema },
      // Read-only: the emotional-eating insights join meals ticked off on the
      // daily tracker with the moods logged around them.
      { name: DailyProgress.name, schema: DailyProgressSchema },
    ]),
    forwardRef(() => ChallengeModule),
    forwardRef(() => EngagementModule),
    forwardRef(() => BehaviorModule),
  ],
  controllers: [CBTController],
  providers: [CBTService],
  exports: [CBTService],
})
export class CBTModule {}
