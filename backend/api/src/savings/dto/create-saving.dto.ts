import {
  IsString, IsNumber, IsEnum, IsOptional,
  IsDateString, IsPositive, MaxLength, Min,
} from 'class-validator';
import { SavingType } from '@prisma/client';

export class CreateSavingDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsEnum(SavingType)
  type: SavingType;

  @IsNumber()
  @IsPositive()
  investedAmount: number;

  @IsNumber()
  @Min(0)
  charges: number;

  // Optional — defaults to the invested amount (a brand-new investment is worth
  // what you put in until you update its market value).
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentValue?: number;

  // Optional monthly SIP amount. When set, the app shows a "+" button to add
  // one month's contribution in a tap.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  sipAmount?: number;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  maturityDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsString()
  platformId?: string;

  // For a standalone (no-platform) investment funded straight from the bank:
  // the bank debit that paid for it. Reclassified to INVESTMENT so it isn't
  // also counted as an expense. Ignored when platformId is set (wallet money).
  @IsOptional()
  @IsString()
  transactionId?: string;
}
