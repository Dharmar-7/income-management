import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Body for POST /savings/:id/contribute — adds one contribution to an investment.
// `amount` is optional: when omitted, the investment's stored monthly sipAmount is used.
export class ContributeSavingDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  // Link this contribution to a real bank transaction (its SIP debit). When set,
  // that transaction is reclassified to INVESTMENT so it isn't also counted as an
  // expense. Omit to auto-link a single match, or to skip linking entirely.
  @IsOptional()
  @IsString()
  transactionId?: string;
}
