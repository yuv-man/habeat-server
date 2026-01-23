import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { PlanController } from "./plan.controller";
import { PlanService } from "./plan.service";
import { Plan, PlanSchema } from "./plan.model";
import {
  ShoppingList,
  ShoppingListSchema,
} from "../shopping/shopping-list.model";
import { User, UserSchema } from "../user/user.model";
import { Meal, MealSchema } from "../meal/meal.model";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { ProgressModule } from "../progress/progress.module";
import { GeneratorModule } from "../generator/generator.module";
import { UsdaNutritionService } from "../utils/usda-nutrition.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: ShoppingList.name, schema: ShoppingListSchema },
      { name: User.name, schema: UserSchema },
      { name: Meal.name, schema: MealSchema },
      { name: DailyProgress.name, schema: DailyProgressSchema },
    ]),
    forwardRef(() => ProgressModule),
    forwardRef(() => GeneratorModule),
  ],
  controllers: [PlanController],
  providers: [PlanService, UsdaNutritionService],
  exports: [PlanService],
})
export class PlanModule {}
