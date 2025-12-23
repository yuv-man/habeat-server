import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MealController } from "./meal.controller";
import { MealService } from "./meal.service";
import { Meal, MealSchema } from "./meal.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { Recipe, RecipeSchema } from "../recipe/recipe.model";
import { User, UserSchema } from "../user/user.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Meal.name, schema: MealSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [MealController],
  providers: [MealService],
  exports: [MealService],
})
export class MealModule {}
