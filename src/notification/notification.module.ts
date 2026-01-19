import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { User, UserSchema } from "../user/user.model";
import { DailyProgress, DailyProgressSchema } from "../progress/progress.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: DailyProgress.name, schema: DailyProgressSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
