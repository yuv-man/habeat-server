import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { User, UserSchema } from "./user.model";
import { Meal, MealSchema } from "../meal/meal.model";
import { BehaviorModule } from "../behavior/behavior.module";
import { RepertoireModule } from "../repertoire/repertoire.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Meal.name, schema: MealSchema },
    ]),
    forwardRef(() => BehaviorModule),
    // Hearting a meal adds it to the user's own meals.
    forwardRef(() => RepertoireModule),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
