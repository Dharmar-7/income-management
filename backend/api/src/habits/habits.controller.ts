import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { HabitsService } from './habits.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { CheckinHabitDto } from './dto/checkin-habit.dto';

@Controller('habits')
@UseGuards(ClerkAuthGuard)
export class HabitsController {
  constructor(private service: HabitsService) {}

  // GET /habits?today=YYYY-MM-DD — weekly board, daily score, streaks.
  // `today` is the client's local day so the board lines up with the user's timezone.
  @Get()
  getBoard(@CurrentUser() userId: string, @Query('today') today?: string) {
    const iso = today && /^\d{4}-\d{2}-\d{2}$/.test(today)
      ? today
      : new Date().toISOString().slice(0, 10);
    return this.service.getBoard(userId, iso);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateHabitDto) {
    return this.service.create(userId, dto);
  }

  // POST /habits/seed-defaults — add the seven Life OS starter habits (only if none exist).
  @Post('seed-defaults')
  seedDefaults(@CurrentUser() userId: string) {
    return this.service.seedDefaults(userId);
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateHabitDto) {
    return this.service.update(userId, id, dto);
  }

  // POST /habits/:id/checkin — toggle or set a day's tick.
  @Post(':id/checkin')
  checkin(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: CheckinHabitDto) {
    return this.service.checkin(userId, id, dto.day, dto.status);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
