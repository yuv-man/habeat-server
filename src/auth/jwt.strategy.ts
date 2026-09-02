import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ConfigService } from "@nestjs/config";
import { User } from "../user/user.model";
import { IUserData, JwtPayload } from "../types/interfaces";
import { isMongoObjectIdString } from "../utils/mongoObjectId";
import { isTokenRevoked } from "./token-version";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    private configService: ConfigService
  ) {
    const jwtSecret = configService.get<string>("JWT_SECRET");
    // Fail closed. A hardcoded fallback here meant that if JWT_SECRET was ever
    // unset, every token verified against a secret published in this source
    // file — a forge-any-user primitive. A missing auth secret must stop the
    // app from starting, never silently accept a known key.
    if (!jwtSecret) {
      throw new Error(
        "JWT_SECRET is not configured. Refusing to start without a signing secret."
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload) {
    if (!isMongoObjectIdString(payload.id)) {
      throw new UnauthorizedException("Invalid subject in token");
    }
    const user = await this.userModel
      .findById(payload.id)
      .select("-password")
      .lean();
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    // Reject revoked tokens (see AuthGuard for the tv=0 backward-compat note).
    if (isTokenRevoked(payload.tv, (user as any).tokenVersion)) {
      throw new UnauthorizedException("Session expired. Please sign in again.");
    }
    return user;
  }
}
