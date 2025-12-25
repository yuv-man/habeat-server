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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    MongooseModule.forRoot(
      process.env.NODE_ENV === "development"
        ? process.env.MONGO_URL_LOCAL || ""
        : process.env.MONGO_URL_PROD || "",
      {
        dbName: "habeat",
        authSource: "admin",
        // Connection pool optimization
        maxPoolSize: 10,
        minPoolSize: 2,
        // Timeouts
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        // Retry configuration
        retryWrites: true,
        retryReads: true,
      }
    ),
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
