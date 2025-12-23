import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ConfigService } from "@nestjs/config";
import { User } from "../user/user.model";
import { IUserData, JwtPayload } from "../types/interfaces";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    private configService: ConfigService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>("JWT_SECRET") ||
        "default-secret-key-change-in-production",
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userModel
      .findById(payload.id)
      .select("-password")
      .lean();
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    return user;
  }
}
