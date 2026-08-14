import {
  IsString, IsNumber, IsEnum, IsOptional,
  IsDateString, Min, ValidateNested, IsArray, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// One transaction (or manual amount) that moved money — a "leg" of the tab.
export class SettlementLegDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  // Optional link to a real transaction — it gets re-typed TRANSFER.
  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateSettlementDto {
  @IsString()
  personName: string;

  @IsEnum(['SENT', 'RECEIVED'])
  direction: 'SENT' | 'RECEIVED';

  @IsOptional()
  @IsString()
  note?: string;

  // The money that moved — one or more sends (for SENT) / receipts (for RECEIVED).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementLegDto)
  principals?: SettlementLegDto[];

  // ── Legacy single-transfer shape (older app builds) ──────────────────────
  // Accepted so an un-updated client still works; converted to one principal.
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsDateString()
  transferredAt?: string;

  @IsOptional()
  @IsString()
  originalTxId?: string;
}

// Add one leg to an existing settlement (another send, or a return).
export class AddEntryDto {
  @IsEnum(['PRINCIPAL', 'REPAYMENT'])
  kind: 'PRINCIPAL' | 'REPAYMENT';

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

// Quick "settle in full" — records a return covering the whole outstanding
// balance (optionally linked to a real transaction).
export class SettleDto {
  @IsOptional()
  @IsString()
  repaymentTxId?: string;

  // Explicit return amount; defaults to the current outstanding balance.
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsDateString()
  settledAt?: string;
}
