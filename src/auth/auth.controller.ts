import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
  Res,
  Redirect,
  NotFoundException,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { SignupDto } from "./dto/signup.dto";
import { IUserData } from "../types/interfaces";
import logger from "../utils/logger";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("signup")
  @ApiOperation({ summary: "Register a new user" })
  @ApiResponse({ status: 201, description: "User successfully registered" })
  @ApiResponse({ status: 400, description: "User already exists" })
  async registerUser(@Body() data: SignupDto) {
    // If provider is specified, use OAuth signup
    if (data.provider === "google" && data.idToken) {
      return this.authService.googleSignup(data.idToken, data.userData as any);
    } else if (data.provider === "facebook" && data.idToken) {
      return this.authService.facebookSignup(
        data.idToken,
        data.userData as any
      );
    } else {
      // Regular signup
      const email = data.email || data.userData.email;
      if (!email) {
        throw new BadRequestException("Email is required");
      }
      return this.authService.register({
        email: email,
        password: data.password || data.userData.password || "",
        userData: {
          ...data.userData,
          email,
          preferences: data.userData.preferences || {},
        } as any,
      });
    }
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login user" })
  @ApiResponse({ status: 200, description: "User successfully logged in" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        email: { type: "string", example: "user@example.com" },
        password: { type: "string", example: "password123" },
      },
    },
  })
  async loginUser(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Logout user" })
  @ApiResponse({ status: 200, description: "User successfully logged out" })
  async logoutUser() {
    return this.authService.logout();
  }

  @Get("users/me")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get current user information" })
  @ApiResponse({
    status: 200,
    description: "User information retrieved successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getUser(@Request() req) {
    return this.authService.getUser(req.user._id.toString());
  }

  @Get("google/web/signup")
  @ApiOperation({
    summary: "Initiate Google OAuth signup",
    description:
      "Returns Google OAuth URL for signup. If called via AJAX (Accept: application/json), returns JSON. Otherwise redirects. Requires redirectUri (backend callback) and frontendRedirectUri (where to redirect after auth). Optional prompt parameter: 'select_account' to show account picker, 'consent' to force consent screen (default).",
  })
  @ApiResponse({
    status: 302,
    description: "Redirects to Google OAuth (when accessed via browser)",
  })
  @ApiResponse({
    status: 200,
    description: "Returns OAuth URL as JSON (when called via AJAX)",
    schema: {
      type: "object",
      properties: {
        authUrl: { type: "string" },
      },
    },
  })
  async initiateGoogleSignup(
    @Query("redirectUri") redirectUri: string,
    @Query("frontendRedirectUri") frontendRedirectUri: string,
    @Request() req: any,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("prompt") prompt?: string
  ) {
    if (!redirectUri) {
      throw new BadRequestException("redirectUri query parameter is required");
    }

    if (!frontendRedirectUri) {
      throw new BadRequestException(
        "frontendRedirectUri query parameter is required"
      );
    }

    // Normalize redirectUri to ensure it includes /api prefix
    const originalRedirectUri = redirectUri;
    try {
      const redirectUrl = new URL(redirectUri);
      if (!redirectUrl.pathname.includes("/api/auth/google/callback")) {
        redirectUrl.pathname = "/api/auth/google/callback";
        redirectUri = redirectUrl.toString();
        logger.info("Normalized redirectUri in initiateGoogleSignup", {
          original: originalRedirectUri,
          normalized: redirectUri,
        });
      }
    } catch (e) {
      const protocol = req.protocol || "https"; // Default to https for production
      const host = req.get("host") || "localhost:5000";
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
      logger.info(
        "Constructed redirectUri from request in initiateGoogleSignup",
        {
          original: originalRedirectUri,
          constructed: redirectUri,
          protocol,
          host,
        }
      );
    }

    // Set CORS headers
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
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Accept"
      );
    }

    const authUrl = await this.authService.getGoogleSigninUrl(
      redirectUri,
      frontendRedirectUri,
      prompt,
      "signup" // This is the signup endpoint
    );

    // Check if this is an AJAX request
    const acceptHeader = req.headers.accept || "";
    const isJsonRequest =
      format === "json" ||
      acceptHeader.includes("application/json") ||
      req.headers["x-requested-with"] === "XMLHttpRequest";

    if (isJsonRequest) {
      res.json({ authUrl });
    } else {
      res.redirect(authUrl);
    }
  }

  @Get("google/web/signin")
  @ApiOperation({
    summary: "Initiate Google OAuth signin",
    description:
      "Returns Google OAuth URL. If called via AJAX (Accept: application/json), returns JSON. Otherwise redirects. Requires redirectUri (backend callback) and frontendRedirectUri (where to redirect after auth). Optional prompt parameter: 'select_account' to show account picker, 'consent' to force consent screen (default).",
  })
  @ApiResponse({
    status: 302,
    description: "Redirects to Google OAuth (when accessed via browser)",
  })
  @ApiResponse({
    status: 200,
    description: "Returns OAuth URL as JSON (when called via AJAX)",
    schema: {
      type: "object",
      properties: {
        authUrl: { type: "string" },
      },
    },
  })
  async initiateGoogleSignin(
    @Query("redirectUri") redirectUri: string,
    @Query("frontendRedirectUri") frontendRedirectUri: string,
    @Request() req: any,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("prompt") prompt?: string
  ) {
    if (!redirectUri) {
      throw new BadRequestException("redirectUri query parameter is required");
    }

    if (!frontendRedirectUri) {
      throw new BadRequestException(
        "frontendRedirectUri query parameter is required"
      );
    }

    // Normalize redirectUri to ensure it includes /api prefix
    // This prevents issues where frontend passes redirectUri without /api
    const originalRedirectUri = redirectUri;
    try {
      const redirectUrl = new URL(redirectUri);
      if (!redirectUrl.pathname.includes("/api/auth/google/callback")) {
        // Replace the pathname to ensure it includes /api
        redirectUrl.pathname = "/api/auth/google/callback";
        redirectUri = redirectUrl.toString();
        logger.info("Normalized redirectUri in initiateGoogleSignin", {
          original: originalRedirectUri,
          normalized: redirectUri,
        });
      }
    } catch (e) {
      // If redirectUri is not a valid URL, construct it from the request
      const protocol = req.protocol || "https"; // Default to https for production
      const host = req.get("host") || "localhost:5000";
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
      logger.info(
        "Constructed redirectUri from request in initiateGoogleSignin",
        {
          original: originalRedirectUri,
          constructed: redirectUri,
          protocol,
          host,
        }
      );
    }

    // Set CORS headers
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
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Accept"
      );
    }

    const authUrl = await this.authService.getGoogleSigninUrl(
      redirectUri,
      frontendRedirectUri,
      prompt,
      "signin" // This is the signin endpoint
    );

    // Check if this is an AJAX request (via Accept header or format query param)
    const acceptHeader = req.headers.accept || "";
    const isJsonRequest =
      format === "json" ||
      acceptHeader.includes("application/json") ||
      req.headers["x-requested-with"] === "XMLHttpRequest";

    if (isJsonRequest) {
      // Return JSON for AJAX requests so frontend can handle navigation
      res.json({ authUrl });
    } else {
      // Redirect for direct browser navigation
      res.redirect(authUrl);
    }
  }

  @Get("google/mobile/signup")
  @ApiOperation({
    summary: "Initiate Google OAuth signup for mobile apps",
    description:
      "Returns Google OAuth URL for mobile signup. Requires redirectUri (backend callback) and frontendRedirectUri (where to redirect after auth). Optional prompt parameter.",
  })
  @ApiResponse({
    status: 302,
    description: "Redirects to Google OAuth (when accessed via browser)",
  })
  @ApiResponse({
    status: 200,
    description: "Returns OAuth URL as JSON (when called via AJAX)",
    schema: {
      type: "object",
      properties: {
        authUrl: { type: "string" },
      },
    },
  })
  async initiateGoogleMobileSignup(
    @Query("redirectUri") redirectUri: string,
    @Query("frontendRedirectUri") frontendRedirectUri: string,
    @Request() req: any,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("prompt") prompt?: string
  ) {
    if (!redirectUri) {
      throw new BadRequestException("redirectUri query parameter is required");
    }

    if (!frontendRedirectUri) {
      throw new BadRequestException(
        "frontendRedirectUri query parameter is required"
      );
    }

    // Normalize redirectUri to ensure it includes /api prefix
    const originalRedirectUri = redirectUri;
    try {
      const redirectUrl = new URL(redirectUri);
      if (!redirectUrl.pathname.includes("/api/auth/google/callback")) {
        redirectUrl.pathname = "/api/auth/google/callback";
        redirectUri = redirectUrl.toString();
        logger.info("Normalized redirectUri in initiateGoogleMobileSignup", {
          original: originalRedirectUri,
          normalized: redirectUri,
        });
      }
    } catch (e) {
      const protocol = req.protocol || "https";
      const host = req.get("host") || "localhost:5000";
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
      logger.info(
        "Constructed redirectUri from request in initiateGoogleMobileSignup",
        {
          original: originalRedirectUri,
          constructed: redirectUri,
          protocol,
          host,
        }
      );
    }

    const authUrl = await this.authService.getGoogleSigninUrl(
      redirectUri,
      frontendRedirectUri,
      prompt,
      "signup" // This is the signup endpoint
    );

    // Check if this is an AJAX request
    const acceptHeader = req.headers.accept || "";
    const isJsonRequest =
      format === "json" ||
      acceptHeader.includes("application/json") ||
      req.headers["x-requested-with"] === "XMLHttpRequest";

    if (isJsonRequest) {
      res.json({ authUrl });
    } else {
      res.redirect(authUrl);
    }
  }

  @Post("google/mobile/signup")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Google OAuth signup for mobile apps",
    description:
      "Mobile endpoint for Google OAuth signup. Accepts Google ID token directly from mobile SDK (iOS/Android). Returns user data and JWT token.",
  })
  @ApiResponse({
    status: 200,
    description: "User successfully signed up",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request or user already exists",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        idToken: {
          type: "string",
          description: "Google ID token from mobile SDK",
          example: "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...",
        },
        userData: {
          type: "object",
          description: "Optional user data to pre-fill profile",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
            gender: { type: "string", enum: ["male", "female", "other"] },
            height: { type: "number" },
            weight: { type: "number" },
            path: {
              type: "string",
              enum: [
                "keto",
                "healthy",
                "gain-muscle",
                "running",
                "lose-weight",
                "fasting",
              ],
            },
          },
        },
      },
      required: ["idToken"],
    },
  })
  async googleMobileSignup(
    @Body()
    body: {
      idToken: string;
      userData?: Partial<IUserData>;
    }
  ) {
    if (!body.idToken) {
      throw new BadRequestException("Google ID token is required");
    }
    return this.authService.googleSignup(body.idToken, body.userData);
  }

  @Get("google/mobile/signin")
  @ApiOperation({
    summary: "Initiate Google OAuth signin for mobile apps",
    description:
      "Returns Google OAuth URL for mobile signin. Requires redirectUri (backend callback) and frontendRedirectUri (where to redirect after auth). Optional prompt parameter.",
  })
  @ApiResponse({
    status: 302,
    description: "Redirects to Google OAuth (when accessed via browser)",
  })
  @ApiResponse({
    status: 200,
    description: "Returns OAuth URL as JSON (when called via AJAX)",
    schema: {
      type: "object",
      properties: {
        authUrl: { type: "string" },
      },
    },
  })
  async initiateGoogleMobileSignin(
    @Query("redirectUri") redirectUri: string,
    @Query("frontendRedirectUri") frontendRedirectUri: string,
    @Request() req: any,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("prompt") prompt?: string
  ) {
    if (!redirectUri) {
      throw new BadRequestException("redirectUri query parameter is required");
    }

    if (!frontendRedirectUri) {
      throw new BadRequestException(
        "frontendRedirectUri query parameter is required"
      );
    }

    // Normalize redirectUri to ensure it includes /api prefix
    const originalRedirectUri = redirectUri;
    try {
      const redirectUrl = new URL(redirectUri);
      if (!redirectUrl.pathname.includes("/api/auth/google/callback")) {
        redirectUrl.pathname = "/api/auth/google/callback";
        redirectUri = redirectUrl.toString();
        logger.info("Normalized redirectUri in initiateGoogleMobileSignin", {
          original: originalRedirectUri,
          normalized: redirectUri,
        });
      }
    } catch (e) {
      const protocol = req.protocol || "https";
      const host = req.get("host") || "localhost:5000";
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
      logger.info(
        "Constructed redirectUri from request in initiateGoogleMobileSignin",
        {
          original: originalRedirectUri,
          constructed: redirectUri,
          protocol,
          host,
        }
      );
    }

    const authUrl = await this.authService.getGoogleSigninUrl(
      redirectUri,
      frontendRedirectUri,
      prompt,
      "signin" // This is the signin endpoint
    );

    // Check if this is an AJAX request
    const acceptHeader = req.headers.accept || "";
    const isJsonRequest =
      format === "json" ||
      acceptHeader.includes("application/json") ||
      req.headers["x-requested-with"] === "XMLHttpRequest";

    if (isJsonRequest) {
      res.json({ authUrl });
    } else {
      res.redirect(authUrl);
    }
  }

  @Post("google/mobile/signin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Google OAuth signin for mobile apps",
    description:
      "Mobile endpoint for Google OAuth signin. Accepts Google ID token directly from mobile SDK (iOS/Android). Returns user data and JWT token.",
  })
  @ApiResponse({
    status: 200,
    description: "User successfully signed in",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid token or user not found",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        idToken: {
          type: "string",
          description: "Google ID token from mobile SDK",
          example: "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...",
        },
      },
      required: ["idToken"],
    },
  })
  async googleMobileSignin(@Body() body: { idToken: string }) {
    if (!body.idToken) {
      throw new BadRequestException("Google ID token is required");
    }
    const result = await this.authService.googleSignin(body.idToken);

    // Fetch user plan for consistency with other endpoints
    const userData = await this.authService.getUser(result.user._id.toString());

    return {
      status: "success",
      data: {
        user: result.user,
        plan: userData.data.plan,
        token: result.token,
      },
    };
  }

  @Post("google/web/signup")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Google OAuth signup for web apps",
    description:
      "Web endpoint for Google OAuth signup. Accepts Google ID token directly from Google Identity Services. Returns user data and JWT token.",
  })
  @ApiResponse({
    status: 200,
    description: "User successfully signed up",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request or user already exists",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        accessToken: {
          type: "string",
          description: "Google ID token from Google Identity Services",
          example: "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...",
        },
        userData: {
          type: "object",
          description: "Optional user data to pre-fill profile",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
            gender: { type: "string", enum: ["male", "female", "other"] },
            height: { type: "number" },
            weight: { type: "number" },
            path: {
              type: "string",
              enum: [
                "keto",
                "healthy",
                "gain-muscle",
                "running",
                "lose-weight",
                "fasting",
              ],
            },
          },
        },
      },
      required: ["accessToken", "userData"],
    },
  })
  async googleWebSignup(
    @Body()
    body: {
      accessToken: string;
      userData?: Partial<IUserData>;
    }
  ) {
    if (!body.accessToken) {
      throw new BadRequestException("Google ID token is required");
    }
    return this.authService.googleSignup(body.accessToken, body.userData);
  }

  @Post("google/web/signin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Google OAuth signin for web apps",
    description:
      "Web endpoint for Google OAuth signin. Accepts Google ID token directly from Google Identity Services OR userId/accessToken from redirect flow. Returns user data and JWT token.",
  })
  @ApiResponse({
    status: 200,
    description: "Returns user data and token",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "success" },
        data: {
          type: "object",
          properties: {
            user: { type: "object" },
            plan: { type: "object" },
            token: { type: "string" },
          },
        },
      },
    },
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID (required for redirect flow completion)",
        },
        accessToken: {
          type: "string",
          description:
            "Google ID token (for direct auth) or JWT token (for redirect flow)",
          example: "jwt_token_here",
        },
      },
      required: ["accessToken"],
    },
  })
  async googleWebSignin(
    @Body()
    body: {
      userId?: string;
      accessToken: string;
    },
    @Request() req: any,
    @Res() res: Response
  ) {
    // Set CORS headers
    const allowedOrigins = [
      "http://localhost:8080",
      "http://localhost:8081",
      "http://localhost:3000",
      "http://localhost:3001",
    ];

    if (process.env.DEV_CLIENT_SITE) {
      allowedOrigins.push(process.env.DEV_CLIENT_SITE);
    }

    if (process.env.PROD_CLIENT_SITE) {
      allowedOrigins.push(process.env.PROD_CLIENT_SITE);
    }
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Accept"
      );
    }

    if (!body.accessToken) {
      throw new BadRequestException("accessToken is required");
    }

    // If userId is provided, this is a redirect flow completion
    if (body.userId) {
      const data = await this.authService.getUser(body.userId);
      res.json({
        status: "success",
        data: {
          user: data.data.user,
          plan: data.data.plan,
          token: body.accessToken,
        },
      });
      return;
    }

    // Otherwise, treat accessToken as Google ID token for direct authentication
    const result = await this.authService.googleSignin(body.accessToken);

    // Fetch user plan
    const userData = await this.authService.getUser(result.user._id.toString());

    res.json({
      status: "success",
      data: {
        user: result.user,
        plan: userData.data.plan,
        token: result.token,
      },
    });
  }

  @Get("google/callback")
  @ApiOperation({
    summary: "Google OAuth callback",
    description:
      "Handles Google OAuth callback, exchanges code for tokens, and redirects to frontend with JWT token. The frontendRedirectUri is passed via the state parameter.",
  })
  @ApiResponse({
    status: 302,
    description: "Redirects to frontend with token",
  })
  async googleCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("redirectUri") redirectUri: string,
    @Request() req: any,
    @Res() res: Response
  ) {
    // Set CORS headers before redirect
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
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Accept"
      );
    }

    if (!code) {
      throw new BadRequestException("Authorization code is required");
    }

    // Construct redirectUri from request if not provided (Google doesn't send it back)
    // This ensures it always includes the /api prefix
    if (!redirectUri) {
      const protocol = req.protocol || "https"; // Default to https for production
      const host = req.get("host") || "localhost:5000";
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
      logger.info("Constructed redirectUri from request", {
        redirectUri,
        protocol,
        host,
      });
    } else {
      // Ensure redirectUri includes /api prefix if it's missing
      if (!redirectUri.includes("/api/auth/google/callback")) {
        const url = new URL(redirectUri);
        redirectUri = `${url.protocol}//${url.host}/api/auth/google/callback`;
        logger.info("Normalized redirectUri to include /api prefix", {
          redirectUri,
        });
      }
    }

    logger.info("Google OAuth callback received", {
      hasCode: !!code,
      redirectUri,
      hasState: !!state,
      origin: req.headers.origin,
      host: req.get("host"),
    });

    try {
      const redirectUrl = await this.authService.handleGoogleCallback(
        code,
        redirectUri,
        state
      );
      res.redirect(redirectUrl);
    } catch (error: any) {
      // Log the full error for debugging
      logger.error("Google OAuth callback error:", {
        message: error?.message,
        stack: error?.stack,
        code,
        redirectUri,
        state,
        errorDetails: error,
      });
      console.error("Google OAuth callback error:", error);

      // Decode frontendRedirectUri from state for error redirect
      let frontendRedirectUri =
        process.env.FRONTEND_REDIRECT_URI || "http://localhost:3000";
      if (state) {
        try {
          const decodedState = Buffer.from(state, "base64").toString("utf-8");
          try {
            // Try to parse as JSON (new format)
            const stateData = JSON.parse(decodedState);
            frontendRedirectUri =
              stateData.frontendRedirectUri || frontendRedirectUri;
          } catch (jsonError) {
            // Fallback to old format (just string)
            frontendRedirectUri = decodedState;
          }
        } catch (e) {
          logger.warn("Failed to decode state for error redirect:", e);
          // Use default if decoding fails
        }
      }
      // Redirect to frontend with error
      const errorUrl = new URL(frontendRedirectUri);
      errorUrl.searchParams.set("error", "authentication_failed");
      errorUrl.searchParams.set(
        "error_description",
        error?.message || "OAuth authentication failed"
      );
      res.redirect(errorUrl.toString());
    }
  }

  @Post("facebook/signin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in user with Facebook OAuth" })
  @ApiResponse({
    status: 200,
    description: "User successfully signed in with Facebook",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        accessToken: { type: "string", example: "facebook_access_token_here" },
      },
    },
  })
  async facebookSignin(@Body() body: { accessToken: string }) {
    return this.authService.facebookSignin(body.accessToken);
  }
}
