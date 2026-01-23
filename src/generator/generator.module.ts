import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { GeneratorController } from "./generator.controller";
import { GeneratorService } from "./generator.service";
import { Plan, PlanSchema } from "../plan/plan.model";
import { User, UserSchema } from "../user/user.model";
import { Meal, MealSchema } from "src/meal/meal.model";
import { Goal, GoalSchema } from "../goals/goal.model";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { ShoppingList, ShoppingListSchema } from "../shopping/shopping-list.model";
import { UsdaNutritionService } from "../utils/usda-nutrition.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: User.name, schema: UserSchema },
      { name: Meal.name, schema: MealSchema },
      { name: Goal.name, schema: GoalSchema },
      { name: DailyProgress.name, schema: DailyProgressSchema },
      { name: ShoppingList.name, schema: ShoppingListSchema },
    ]),
  ],
  controllers: [GeneratorController],
  providers: [GeneratorService, UsdaNutritionService],
  exports: [GeneratorService],
})
export class GeneratorModule {}
