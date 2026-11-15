import { IsArray, IsString, ArrayMaxSize, ArrayMinSize, ArrayUnique } from 'class-validator';

// New top-to-bottom order of the habit board: habit ids, first = top row.
export class ReorderHabitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  ids: string[];
}
