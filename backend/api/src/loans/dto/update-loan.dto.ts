import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
