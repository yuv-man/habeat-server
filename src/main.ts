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

// Set up MongoDB connection event handlers BEFORE creating the app
// This ensures we catch connection events from the start
const mongooseConnection = mongoose.connection;
mongooseConnection.on("connected", () => {
  console.log("MongoDB connected successfully");
  logger.info("MongoDB connected successfully");
});
mongooseConnection.on("error", (err) => {
  console.log("MongoDB connection error:", err);
  logger.error(`MongoDB connection error: ${err.message}`, err);
});
mongooseConnection.on("disconnected", () => {
  console.log("MongoDB disconnected");
  logger.warn("MongoDB disconnected");
});
mongooseConnection.on("connecting", () => {
  console.log("MongoDB connecting...");
  logger.info("MongoDB connecting...");
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    rawBody: false,
  });

  // Increase body size limit to handle image uploads (compression will reduce size)
  // Note: NestJS uses express under the hood, so we can access express app
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: "10mb" }));
  expressApp.use(express.urlencoded({ limit: "10mb", extended: true }));

  // Enable CORS
  // Always allow localhost for local development/testing
  // Also allow both DEV and PROD client sites regardless of environment
  const allowedOrigins = [
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:3000",
    "http://localhost:3001",
  ];

  // Add DEV_CLIENT_SITE if set
  if (process.env.DEV_CLIENT_SITE) {
    allowedOrigins.push(process.env.DEV_CLIENT_SITE);
  }

  // Add PROD_CLIENT_SITE if set
  if (process.env.PROD_CLIENT_SITE) {
    allowedOrigins.push(process.env.PROD_CLIENT_SITE);
  }

  // Use function-based origin to properly handle preflight requests
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // For development, also allow any localhost origin
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("https://localhost:")
      ) {
        return callback(null, true);
      }

      // Reject other origins
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
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    })
  );

  // Global prefix for all routes
  app.setGlobalPrefix("api");

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle("Habeat API")
    .setDescription("Habeat Server API Documentation")
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        name: "JWT",
        description: "Enter JWT token",
        in: "header",
      },
      "JWT-auth"
    )
    .addTag("auth", "Authentication endpoints")
    .addTag("users", "User management endpoints")
    .addTag("generate", "Meal plan generation endpoints")
    .addTag("plan", "Meal plan management endpoints")
    .addTag("progress", "Progress tracking endpoints")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.init();

  // Force MongoDB connection during startup
  // In serverless (Vercel), use shorter timeout to avoid hitting execution limits
  const isServerless =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  const connectionTimeout = isServerless ? 10000 : 30000; // 10s for serverless, 30s for regular

  console.log("Establishing MongoDB connection...");
  logger.info("Establishing MongoDB connection...");

  try {
    // Get the Mongoose connection from NestJS
    const connection = app.get(getConnectionToken());

    // Wait for connection to be established
    const waitForConnection = async (maxWaitTime = connectionTimeout) => {
      const startTime = Date.now();
      const CONNECTED = 1;

      while ((connection.readyState as number) !== CONNECTED) {
        if (Date.now() - startTime > maxWaitTime) {
          const states = [
            "disconnected",
            "connected",
            "connecting",
            "disconnecting",
          ];
          throw new Error(
            `MongoDB connection timeout after ${maxWaitTime}ms. State: ${states[connection.readyState]} (${connection.readyState})`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    // Check current state
    const currentState = connection.readyState;
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    console.log(
      `MongoDB connection state: ${states[currentState]} (${currentState})`
    );
    logger.info(
      `MongoDB connection state: ${states[currentState]} (${currentState})`
    );

    if (currentState === 1) {
      // Already connected
      console.log("MongoDB already connected");
      logger.info("MongoDB already connected");
    } else {
      // Trigger connection by using asPromise() if available, or by accessing db
      if ((connection as any).asPromise) {
        // Mongoose 6.4+ has asPromise()
        await Promise.race([
          (connection as any).asPromise(),
          waitForConnection(),
        ]);
      } else {
        // Fallback: trigger connection by accessing db and then wait
        try {
          // Access db to trigger connection
          if (connection.db) {
            await connection.db.admin().ping();
          }
        } catch (e) {
          // Ping might fail, but connection will be triggered
        }
        await waitForConnection();
      }

      // Verify connection
      if (connection.readyState === 1) {
        console.log("MongoDB connected successfully during startup");
        logger.info("MongoDB connected successfully during startup");
      } else {
        throw new Error(
          `Connection established but state is ${connection.readyState}`
        );
      }
    }
  } catch (error) {
    console.error(
      "Failed to establish MongoDB connection during startup:",
      error
    );
    logger.error(
      `Failed to establish MongoDB connection during startup: ${error.message}`,
      error
    );

    // In serverless, don't fail the bootstrap - connection will happen on first request
    // In regular server, we might want to fail, but for now we'll let it continue
    if (isServerless) {
      console.warn(
        "Serverless environment: App will start, MongoDB connection will be attempted on first database operation"
      );
      logger.warn(
        "Serverless environment: App will start, MongoDB connection will be attempted on first database operation"
      );
    } else {
      console.warn(
        "App will start, but MongoDB connection will be attempted on first database operation"
      );
      logger.warn(
        "App will start, but MongoDB connection will be attempted on first database operation"
      );
    }
  }

  // Only listen on port if not in serverless environment
  if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
    await app.listen(process.env.PORT || 5000);
    console.log(
      `Server started at http://localhost:${process.env.PORT || 5000}`
    );
    console.log(
      `Swagger documentation available at http://localhost:${process.env.PORT || 5000}/api/docs`
    );
  }

  return app;
}

// For regular server deployments
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("Error starting server:", err);
    process.exit(1);
  });
}

// Export app instance for serverless deployments (Vercel)
// Cache the app instance to avoid re-initializing on each request
let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  if (!cachedApp) {
    cachedApp = await bootstrap();
  }
  return cachedApp.getHttpAdapter().getInstance()(req, res);
}

// Also export bootstrap for direct use
export { bootstrap };
