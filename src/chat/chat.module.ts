import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatAIService } from "./chat-ai.service";
import { Chat, ChatSchema } from "./chat.model";
import { User, UserSchema } from "../user/user.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { Goal, GoalSchema } from "../goals/goal.model";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";
import { PlanModule } from "../plan/plan.module";
import { ProgressModule } from "../progress/progress.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Chat.name, schema: ChatSchema },
      { name: User.name, schema: UserSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Goal.name, schema: GoalSchema },
      { name: DailyProgress.name, schema: DailyProgressSchema },
    ]),
    forwardRef(() => PlanModule),
    forwardRef(() => ProgressModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatAIService],
  exports: [ChatService],
})
export class ChatModule {}
