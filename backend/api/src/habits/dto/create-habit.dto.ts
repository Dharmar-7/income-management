import {
  IsString, IsOptional, IsInt, IsArray,
  ArrayMaxSize, Min, Max, MaxLength,
} from 'class-validator';

export class CreateHabitDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(8) // a single emoji
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  // How many days a week counts as "on track" (1–7).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weeklyTarget?: number;

  // Which weekdays the habit is planned: 0=Sun … 6=Sat.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  scheduleDays?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
