import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { GoalController } from "./goal.controller";
import { GoalService } from "./goal.service";
import { Goal, GoalSchema } from "./goal.model";
import { User, UserSchema } from "../user/user.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Goal.name, schema: GoalSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [GoalController],
  providers: [GoalService],
  exports: [GoalService],
})
export class GoalModule {}
