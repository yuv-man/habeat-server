import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import * as dotenv from "dotenv";
import * as express from "express";

dotenv.config();

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

  await app.listen(5000);
  console.log("Server started at http://localhost:5000");
  console.log(
    "Swagger documentation available at http://localhost:5000/api/docs"
  );
}

bootstrap();
