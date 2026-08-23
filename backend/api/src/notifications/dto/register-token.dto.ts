import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  platform?: string;
}
