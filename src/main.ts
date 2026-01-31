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

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: "10mb" }));
  expressApp.use(express.urlencoded({ limit: "10mb", extended: true }));

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
      // Always allow requests with no origin (mobile apps, Postman, curl, etc.)
      if (!origin) {
        logger.info("CORS: Allowing request with no origin (mobile app)");
        return callback(null, true);
      }

      // Allow Capacitor/Ionic mobile app origins
      if (
        origin.startsWith("capacitor://") ||
        origin.startsWith("ionic://") ||
        origin.startsWith("file://") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("https://localhost")
      ) {
        logger.info(`CORS: Allowing mobile/localhost origin: ${origin}`);
        return callback(null, true);
      }

      // Allow configured origins
      if (allowedOrigins.includes(origin)) {
        logger.info(`CORS: Allowing configured origin: ${origin}`);
        return callback(null, true);
      }

      // In production, be more permissive for mobile apps
      // Some Android apps might send unexpected origins
      if (process.env.NODE_ENV === "production") {
        logger.warn(
          `CORS: Allowing origin in production (mobile app): ${origin}`,
        );
        return callback(null, true);
      }

      logger.warn(`CORS: Blocking origin: ${origin}`);
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
      "Origin",
    ],
    exposedHeaders: ["Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");

  // Only setup Swagger in non-production or local environments
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Habeat API")
      .setDescription("Habeat Server API Documentation")
      .setVersion("1.0")
      .addBearerAuth(
        { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        "JWT-auth",
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.init();

  try {
    const connection = app.get(getConnectionToken());
    if (connection.readyState !== 1) {
      console.log("Triggering MongoDB connection...");
      if (connection.db) {
        await connection.db.admin().ping();
      }
    }
  } catch (error) {
    console.error("MongoDB init warning:", error.message);
  }

  return app;
}

let cachedApp: any;

export default async (req: any, res: any) => {
  try {
    if (!cachedApp) {
      const nestApp = await bootstrap();
      cachedApp = nestApp.getHttpAdapter().getInstance();
    }
    return cachedApp(req, res);
  } catch (error) {
    console.error("Error handling request:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

if (require.main === module) {
  bootstrap().then(async (app) => {
    const port = process.env.PORT || 5080;
    await app.listen(port);
    console.log(`Server running at http://localhost:${port}/api`);
  });
}

export { bootstrap };
