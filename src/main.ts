import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import * as dotenv from "dotenv";
import * as express from "express";
import mongoose from "mongoose";
import { getConnectionToken } from "@nestjs/mongoose";
import logger from "./utils/logger";

dotenv.config();

// MongoDB Event Handlers
const mongooseConnection = mongoose.connection;
mongooseConnection.on("connected", () => {
  console.log("MongoDB connected successfully");
  logger.info("MongoDB connected successfully");
});
mongooseConnection.on("error", (err) => {
  console.log("MongoDB connection error:", err);
  logger.error(`MongoDB connection error: ${err.message}`, err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    rawBody: false,
  });

  // Body Parser Settings
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: "10mb" }));
  expressApp.use(express.urlencoded({ limit: "10mb", extended: true }));

  // CORS Configuration
  const allowedOrigins = [
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:3000",
    "http://localhost:3001",
  ];
  if (process.env.DEV_CLIENT_SITE)
    allowedOrigins.push(process.env.DEV_CLIENT_SITE);
  if (process.env.PROD_CLIENT_SITE)
    allowedOrigins.push(process.env.PROD_CLIENT_SITE);

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost:")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
    ],
    exposedHeaders: ["Authorization"],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle("Habeat API")
    .setDescription("Habeat Server API Documentation")
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "JWT-auth"
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.init();

  // MongoDB Connection Logic for Serverless
  const isServerless = !!(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  );
  try {
    const connection = app.get(getConnectionToken());
    if (connection.readyState !== 1) {
      console.log("Triggering MongoDB connection...");
      // Forcing connection in serverless context
      if (connection.db) {
        await connection.db.admin().ping();
      }
    }
  } catch (error) {
    console.error("MongoDB init warning:", error.message);
  }

  return app;
}

// CACHING FOR VERCEL
let cachedExpressApp: any;

export default async (req: any, res: any) => {
  if (!cachedExpressApp) {
    const app = await bootstrap();
    // Use the underlying Express instance
    cachedExpressApp = app.getHttpAdapter().getInstance();
  }
  return cachedExpressApp(req, res);
};

// LOCAL EXECUTION
if (!process.env.VERCEL && require.main === module) {
  bootstrap().then(async (app) => {
    const port = process.env.PORT || 5000;
    await app.listen(port);
    console.log(`Server running at http://localhost:${port}/api`);
  });
}

export { bootstrap };
