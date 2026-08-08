import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  IsEnum,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { TransactionType } from '@prisma/client';

// Defines what PATCH /transactions/:id accepts.
// Every field is optional — the client sends only what changed. This powers
// full transaction editing (fixing a wrong merchant/amount/date from an import,
// re-categorising, changing the type, or adding a note).
export class UpdateTransactionDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  merchant?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  categoryId?: string; // '' clears the category (Uncategorized)

  @IsOptional()
  @IsString()
  bankId?: string; // '' clears the bank

  @IsOptional()
  @IsString()
  @MaxLength(500) // prevent absurdly long notes
  description?: string;
}
