export enum SubscriptionTier {
  FREE = "free",
  PLUS = "plus",
  PREMIUM = "premium",
}

export const SUBSCRIPTION_PRICES = {
  [SubscriptionTier.FREE]: 0,
  [SubscriptionTier.PLUS]: 9.99,
  [SubscriptionTier.PREMIUM]: 14.99,
} as const;

/**
 * Feature keys that can be gated by subscription tier.
 * Each feature maps to the minimum tier required.
 */
export const TIER_FEATURES = {
  // Free tier features
  starInspiredPlanLimited: SubscriptionTier.FREE, // 1 star-inspired plan (limited)
  mealsPerWeekBasic: SubscriptionTier.FREE, // 3-5 meals/week
  streakCounter: SubscriptionTier.FREE, // Visible streak counter

  // Plus tier features
  allStarInspiredPlans: SubscriptionTier.PLUS,
  fullWeeklyPlanning: SubscriptionTier.PLUS,
  groceryList: SubscriptionTier.PLUS,
  streakContinuation: SubscriptionTier.PLUS,

  // Premium tier features
  blendedPlans: SubscriptionTier.PREMIUM,
  personalizedPortions: SubscriptionTier.PREMIUM,
  weeklyInsights: SubscriptionTier.PREMIUM,
  photoRecognition: SubscriptionTier.PREMIUM,
  aiMealSuggestions: SubscriptionTier.PLUS,
} as const;

export type FeatureKey = keyof typeof TIER_FEATURES;

export type UserRole = "user" | "admin";

export const AI_MEAL_SUGGESTION_COUNT = 3;

const TIER_RANK: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 0,
  [SubscriptionTier.PLUS]: 1,
  [SubscriptionTier.PREMIUM]: 2,
};

export function isAdminRole(role?: string | null): boolean {
  return role === "admin";
}

/**
 * Admins always receive premium-tier access for feature checks.
 */
export function getEffectiveSubscriptionTier(
  tier?: SubscriptionTier | string | null,
  role?: string | null
): SubscriptionTier {
  if (isAdminRole(role)) {
    return SubscriptionTier.PREMIUM;
  }
  const normalized = tier as SubscriptionTier;
  if (
    normalized === SubscriptionTier.PLUS ||
    normalized === SubscriptionTier.PREMIUM
  ) {
    return normalized;
  }
  return SubscriptionTier.FREE;
}

/**
 * Check if a subscription tier has access to a given feature.
 */
export function hasFeatureAccess(
  userTier: SubscriptionTier,
  feature: FeatureKey
): boolean {
  const requiredTier = TIER_FEATURES[feature];
  return TIER_RANK[userTier] >= TIER_RANK[requiredTier];
}

export function hasFeatureAccessForUser(
  tier: SubscriptionTier | string | undefined | null,
  feature: FeatureKey,
  role?: string | null
): boolean {
  return hasFeatureAccess(
    getEffectiveSubscriptionTier(tier, role),
    feature
  );
}
