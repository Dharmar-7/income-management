import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

// One saved search as the device mirrors it to the server. `where` is either
// 'remote' or a 2-letter country code (matching the Jobs screen's chips).
export class SyncSearchItemDto {
  @IsString() @MaxLength(64)
  clientId!: string;

  @IsString() @MaxLength(80)
  label!: string;

  @IsString() @MaxLength(100)
  what!: string;

  @IsOptional() @IsString() @MaxLength(100)
  company?: string;

  @IsOptional() @IsString() @MaxLength(20)
  where?: string;

  @IsOptional() @IsString() @MaxLength(20)
  level?: string;

  @IsOptional() @IsString() @MaxLength(20)
  type?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  salaryMin?: number;
}

export class SyncSearchesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SyncSearchItemDto)
  searches!: SyncSearchItemDto[];
}
