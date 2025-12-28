import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { GeneratorModule } from "./generator/generator.module";
import { PlanModule } from "./plan/plan.module";
import { ProgressModule } from "./progress/progress.module";
import { GoalModule } from "./goals/goal.module";
import { MealModule } from "./meal/meal.module";
import { RecipeModule } from "./recipe/recipe.module";
import { ShoppingModule } from "./shopping/shopping.module";
import logger from "./utils/logger";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    MongooseModule.forRootAsync({
      useFactory: () => {
        const mongoUrl =
          process.env.MONGO_URL_PROD ||
          process.env.MONGO_URL ||
          process.env.MONGODB_URI ||
          "";

        if (!mongoUrl) {
          logger.error(
            "MongoDB connection string not found. Please set MONGO_URL_PROD, MONGO_URL, or MONGODB_URI environment variable."
          );
          throw new Error("MongoDB connection string is required");
        }

        // Log connection attempt (without credentials)
        const safeUrl = mongoUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");
        logger.info(`Connecting to MongoDB: ${safeUrl}`);

        return {
          uri: mongoUrl,
          dbName: "habeat",
          authSource: "admin",
          // Connection pool optimization
          maxPoolSize: 10,
          minPoolSize: 2,
          // Timeouts - increased for better reliability
          serverSelectionTimeoutMS: 10000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 10000,
          // Retry configuration
          retryWrites: true,
          retryReads: true,
          // Better error handling
          directConnection: false, // Use SRV records for Atlas
        };
      },
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
  ],
})
export class AppModule {}
