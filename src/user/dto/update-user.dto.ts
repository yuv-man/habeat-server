import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  IsObject,
  IsIn,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { SafeText, SafeTextArray } from "../../utils/safe-input.decorator";

/**
 * The ONLY fields a user may set on their own record via `PUT /users/:id`.
 *
 * The previous handler took `@Body() updateData: any` and passed it straight
 * into `findByIdAndUpdate`, so with the global `whitelist:true` pipe stripping
 * nothing (there was no schema to whitelist against), a user could set their
 * own `role: "admin"` or `subscriptionTier: "premium"` and escalate / bypass
 * billing. This allowlist is the fix: anything not named here is dropped by
 * the ValidationPipe before it reaches the database.
 *
 * Deliberately ABSENT — never user-settable through this route:
 *   role, subscriptionTier, subscriptionStatus, subscriptionEndDate,
 *   stripeCustomerId, stripeSubscriptionId, oauthProvider, oauthId,
 *   password, email, engagement (xp/level/streak/coins/badges),
 *   mealLearningProfile, _id/id.
 * Those move only through their own authenticated flows (Stripe webhook,
 * OAuth, the engagement service, a dedicated verified email-change route).
 */
export class UpdateUserDto {
  @IsOptional()
  @SafeText(80)
  name?: string;

  @IsOptional()
  @SafeText(40)
  phone?: string;

  // Base64 data URL. Capped just under the global 10MB JSON body limit so this
  // field is never the *tighter* bound — a raw phone photo (the mobile app
  // sends the picker's full-resolution image) that fit before still fits. The
  // service re-compresses it to 400x400 on receipt; the client now also resizes
  // before upload, so real payloads are tiny and this cap only stops abuse.
  @IsOptional()
  @IsString()
  @MaxLength(9_000_000)
  profilePicture?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(120)
  age?: number;

  @IsOptional()
  @IsIn(["male", "female"])
  gender?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  height?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600)
  weight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600)
  targetWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600)
  idealWeight?: number;

  @IsOptional()
  @SafeText(40)
  path?: string;

  @IsOptional()
  @IsArray()
  @SafeTextArray(60)
  allergies?: string[];

  @IsOptional()
  @IsArray()
  @SafeTextArray(60)
  dietaryRestrictions?: string[];

  @IsOptional()
  @IsArray()
  @SafeTextArray(60)
  foodPreferences?: string[];

  @IsOptional()
  @IsArray()
  @SafeTextArray(60)
  dislikes?: string[];

  @IsOptional()
  @SafeText(60)
  foodRelationship?: string;

  @IsOptional()
  @IsArray()
  @SafeTextArray(60)
  emotionalTriggers?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  fastingHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(4)
  mealsPerDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(14)
  workoutFrequency?: number;

  // Derived health metrics the client recomputes locally. Low-risk, bounded.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20000)
  bmr?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20000)
  tdee?: number;

  // Free-form settings map (mealTimes, showMacros, language, …). Non-sensitive;
  // mongoose stores it as a Mixed Map. Kept an object so unrelated keys can't
  // ride in as top-level user fields.
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;

  // Typed sub-schemas on the model; mongoose strict mode drops unknown keys.
  @IsOptional()
  @IsObject()
  notificationPreferences?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sensoryProfile?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  kycCompleted?: boolean;
}
