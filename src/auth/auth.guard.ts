import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { IUserData } from "../types/interfaces";
import logger from "../utils/logger";
import { JwtPayload } from "../types/interfaces";
import { User } from "src/user/user.model";
import { isMongoObjectIdString } from "../utils/mongoObjectId";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<IUserData>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException("Not authorized, no token");
    }

    try {
      const jwtSecret = this.configService.get<string>("JWT_SECRET");
      if (!jwtSecret) {
        logger.error("JWT_SECRET environment variable is not configured");
        throw new UnauthorizedException("Server configuration error");
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: jwtSecret,
      });

      if (!isMongoObjectIdString(payload.id)) {
        throw new UnauthorizedException("Not authorized, invalid subject in token");
      }
      const user = await this.userModel
        .findById(payload.id)
        .select("-password")
        .lean();
      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      request.user = user;
    } catch (error) {
      logger.error("Auth guard error:", error);
      throw new UnauthorizedException("Not authorized, token failed");
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
