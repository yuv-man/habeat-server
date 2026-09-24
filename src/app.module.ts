import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { UserThrottlerGuard } from "./auth/guards/user-throttler.guard";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { GeneratorModule } from "./generator/generator.module";
import { PlanModule } from "./plan/plan.module";
import { ProgressModule } from "./progress/progress.module";
import { GoalModule } from "./goals/goal.module";
import { MealModule } from "./meal/meal.module";
import { RecipeModule } from "./recipe/recipe.module";
import { ShoppingModule } from "./shopping/shopping.module";
import { ChatModule } from "./chat/chat.module";
import { EngagementModule } from "./engagement/engagement.module";
import { ChallengeModule } from "./challenge/challenge.module";
import { ReflectionModule } from "./reflection/reflection.module";
import { NotificationModule } from "./notification/notification.module";
import { PhotoRecognitionModule } from "./photo-recognition/photo-recognition.module";
import { SubscriptionModule } from "./subscription/subscription.module";
import { CBTModule } from "./cbt/cbt.module";
import { SocialModule } from "./social/social.module";
import { BehaviorModule } from "./behavior/behavior.module";
import { BrainModule } from "./brain/brain.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { FoodTermsModule } from "./food-terms/food-terms.module";
import { AiAgentModule } from "./ai-agent/ai-agent.module";
import { RepertoireModule } from "./repertoire/repertoire.module";
import { LlmUsageModule } from "./llm-usage/llm-usage.module";
import logger from "./utils/logger";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 20,
    }]),
    MongooseModule.forRootAsync({
      useFactory: () => {
        const mongoUrl =
          process.env.MONGO_URL_PROD ||
          process.env.MONGO_URL ||
          process.env.MONGODB_URI ||
          "";

        if (!mongoUrl) {
          logger.error(
            "MongoDB connection string not found. Please set MONGO_URL_PROD, MONGO_URL, or MONGODB_URI environment variable.",
          );
          throw new Error("MongoDB connection string is required");
        }

        // Log connection attempt (without credentials)
        const safeUrl = mongoUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");
        logger.info(`Connecting to MongoDB: ${safeUrl}`);

        const connectionOptions: any = {
          uri: mongoUrl,
          dbName: "habeat",
          authSource: "admin",
          // Retry configuration
          retryWrites: true,
          retryReads: true,
          // Better error handling
          directConnection: false, // Use SRV records for Atlas
        };

        // Regular server settings
        connectionOptions.maxPoolSize = 10;
        connectionOptions.minPoolSize = 2;
        connectionOptions.serverSelectionTimeoutMS = 10000;
        connectionOptions.socketTimeoutMS = 45000;
        connectionOptions.connectTimeoutMS = 10000;
        logger.info("Using standard MongoDB connection settings");

        return connectionOptions;
      },
      inject: [ConfigService],
    }),
    AuthModule,
    UserModule,
    GeneratorModule,
    PlanModule,
    ProgressModule,
    GoalModule,
    MealModule,
    RecipeModule,
    ShoppingModule,
    ChatModule,
    EngagementModule,
    ChallengeModule,
    ReflectionModule,
    NotificationModule,
    PhotoRecognitionModule,
    SubscriptionModule,
    CBTModule,
    SocialModule,
    BehaviorModule,
    // The Brain is the decision-maker; BehaviorModule above is one of its
    // organs, not a peer. Only the Brain is on the meal-planning path.
    BrainModule,
    AnalyticsModule,
    FoodTermsModule,
    AiAgentModule,
    RepertoireModule,
    LlmUsageModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
