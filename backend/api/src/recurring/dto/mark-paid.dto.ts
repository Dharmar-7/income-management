import { IsOptional, IsString } from 'class-validator';

// Body for POST /recurring/:id/pay — optionally link an existing bank transaction.
export class MarkPaidDto {
  @IsOptional()
  @IsString()
  transactionId?: string;
}
