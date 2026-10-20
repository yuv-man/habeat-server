import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { EngagementModule } from "../engagement/engagement.module";
import { User, UserSchema } from "../user/user.model";
import { EnrollmentController, ProgramController } from "./challenge-program.controller";
import { ChallengeEnrollment, ChallengeEnrollmentSchema } from "./enrollment.model";
import { EnrollmentService } from "./enrollment.service";

/**
 * Guided challenge programs and the user's journey through them. Separate from
 * src/challenge, which owns the older auto-assigned micro-challenges (§3.4).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChallengeEnrollment.name, schema: ChallengeEnrollmentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => EngagementModule),
  ],
  controllers: [ProgramController, EnrollmentController],
  providers: [EnrollmentService],
  exports: [EnrollmentService],
})
export class ChallengeProgramModule {}
