import { IsEnum, IsNotEmpty } from 'class-validator';
import { SubscriptionTier } from '../../enums/enumSubscription';

export class ChangeTierDto {
  @IsEnum(SubscriptionTier)
  @IsNotEmpty()
  tier: SubscriptionTier;
}
