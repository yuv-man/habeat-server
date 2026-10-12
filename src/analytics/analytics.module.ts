import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AnalyticsService } from "./analytics.service";
import { User, UserSchema } from "../user/user.model";

@Global()
@Module({
  // The user model is read only to recognise test accounts.
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
