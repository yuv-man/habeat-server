import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { FoodTermsController } from "./food-terms.controller";
import { FoodTermsService } from "./food-terms.service";
import { User, UserSchema } from "../user/user.model";

@Module({
  imports: [
    // AuthGuard injects the User model to load the request's user, so every
    // module whose controller is guarded has to register it. JwtService and
    // ConfigService come from globally registered modules.
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [FoodTermsController],
  providers: [FoodTermsService],
  exports: [FoodTermsService],
})
export class FoodTermsModule {}
