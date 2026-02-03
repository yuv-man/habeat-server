import { IsEnum, IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { SubscriptionTier } from '../../enums/enumSubscription';

export class CreateCheckoutSessionDto {
  @IsEnum(SubscriptionTier)
  @IsNotEmpty()
  tier: SubscriptionTier;

  @IsUrl()
  @IsNotEmpty()
  successUrl: string;

  @IsUrl()
  @IsNotEmpty()
  cancelUrl: string;
}
