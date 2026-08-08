import { Type } from 'class-transformer';
import {
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  IsPositive,
  IsEnum,
  IsDateString,
  IsOptional,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { TransactionType } from '@prisma/client';

// One reviewed row the user chose to import from a parsed statement.
export class StatementTxnDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @MaxLength(200)
  merchant: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  upiRef?: string;
}

export class CommitStatementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StatementTxnDto)
  transactions: StatementTxnDto[];

  // Tag the whole imported batch with this bank (colour-coded in the list).
  @IsOptional()
  @IsString()
  bankId?: string;
}
