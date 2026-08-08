import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateBankDto {
  @IsString()
  @MaxLength(60)
  name: string;

  // Palette key (teal/indigo/orange/green/violet/red/…). Validated loosely —
  // the client picks from a fixed swatch list.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
