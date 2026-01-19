import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ChallengeController } from "./challenge.controller";
import { ChallengeService } from "./challenge.service";
import { Challenge, ChallengeSchema } from "./challenge.model";
import { EngagementModule } from "../engagement/engagement.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Challenge.name, schema: ChallengeSchema },
    ]),
    forwardRef(() => EngagementModule),
  ],
  controllers: [ChallengeController],
  providers: [ChallengeService],
  exports: [ChallengeService],
})
export class ChallengeModule {}
