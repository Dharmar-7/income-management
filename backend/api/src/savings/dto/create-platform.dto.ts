import { IsString, IsNumber, IsOptional, IsPositive, MaxLength, Min } from 'class-validator';

export class CreatePlatformDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsNumber()
  @Min(0)
  totalAdded: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  // The bank transfer that funded this top-up (money bank → wallet). Reclassified
  // to INVESTMENT so it isn't counted as an expense.
  @IsOptional()
  @IsString()
  transactionId?: string;
}
