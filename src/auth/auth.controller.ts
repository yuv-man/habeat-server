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

  @Get("google/signup")
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

  @Get("google/signin")
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

  @Post("google/signin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Complete Google OAuth signin",
    description:
      "Completes the Google OAuth signin flow by looking up the user and returning their data. Called by frontend after receiving token and userId from OAuth callback redirect.",
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
        provider: { type: "string", example: "google" },
        userId: { type: "string", example: "user_id_here" },
        accessToken: { type: "string", example: "jwt_token_here" },
      },
      required: ["userId", "accessToken"],
    },
  })
  async completeGoogleSignin(
    @Body()
    body: {
      provider: string;
      userId: string;
      accessToken: string;
    },
    @Request() req: any,
    @Res() res: Response
  ) {
    const { userId, accessToken } = body;

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

    if (!userId) {
      throw new BadRequestException("userId is required");
    }
    if (!accessToken) {
      throw new BadRequestException("accessToken is required");
    }

    const data = await this.authService.getUser(userId);

    res.json({
      status: "success",
      data: {
        user: data.data.user,
        plan: data.data.plan,
        token: accessToken,
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
