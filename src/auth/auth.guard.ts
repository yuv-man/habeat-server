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
import mongoose from "mongoose";
import { IUserData } from "../types/interfaces";
import logger from "../utils/logger";
import { JwtPayload } from "../types/interfaces";
import { User } from "src/user/user.model";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<IUserData>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Check if test mode is enabled
    const testMode = this.configService.get<string>("TEST_MODE") === "true";

    if (testMode) {
      logger.warn("⚠️  TEST MODE ENABLED - Authentication is bypassed");

      // Try to get test user ID from config, or use a default mock user
      const testUserId = this.configService.get<string>("TEST_USER_ID");

      if (testUserId) {
        // Use the specified test user if it exists
        const user = await this.userModel
          .findById(testUserId)
          .select("-password")
          .lean();

        if (user) {
          request.user = user;
          return true;
        }
        logger.warn(
          `Test user with ID ${testUserId} not found, using mock user`
        );
      }

      // Create a mock user for testing with a valid ObjectId
      // Use a consistent ObjectId for test mode so it can be reused
      const testObjectId = new mongoose.Types.ObjectId();
      request.user = {
        _id: testObjectId,
        email: "test@example.com",
        name: "Test User",
        age: 30,
        gender: "male",
        height: 175,
        weight: 70,
        path: "healthy",
        allergies: [],
        dietaryRestrictions: [],
        foodPreferences: [],
        favoriteMeals: [],
      } as any;

      return true;
    }

    // Normal authentication flow
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException("Not authorized, no token");
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret:
          this.configService.get<string>("JWT_SECRET") ||
          "default-secret-key-change-in-production",
      });

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
