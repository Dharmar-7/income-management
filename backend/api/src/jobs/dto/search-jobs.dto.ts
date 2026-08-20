import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Query params for GET /jobs. The global ValidationPipe runs with transform:true,
// so @Type/@Transform coerce the incoming strings into numbers/booleans.
export class SearchJobsDto {
  @IsOptional() @IsString() @MaxLength(100)
  what?: string; // role / keyword

  @IsOptional() @IsString() @MaxLength(100)
  where?: string; // location (Adzuna on-site)

  @IsOptional() @IsString() @MaxLength(2)
  country?: string; // Adzuna 2-letter code; defaults to 'in' in the service

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  salaryMin?: number;

  @IsOptional() @IsIn(['senior', 'mid', 'junior'])
  level?: 'senior' | 'mid' | 'junior';

  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  remote?: boolean;

  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  sortByDate?: boolean;
}
