import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";
import { SocialPost, SocialPostSchema } from "./schemas/social-post.schema";
import { Follow, FollowSchema } from "./schemas/follow.schema";
import { User, UserSchema } from "../user/user.model";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SocialPost.name, schema: SocialPostSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
