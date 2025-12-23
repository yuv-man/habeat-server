import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "../user/user.model";
import { Plan } from "../plan/plan.model";
import generateToken from "../utils/generateToken";
import logger from "../utils/logger";
import { IPlan, IUserData } from "../types/interfaces";
import {
  verifyGoogleToken,
  verifyFacebookToken,
  generateOAuthPassword,
  getGoogleAuthUrl,
  exchangeGoogleCodeForTokens,
} from "../utils/oauth";
import { JwtService } from "@nestjs/jwt";
import { PlanService } from "../plan/plan.service";

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(Plan.name) private planModel: Model<IPlan>,
    private jwtService: JwtService,
    private planService: PlanService
  ) {}

  // Helper function to normalize path values
  private normalizePath(
    path: string
  ): "healthy" | "lose" | "muscle" | "keto" | "fasting" | "custom" {
    const pathMap: {
      [key: string]:
        | "healthy"
        | "lose"
        | "muscle"
        | "keto"
        | "fasting"
        | "custom";
    } = {
      "gain-muscle": "muscle",
      gain_muscle: "muscle",
      "build-muscle": "muscle",
      build_muscle: "muscle",
    };
    const normalized = pathMap[path] || path;
    // Ensure the result is a valid path type
    const validPaths: (
      | "healthy"
      | "lose"
      | "muscle"
      | "keto"
      | "fasting"
      | "custom"
    )[] = ["healthy", "lose", "muscle", "keto", "fasting", "custom"];
    return validPaths.includes(normalized as any)
      ? (normalized as
          | "healthy"
          | "lose"
          | "muscle"
          | "keto"
          | "fasting"
          | "custom")
      : "healthy";
  }

  async register(data: {
    email: string;
    password: string;
    userData: IUserData;
  }) {
    const userExists = await this.userModel.findOne({ email: data.email });

    if (userExists) {
      throw new ConflictException("User already exists");
    }

    // Normalize path value
    const normalizedPath = this.normalizePath(data.userData.path);

    const user = await this.userModel.create({
      ...data.userData,
      email: data.email,
      password: data.password,
      path: normalizedPath,
      foodPreferences: data.userData.foodPreferences || [],
      favoriteMeals: [],
      preferences: data.userData.preferences || {},
    });

    const initialPlan = await this.planService.createInitialPlanFunction(
      user._id.toString(),
      { ...data.userData, path: normalizedPath },
      "en"
    );

    return {
      status: "success",
      data: {
        user: user,
        plan: initialPlan,
        token: generateToken((user as any)._id.toString()),
      },
    };
  }

  async login(email: string, password: string) {
    const user = await this.userModel.findOne({ email });

    if (
      user &&
      (user as any).comparePassword &&
      (await (user as any).comparePassword(password))
    ) {
      return {
        status: "success",
        data: {
          user: user,
          token: generateToken((user as any)._id.toString()),
        },
      };
    } else {
      throw new UnauthorizedException("Invalid email or password");
    }
  }

  async logout() {
    return {
      status: "success",
      message: "Logged out successfully",
    };
  }

  async googleSignup(idToken: string, userData?: Partial<IUserData>) {
    if (!idToken) {
      throw new BadRequestException("Google ID token is required");
    }

    const googleUser = await verifyGoogleToken(idToken);

    if (!googleUser) {
      throw new UnauthorizedException("Invalid Google token");
    }

    // Use email from userData if provided, otherwise use email from Google token
    const email = userData?.email || googleUser.email;

    // Verify that if userData.email is provided, it matches the Google token email
    if (userData?.email && userData.email !== googleUser.email) {
      throw new BadRequestException(
        "Email in userData does not match Google account email"
      );
    }

    const existingUser = await this.userModel.findOne({
      email: email,
    });

    if (existingUser) {
      throw new ConflictException(
        "User already exists. Please use sign in instead."
      );
    }

    // Normalize path value
    const normalizedPath = userData?.path
      ? this.normalizePath(userData.path)
      : "healthy";

    const user = await this.userModel.create({
      email: email,
      name:
        userData?.name ||
        `${googleUser.given_name || ""} ${googleUser.family_name || ""}`.trim() ||
        "User",
      password: generateOAuthPassword("google"),
      age: userData?.age || 25,
      gender: userData?.gender || "male",
      height: userData?.height || 170,
      weight: userData?.weight || 70,
      path: normalizedPath,
      targetWeight: userData?.targetWeight,
      allergies: userData?.allergies || [],
      dietaryRestrictions: userData?.dietaryRestrictions || [],
      foodPreferences: userData?.foodPreferences || [],
      dislikes: userData?.dislikes || [],
      fastingHours: userData?.fastingHours,
      fastingStartTime: userData?.fastingStartTime,
      workoutFrequency: userData?.workoutFrequency,
      bmr: userData?.bmr,
      tdee: userData?.tdee,
      idealWeight: userData?.idealWeight,
      isPremium: userData?.isPremium || false,
      picture: googleUser.picture,
      oauthProvider: "google",
      oauthId: googleUser.sub,
      preferences: userData?.preferences || {},
    });

    const userDataForPlan: IUserData = {
      email: (user as any).email,
      password: (user as any).password,
      name: (user as any).name,
      age: (user as any).age,
      gender: (user as any).gender,
      height: (user as any).height,
      weight: (user as any).weight,

      path: (user as any).path,
      targetWeight: (user as any).targetWeight,
      allergies: (user as any).allergies,
      dietaryRestrictions: (user as any).dietaryRestrictions,
      foodPreferences: (user as any).foodPreferences || [],
      dislikes: (user as any).dislikes,
      preferences: {},
    };

    const initialPlan = await this.planService.createInitialPlanFunction(
      (user as any)._id.toString(),
      userDataForPlan,
      "en"
    );

    return {
      status: "success",
      data: {
        user: user,
        plan: initialPlan,
        token: generateToken(user._id.toString()),
      },
    };
  }

  async getGoogleSigninUrl(
    redirectUri: string,
    frontendRedirectUri: string,
    prompt?: string
  ): Promise<string> {
    // Encode frontendRedirectUri in state parameter to pass through OAuth flow
    const state = Buffer.from(frontendRedirectUri).toString("base64");
    const authUrl = getGoogleAuthUrl(redirectUri, state, prompt);
    if (!authUrl) {
      throw new BadRequestException(
        "Failed to generate Google OAuth URL. Check server configuration."
      );
    }
    return authUrl;
  }

  async handleGoogleCallback(
    code: string,
    redirectUri: string,
    state?: string
  ): Promise<string> {
    // Decode frontendRedirectUri from state parameter
    let frontendRedirectUri =
      process.env.FRONTEND_REDIRECT_URI || "http://localhost:3000";
    if (state) {
      try {
        frontendRedirectUri = Buffer.from(state, "base64").toString("utf-8");
      } catch (error) {
        logger.warn(
          "Failed to decode state parameter, using default redirect URI"
        );
      }
    }
    // Exchange authorization code for tokens
    const tokens = await exchangeGoogleCodeForTokens(code, redirectUri);

    if (!tokens || !tokens.idToken) {
      throw new UnauthorizedException(
        "Failed to exchange authorization code for tokens"
      );
    }

    // Verify the ID token
    const googleUser = await verifyGoogleToken(tokens.idToken);

    if (!googleUser) {
      throw new UnauthorizedException("Invalid Google token");
    }

    // Find or create user
    let user = await this.userModel.findOne({ email: googleUser.email });

    if (!user) {
      // Auto-signup: create user if they don't exist
      const normalizedPath = "healthy"; // Default path
      user = await this.userModel.create({
        email: googleUser.email,
        name:
          googleUser.name ||
          `${googleUser.given_name || ""} ${googleUser.family_name || ""}`.trim() ||
          "User",
        password: generateOAuthPassword("google"),
        age: 25,
        gender: "male",
        height: 170,
        weight: 70,
        path: normalizedPath,
        picture: googleUser.picture,
        oauthProvider: "google",
        oauthId: googleUser.sub,
        preferences: {},
      });

      // Create initial plan for new user
      const userDataForPlan: IUserData = {
        email: (user as any).email,
        password: (user as any).password,
        name: (user as any).name,
        age: (user as any).age,
        gender: (user as any).gender,
        height: (user as any).height,
        weight: (user as any).weight,
        path: (user as any).path,
        allergies: [],
        dietaryRestrictions: [],
        foodPreferences: [],
        dislikes: [],
        preferences: {},
      };

      await this.planService.createInitialPlanFunction(
        (user as any)._id.toString(),
        userDataForPlan,
        "en"
      );
    } else {
      // Update existing user
      (user as any).oauthProvider = "google";
      (user as any).oauthId = googleUser.sub;
      if (googleUser.picture && !(user as any).picture) {
        (user as any).picture = googleUser.picture;
      }
      await user.save();
    }

    // Generate JWT token
    const jwtToken = generateToken(user._id.toString());

    // Redirect to frontend with token
    const redirectUrl = new URL(frontendRedirectUri);
    redirectUrl.searchParams.set("token", jwtToken);
    redirectUrl.searchParams.set("userId", user._id.toString());

    return redirectUrl.toString();
  }

  async googleSignin(idToken: string) {
    if (!idToken) {
      throw new BadRequestException("Google ID token is required");
    }

    const googleUser = await verifyGoogleToken(idToken);

    if (!googleUser) {
      throw new UnauthorizedException("Invalid Google token");
    }

    const user = await this.userModel.findOne({ email: googleUser.email });

    if (!user) {
      throw new UnauthorizedException("User not found. Please sign up first.");
    }

    (user as any).oauthProvider = "google";
    (user as any).oauthId = googleUser.sub;
    if (googleUser.picture && !(user as any).picture) {
      (user as any).picture = googleUser.picture;
    }
    await user.save();

    return {
      token: generateToken(user._id.toString()),
      user: user,
    };
  }

  async facebookSignup(accessToken: string, userData?: Partial<IUserData>) {
    if (!accessToken) {
      throw new BadRequestException("Facebook access token is required");
    }

    const facebookUser = await verifyFacebookToken(accessToken);

    if (!facebookUser) {
      throw new UnauthorizedException("Invalid Facebook token");
    }

    const existingUser = await this.userModel.findOne({
      email: facebookUser.email,
    });

    if (existingUser) {
      throw new ConflictException(
        "User already exists. Please use sign in instead."
      );
    }

    // Normalize path value
    const normalizedPath = userData?.path
      ? this.normalizePath(userData.path)
      : "healthy";

    const user = await this.userModel.create({
      email: userData?.email || facebookUser.email,
      name:
        userData?.name ||
        `${facebookUser.first_name || ""} ${facebookUser.last_name || ""}`.trim() ||
        "User",
      password: generateOAuthPassword("facebook"),
      age: userData?.age || 25,
      gender: userData?.gender || "male",
      height: userData?.height || 170,
      weight: userData?.weight || 70,

      path: normalizedPath,
      targetWeight: userData?.targetWeight,
      allergies: userData?.allergies || [],
      dietaryRestrictions: userData?.dietaryRestrictions || [],
      foodPreferences: userData?.foodPreferences || [],
      dislikes: userData?.dislikes || [],
      fastingHours: userData?.fastingHours,
      fastingStartTime: userData?.fastingStartTime,
      workoutFrequency: userData?.workoutFrequency,
      bmr: userData?.bmr,
      tdee: userData?.tdee,
      idealWeight: userData?.idealWeight,
      isPremium: userData?.isPremium || false,
      picture: facebookUser.picture,
      oauthProvider: "facebook",
      oauthId: facebookUser.id,
      preferences: userData?.preferences || {},
    });

    const userDataForPlan: IUserData = {
      email: (user as any).email,
      password: (user as any).password,
      name: (user as any).name,
      age: (user as any).age,
      gender: (user as any).gender,
      height: (user as any).height,
      weight: (user as any).weight,
      fastingHours: (user as any).fastingHours,
      fastingStartTime: (user as any).fastingStartTime,
      workoutFrequency: (user as any).workoutFrequency,
      bmr: (user as any).bmr,
      tdee: (user as any).tdee,
      idealWeight: (user as any).idealWeight,
      path: (user as any).path,
      targetWeight: (user as any).targetWeight,
      allergies: (user as any).allergies,
      dietaryRestrictions: (user as any).dietaryRestrictions,
      foodPreferences: (user as any).foodPreferences || [],
      dislikes: (user as any).dislikes,
      preferences: {},
    };

    const initialPlan = await this.planService.createInitialPlanFunction(
      (user as any)._id.toString(),
      userDataForPlan,
      "en"
    );

    return {
      status: "success",
      data: {
        user: user,
        plan: initialPlan,
        token: generateToken(user._id.toString()),
      },
    };
  }

  async facebookSignin(accessToken: string) {
    if (!accessToken) {
      throw new BadRequestException("Facebook access token is required");
    }

    const facebookUser = await verifyFacebookToken(accessToken);

    if (!facebookUser) {
      throw new UnauthorizedException("Invalid Facebook token");
    }

    const user = await this.userModel.findOne({ email: facebookUser.email });

    if (!user) {
      throw new UnauthorizedException("User not found. Please sign up first.");
    }

    (user as any).oauthProvider = "facebook";
    (user as any).oauthId = facebookUser.id;
    if (facebookUser.picture && !(user as any).picture) {
      (user as any).picture = facebookUser.picture;
    }
    await user.save();

    return {
      token: generateToken(user._id.toString()),
      user: user,
    };
  }

  async getUser(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException("Unauthorized");
    }
    const plan = await this.planModel.findOne({ userId: user._id });
    if (!plan) {
      throw new UnauthorizedException("Unauthorized");
    }
    return {
      status: "success",
      data: {
        user: user,
        plan: plan,
        token: generateToken(userId),
      },
    };
  }
}
