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
import { ChallengeModule } from "../challenge/challenge.module";
import { EngagementModule } from "../engagement/engagement.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MoodEntry.name, schema: MoodEntrySchema },
      { name: ThoughtEntry.name, schema: ThoughtEntrySchema },
      { name: CBTExerciseCompletion.name, schema: CBTExerciseCompletionSchema },
      { name: MealMoodCorrelation.name, schema: MealMoodCorrelationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => ChallengeModule),
    forwardRef(() => EngagementModule),
  ],
  controllers: [CBTController],
  providers: [CBTService],
  exports: [CBTService],
})
export class CBTModule {}
