import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';

// One watched term as the device mirrors it to the server. clientId is the
// on-device Watch id, so re-syncs upsert instead of duplicating.
export class WatchItemDto {
  @IsString() @MaxLength(64)
  clientId!: string;

  @IsString() @MaxLength(80)
  term!: string;
}

export class SyncWatchesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WatchItemDto)
  watches!: WatchItemDto[];
}
