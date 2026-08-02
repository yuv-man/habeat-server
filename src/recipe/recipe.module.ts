import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { RecipeController } from "./recipe.controller";
import { RecipeService } from "./recipe.service";
import { Recipe, RecipeSchema } from "./recipe.model";
import { User, UserSchema } from "../user/user.model";
import { Meal, MealSchema } from "../meal/meal.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { UserModule } from "src/user/user.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recipe.name, schema: RecipeSchema },
      { name: User.name, schema: UserSchema },
      { name: Meal.name, schema: MealSchema },
      // Generated meals live inside the plan document and have no row in the
      // `meals` collection, so recipe lookup needs the plan too.
      { name: Plan.name, schema: PlanSchema },
    ]),
  ],
  controllers: [RecipeController],
  providers: [RecipeService],
  exports: [RecipeService],
})
export class RecipeModule {}
