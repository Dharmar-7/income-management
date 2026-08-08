import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdatePlatformDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalAdded?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  // The bank transfer that funded a top-up (when totalAdded is increased).
  // Reclassified to INVESTMENT so it isn't counted as an expense.
  @IsOptional()
  @IsString()
  transactionId?: string;
}
