import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ShoppingController } from "./shopping.controller";
import { ShoppingService } from "./shopping.service";
import { ShoppingList, ShoppingListSchema } from "./shopping-list.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { Meal, MealSchema } from "../meal/meal.model";
import { User, UserSchema } from "src/user/user.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShoppingList.name, schema: ShoppingListSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Meal.name, schema: MealSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ShoppingController],
  providers: [ShoppingService],
  exports: [ShoppingService],
})
export class ShoppingModule {}
