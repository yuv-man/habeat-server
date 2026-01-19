import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ReflectionController } from "./reflection.controller";
import { ReflectionService } from "./reflection.service";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { User, UserSchema } from "../user/user.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyProgress.name, schema: DailyProgressSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ReflectionController],
  providers: [ReflectionService],
  exports: [ReflectionService],
})
export class ReflectionModule {}
