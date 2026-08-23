import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdatePrefsDto {
  @IsOptional() @IsBoolean()
  notifyJobs?: boolean;

  @IsOptional() @IsBoolean()
  notifyNews?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @IsIn(['markets', 'tech', 'science'], { each: true })
  newsCategories?: string[];
}
