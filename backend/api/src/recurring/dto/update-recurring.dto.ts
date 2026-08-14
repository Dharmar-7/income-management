import { IsOptional, IsString, IsNumber, Min, MaxLength } from 'class-validator';

// Only these fields are editable on a recurring bill (see RecurringService.update).
export class UpdateRecurringDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
