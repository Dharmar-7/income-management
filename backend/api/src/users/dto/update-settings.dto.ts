import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  // 1 = plain calendar month. Capped at 28 so February always works.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  monthStartDay?: number;

  // Safe-to-Spend: rupee cushion held back each cycle before the daily allowance.
  @IsOptional()
  @IsNumber()
  @Min(0)
  stsBuffer?: number;

  // Safe-to-Spend: manual per-day cap. 0 = clear it (auto = income spread evenly).
  @IsOptional()
  @IsNumber()
  @Min(0)
  stsDailyTarget?: number;
}
