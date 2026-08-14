import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateBankDto {
  @IsString()
  @MaxLength(60)
  name: string;

  // Colour hex ("#6366f1") chosen in the picker, or a legacy palette key
  // (teal/indigo/…) for banks made before the picker. Validated loosely.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
