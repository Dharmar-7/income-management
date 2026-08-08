import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
