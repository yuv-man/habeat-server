import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { RepertoireController } from "./repertoire.controller";
import { RepertoireService } from "./repertoire.service";
import { DishTuner } from "./repertoire.tuner";
import { DishResolver } from "./repertoire.resolver";
import { RepertoireDish, RepertoireDishSchema } from "./repertoire-dish.schema";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { User, UserSchema } from "../user/user.model";

/**
 * The user's repertoire — docs/the-repertoire.md.
 *
 * Exported so the generator can read it once weekly balancing (§6) lands.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RepertoireDish.name, schema: RepertoireDishSchema },
      // Read-only: capture observes what progress recorded.
      { name: DailyProgress.name, schema: DailyProgressSchema },
      // Read by tuning (path, restrictions, dislikes), and needed by AuthGuard
      // on the controller; see BrainModule for why.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [RepertoireController],
  providers: [RepertoireService, DishTuner, DishResolver],
  exports: [RepertoireService],
})
export class RepertoireModule {}
