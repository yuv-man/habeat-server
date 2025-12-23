import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { RecipeController } from "./recipe.controller";
import { RecipeService } from "./recipe.service";
import { Recipe, RecipeSchema } from "./recipe.model";
import { User, UserSchema } from "../user/user.model";
import { Meal, MealSchema } from "../meal/meal.model";
import { UserModule } from "src/user/user.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recipe.name, schema: RecipeSchema },
      { name: User.name, schema: UserSchema },
      { name: Meal.name, schema: MealSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [RecipeController],
  providers: [RecipeService],
  exports: [RecipeService],
})
export class RecipeModule {}
