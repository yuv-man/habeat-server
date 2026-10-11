import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../../../src/auth/auth.service";
import { User } from "../../../src/user/user.model";
import { Plan } from "../../../src/plan/plan.model";
import { PlanService } from "../../../src/plan/plan.service";
import { ConfigService } from "@nestjs/config";
import { AnalyticsService } from "../../../src/analytics/analytics.service";
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";

// Mock the oauth utilities
jest.mock("../../../src/utils/oauth", () => ({
  verifyGoogleToken: jest.fn(),
  verifyFacebookToken: jest.fn(),
  generateOAuthPassword: jest.fn().mockReturnValue("oauth_password"),
  getGoogleAuthUrl: jest.fn().mockReturnValue("https://google.com/auth"),
  exchangeGoogleCodeForTokens: jest.fn(),
}));

// Mock generateToken utility
jest.mock("../../../src/utils/generateToken", () => ({
  __esModule: true,
  default: jest.fn().mockReturnValue("mock_jwt_token"),
}));

/** A user query usable both awaited directly and as
 *  `findOne().select("+password")`, the one read that needs the hash. */
const userQuery = (user: unknown) => {
  const query: any = {
    select: jest.fn(() => query),
    then: (resolve: any, reject: any) =>
      Promise.resolve(user).then(resolve, reject),
  };
  return query;
};

describe("AuthService", () => {
  let service: AuthService;
  let mockUserModel: any;
  let mockPlanModel: any;
  let mockJwtService: any;
  let mockPlanService: any;

  const mockUser = {
    _id: "507f1f77bcf86cd799439011",
    email: "test@example.com",
    password: "hashedpassword",
    name: "Test User",
    age: 30,
    gender: "male",
    height: 175,
    weight: 75,
    path: "healthy",
    comparePassword: jest.fn(),
    save: jest.fn(),
  };

  const mockPlan = {
    _id: "plan123",
    userId: "507f1f77bcf86cd799439011",
    title: "Test Plan",
    weeklyPlan: {},
  };

  beforeEach(async () => {
    mockUserModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    mockPlanModel = {
      findOne: jest.fn(),
    };

    mockJwtService = {
      signAsync: jest.fn().mockResolvedValue("jwt_token"),
      verifyAsync: jest.fn(),
    };

    mockPlanService = {
      createInitialPlanFunction: jest.fn().mockResolvedValue(mockPlan),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Plan.name),
          useValue: mockPlanModel,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: PlanService,
          useValue: mockPlanService,
        },
        // No admin ids/emails configured, so nobody is promoted to admin.
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: AnalyticsService,
          useValue: { identify: jest.fn(), capture: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("should register a new user successfully", async () => {
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        ...mockUser,
        _id: { toString: () => "507f1f77bcf86cd799439011" },
      });

      const userData = {
        email: "newuser@example.com",
        password: "password123",
        userData: {
          email: "newuser@example.com",
          password: "password123",
          name: "New User",
          age: 25,
          gender: "male" as const,
          height: 170,
          weight: 70,
          path: "healthy" as const,
          allergies: [] as string[],
          dietaryRestrictions: [] as string[],
          foodPreferences: [] as string[],
          dislikes: [] as string[],
          preferences: {},
        },
      };

      const result = await service.register(userData);

      expect(result.status).toBe("success");
      expect(result.data.token).toBeDefined();
      expect(mockUserModel.create).toHaveBeenCalled();
    });

    it("should throw ConflictException if user already exists", async () => {
      mockUserModel.findOne.mockResolvedValue(mockUser);

      const userData = {
        email: "test@example.com",
        password: "password123",
        userData: {
          email: "test@example.com",
          password: "password123",
          name: "Test",
          age: 25,
          gender: "male" as const,
          height: 170,
          weight: 70,
          path: "healthy" as const,
          allergies: [] as string[],
          dietaryRestrictions: [] as string[],
          foodPreferences: [] as string[],
          dislikes: [] as string[],
          preferences: {},
        },
      };

      await expect(service.register(userData)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("login", () => {
    it("should login user successfully with valid credentials", async () => {
      const userWithCompare = {
        ...mockUser,
        _id: { toString: () => "507f1f77bcf86cd799439011" },
        comparePassword: jest.fn().mockResolvedValue(true),
      };
      mockUserModel.findOne.mockReturnValue(userQuery(userWithCompare));

      const result = await service.login("test@example.com", "password123");

      expect(result.status).toBe("success");
      expect(result.data.token).toBeDefined();
      expect(result.data.user).toBeDefined();
    });

    it("should throw UnauthorizedException with invalid credentials", async () => {
      const userWithCompare = {
        ...mockUser,
        comparePassword: jest.fn().mockResolvedValue(false),
      };
      mockUserModel.findOne.mockReturnValue(userQuery(userWithCompare));

      await expect(
        service.login("test@example.com", "wrongpassword"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException if user not found", async () => {
      mockUserModel.findOne.mockReturnValue(userQuery(null));

      await expect(
        service.login("nonexistent@example.com", "password"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("logout", () => {
    it("should return success message", async () => {
      const result = await service.logout("user123");

      expect(result.status).toBe("success");
      expect(result.message).toBe("Logged out successfully");
    });

    it("revokes every token the user holds", async () => {
      // A logout that leaves the token valid isn't a logout.
      await service.logout("user123");

      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { _id: "user123" },
        { $inc: { tokenVersion: 1 } },
      );
    });
  });

  describe("getUser", () => {
    it("should return user and plan", async () => {
      mockUserModel.findById.mockResolvedValue(mockUser);
      mockPlanModel.findOne.mockResolvedValue(mockPlan);

      const result = await service.getUser("507f1f77bcf86cd799439011");

      expect(result.status).toBe("success");
      expect(result.data.user).toBeDefined();
      expect(result.data.plan).toBeDefined();
      expect(result.data.token).toBeDefined();
    });

    it("should throw UnauthorizedException if user not found", async () => {
      mockUserModel.findById.mockResolvedValue(null);

      await expect(service.getUser("507f1f77bcf86cd799439099")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects a malformed user id before querying", async () => {
      await expect(service.getUser("nonexistent")).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserModel.findById).not.toHaveBeenCalled();
    });

    it("returns a null plan for a user who hasn't finished onboarding", async () => {
      // OAuth sign-ups exist before their first plan does.
      mockUserModel.findById.mockResolvedValue(mockUser);
      mockPlanModel.findOne.mockResolvedValue(null);

      const result = await service.getUser("507f1f77bcf86cd799439011");

      expect(result.data.plan).toBeNull();
      expect(result.data.user).toBeDefined();
    });
  });

  describe("getGoogleSigninUrl", () => {
    it("should return Google OAuth URL", async () => {
      const result = await service.getGoogleSigninUrl(
        "http://localhost:5080/callback",
        "http://localhost:8080/auth",
      );
      expect(result).toBe("https://google.com/auth");
    });
  });
});
