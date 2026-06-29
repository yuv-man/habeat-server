import { Module, OnModuleInit } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { EatingProfile, EatingProfileSchema } from "./eating-profile.model";
import { EatingProfileAgent } from "./eating-profile.agent";
import { EatingProfileService } from "./eating-profile.service";
import { EatingProfileController } from "./eating-profile.controller";
import {
  MoodEntry, MoodEntrySchema,
  MealMoodCorrelation, MealMoodCorrelationSchema,
} from "../cbt/cbt.model";
import { User, UserSchema } from "../user/user.model";
import logger from "../utils/logger";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EatingProfile.name, schema: EatingProfileSchema },
      { name: MoodEntry.name, schema: MoodEntrySchema },
      { name: MealMoodCorrelation.name, schema: MealMoodCorrelationSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [EatingProfileController],
  providers: [EatingProfileAgent, EatingProfileService],
  exports: [EatingProfileService],
})
export class EatingProfileModule implements OnModuleInit {
  constructor(private readonly service: EatingProfileService) {}

  onModuleInit() {
    // Run weekly deep analysis every 7 days
    setInterval(async () => {
      logger.info("[EatingProfileModule] Starting weekly profile analysis");
      await this.service.runScheduledAnalysis();
    }, SEVEN_DAYS_MS);
  }
}
