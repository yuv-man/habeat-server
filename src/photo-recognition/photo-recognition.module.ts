import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { PhotoRecognitionController } from "./photo-recognition.controller";
import { PhotoRecognitionService } from "./photo-recognition.service";
import { User, UserSchema } from "../user/user.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PhotoRecognitionController],
  providers: [PhotoRecognitionService],
  exports: [PhotoRecognitionService],
})
export class PhotoRecognitionModule {}
