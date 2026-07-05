import { IsString, IsOptional, IsIn, Matches } from 'class-validator';

// Toggle / set a check-in for one habit on one day.
export class CheckinHabitDto {
  // Calendar day "YYYY-MM-DD". Sent by the client so the day matches the
  // user's local timezone (the server's UTC "today" can be a day off in IST).
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day must be YYYY-MM-DD' })
  day: string;

  // Omit (or 'TOGGLE') to cycle none → DONE → PARTIAL → none.
  // Pass an explicit status to set it directly.
  @IsOptional()
  @IsIn(['DONE', 'PARTIAL', 'NONE', 'TOGGLE'])
  status?: 'DONE' | 'PARTIAL' | 'NONE' | 'TOGGLE';
}
