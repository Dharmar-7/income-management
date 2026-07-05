import {
  IsString, IsOptional, IsInt, IsArray, IsBoolean,
  ArrayMaxSize, Min, Max, MaxLength,
} from 'class-validator';

export class UpdateHabitDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weeklyTarget?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  scheduleDays?: number[];

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
