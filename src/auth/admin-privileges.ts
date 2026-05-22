import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { IUserData } from "../types/interfaces";
import { SubscriptionTier } from "../enums/enumSubscription";

export function getAdminConfig(configService: ConfigService) {
  const emails = (configService.get<string>("ADMIN_USER_EMAILS") || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const userId = configService.get<string>("ADMIN_USER_ID")?.trim();
  return { emails, userId };
}

export function shouldPromoteToAdmin(
  userId: string,
  email: string | undefined,
  config: { emails: string[]; userId?: string }
): boolean {
  if (config.userId && userId === config.userId) {
    return true;
  }
  const normalizedEmail = email?.trim().toLowerCase();
  return Boolean(
    normalizedEmail && config.emails.includes(normalizedEmail)
  );
}

/**
 * Promotes configured dev/test accounts to admin with premium access.
 */
export async function applyAdminPrivileges(
  user: IUserData & { _id?: { toString(): string } },
  userModel: Model<IUserData>,
  configService: ConfigService
): Promise<IUserData> {
  const userId = user._id?.toString();
  if (!userId) {
    return user;
  }

  const adminConfig = getAdminConfig(configService);
  if (!shouldPromoteToAdmin(userId, user.email, adminConfig)) {
    return user;
  }

  const needsUpdate =
    user.role !== "admin" || user.subscriptionTier !== SubscriptionTier.PREMIUM;

  if (needsUpdate) {
    await userModel.updateOne(
      { _id: userId },
      {
        $set: {
          role: "admin",
          subscriptionTier: SubscriptionTier.PREMIUM,
        },
      }
    );
    user.role = "admin";
    user.subscriptionTier = SubscriptionTier.PREMIUM;
  }

  return user;
}
