import { IsString, IsOptional, MaxLength, IsNumber, Min, Max } from 'class-validator';

export class UpdateBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  // Current balance as of now. Send null to stop tracking this bank's balance.
  // (Can be negative for an overdrawn / OD account.)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1e9)
  @Max(1e11)
  balance?: number | null;
}
