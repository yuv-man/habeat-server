import { IsNotEmpty, IsUrl } from 'class-validator';

export class CreatePortalSessionDto {
  @IsUrl()
  @IsNotEmpty()
  returnUrl: string;
}
