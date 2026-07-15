import { IsInt, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  // 1 = plain calendar month. Capped at 28 so February always works.
  @IsInt()
  @Min(1)
  @Max(28)
  monthStartDay: number;
}
