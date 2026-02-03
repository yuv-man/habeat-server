import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "../../user/user.model";
import { IUserData } from "../../types/interfaces";
import {
  SubscriptionTier,
  FeatureKey,
  hasFeatureAccess,
} from "../../enums/enumSubscription";

export const REQUIRED_FEATURE_KEY = "requiredFeature";

/**
 * Decorator to mark a route as requiring a specific subscription feature.
 * Usage: @RequiresFeature('groceryList')
 */
export const RequiresFeature = (feature: FeatureKey) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectModel(User.name) private userModel: Model<IUserData>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<FeatureKey>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id || request.params?.userId;

    if (!userId) {
      throw new ForbiddenException("User not found");
    }

    const user = await this.userModel.findById(userId).select("subscriptionTier").lean();

    if (!user) {
      throw new ForbiddenException("User not found");
    }

    const userTier =
      ((user as any).subscriptionTier as SubscriptionTier) ||
      SubscriptionTier.FREE;

    if (!hasFeatureAccess(userTier, requiredFeature)) {
      throw new ForbiddenException(
        `This feature requires a ${requiredFeature} subscription. Please upgrade your plan.`
      );
    }

    return true;
  }
}
