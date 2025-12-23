import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ProgressController } from "./progress.controller";
import { ProgressService } from "./progress.service";
import { DailyProgress, DailyProgressSchema } from "./progress.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { User, UserSchema } from "../user/user.model";
import { Meal, MealSchema } from "../meal/meal.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyProgress.name, schema: DailyProgressSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: User.name, schema: UserSchema },
      { name: Meal.name, schema: MealSchema },
    ]),
  ],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
