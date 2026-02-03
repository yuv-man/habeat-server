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
} as const;

export type FeatureKey = keyof typeof TIER_FEATURES;

const TIER_RANK: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 0,
  [SubscriptionTier.PLUS]: 1,
  [SubscriptionTier.PREMIUM]: 2,
};

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
