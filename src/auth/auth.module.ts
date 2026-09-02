import { Module, forwardRef, Global } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { SubscriptionGuard } from "./guards/subscription.guard";
import { JwtStrategy } from "./jwt.strategy";
import { User, UserSchema } from "../user/user.model";
import { Plan, PlanSchema } from "../plan/plan.model";
import { PlanModule } from "../plan/plan.module";

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>("JWT_SECRET");
        // Same fail-closed rule as jwt.strategy.ts: no secret, no boot. This
        // JwtService both signs new tokens and backs AuthGuard's verify, so a
        // fallback here is a forge-any-user hole on both sides.
        if (!secret) {
          throw new Error(
            "JWT_SECRET is not configured. Refusing to start without a signing secret."
          );
        }
        return {
          secret,
          // Kept at the current 30d default so this change doesn't log anyone
          // out — but now tunable, so shortening it (M3, ideally with a refresh
          // flow) is a one-env change rather than a redeploy.
          signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || "30d" },
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Plan.name, schema: PlanSchema },
    ]),
    forwardRef(() => PlanModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, JwtStrategy, SubscriptionGuard],
  exports: [AuthService, AuthGuard, JwtModule, SubscriptionGuard],
})
export class AuthModule {}
