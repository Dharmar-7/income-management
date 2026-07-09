import { Injectable, NotFoundException } from '@nestjs/common';
import { Habit, HabitCheckin, HabitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeStreaks, isoAddDays } from '../streaks/streaks.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';

// ── Pure helpers (exported for unit testing) ────────────────────────────────

// A check-in's contribution to a score: ✅ = 1, 🟡 = 0.5.
export function statusWeight(status: HabitStatus): number {
  return status === 'PARTIAL' ? 0.5 : 1;
}

// The 7 ISO days (YYYY-MM-DD) of the week containing `todayIso`, Monday-first.
export function weekDays(todayIso: string): string[] {
  const d = new Date(todayIso + 'T00:00:00Z');
  const dow = d.getUTCDay();              // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7;     // days since Monday
  const monday = isoAddDays(todayIso, -backToMonday);
  return Array.from({ length: 7 }, (_, i) => isoAddDays(monday, i));
}

// Weekly completion fraction (0–1) for one habit: (Σ weights) / 7, capped at 1.
export function weekPercent(dayStatus: Map<string, HabitStatus>, days: string[]): number {
  let sum = 0;
  for (const day of days) {
    const s = dayStatus.get(day);
    if (s) sum += statusWeight(s);
  }
  return Math.min(1, sum / days.length);
}

// Today's score out of 100 across all habits: average completion of habits
// scheduled for today (mirrors the Life OS daily scoreboard).
export function dailyScore(
  habits: { scheduleDays: number[]; today: HabitStatus | undefined }[],
  todayDow: number,
): { score: number; done: number; due: number } {
  const due = habits.filter(h => h.scheduleDays.includes(todayDow));
  if (due.length === 0) return { score: 0, done: 0, due: 0 };
  let sum = 0;
  let done = 0;
  for (const h of due) {
    if (h.today) { sum += statusWeight(h.today); if (h.today === 'DONE') done++; }
  }
  return { score: Math.round((sum / due.length) * 100), done, due: due.length };
}

// ── Defaults: the seven Life OS habits ──────────────────────────────────────
const DEFAULT_HABITS: CreateHabitDto[] = [
  { name: 'Workout',       icon: '💪', color: 'orange', weeklyTarget: 5 },
  { name: 'Reading',       icon: '📖', color: 'teal',   weeklyTarget: 7 },
  { name: 'AI Learning',   icon: '🤖', color: 'indigo', weeklyTarget: 6 },
  { name: 'Communication', icon: '🗣️', color: 'violet', weeklyTarget: 6 },
  { name: 'Investing',     icon: '📈', color: 'green',  weeklyTarget: 3 },
  { name: 'Content',       icon: '🎬', color: 'danger', weeklyTarget: 4 },
  { name: 'Sleep 7h',      icon: '😴', color: 'indigo', weeklyTarget: 7 },
];

@Injectable()
export class HabitsService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  // GET /habits — board data: each habit with the anchor week's ticks, week %,
  // and streaks. `anchorIso` picks the displayed week (defaults to the current
  // one); daily score + streaks always follow the real `todayIso`.
  async getBoard(clerkId: string, todayIso: string, anchorIso: string = todayIso) {
    const userId = await this.resolveUserId(clerkId);
    const days = weekDays(anchorIso);
    const todayDow = new Date(todayIso + 'T00:00:00Z').getUTCDay();

    const habits = await this.prisma.habit.findMany({
      where: { userId, isArchived: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        checkins: { select: { day: true, status: true } },
      },
    });

    const enriched = habits.map(h => {
      const byDay = new Map<string, HabitStatus>(h.checkins.map(c => [c.day, c.status]));
      const week = days.map(day => ({ day, status: byDay.get(day) ?? null }));
      const doneDaySet = new Set(h.checkins.map(c => c.day)); // any tick counts toward streak
      const { current, longest } = computeStreaks(doneDaySet, todayIso);
      const weeklyDone = days.reduce((n, day) => n + (byDay.has(day) ? 1 : 0), 0);
      return {
        id: h.id,
        name: h.name,
        icon: h.icon,
        color: h.color,
        weeklyTarget: h.weeklyTarget,
        scheduleDays: h.scheduleDays,
        order: h.order,
        note: h.note,
        week,
        weekPercent: Math.round(weekPercent(byDay, days) * 100),
        weeklyDone,
        currentStreak: current,
        longestStreak: longest,
        today: byDay.get(todayIso) ?? null,
      };
    });

    const score = dailyScore(
      enriched.map(h => ({ scheduleDays: h.scheduleDays, today: h.today ?? undefined })),
      todayDow,
    );

    return {
      weekStart: days[0],
      days,
      todayIso,
      habits: enriched,
      dailyScore: score.score,
      dailyDone: score.done,
      dailyDue: score.due,
    };
  }

  async create(clerkId: string, dto: CreateHabitDto) {
    const userId = await this.resolveUserId(clerkId);
    const count = await this.prisma.habit.count({ where: { userId } });
    return this.prisma.habit.create({
      data: {
        userId,
        name: dto.name.trim(),
        icon: dto.icon?.trim() || '✅',
        color: dto.color?.trim() || 'indigo',
        weeklyTarget: dto.weeklyTarget ?? 7,
        scheduleDays: dto.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6],
        note: dto.note?.trim() || null,
        order: count,
      },
    });
  }

  async update(clerkId: string, habitId: string, dto: UpdateHabitDto) {
    const userId = await this.resolveUserId(clerkId);
    await this.assertOwned(userId, habitId);
    return this.prisma.habit.update({
      where: { id: habitId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.icon !== undefined && { icon: dto.icon?.trim() || '✅' }),
        ...(dto.color !== undefined && { color: dto.color?.trim() || 'indigo' }),
        ...(dto.weeklyTarget !== undefined && { weeklyTarget: dto.weeklyTarget }),
        ...(dto.scheduleDays !== undefined && { scheduleDays: dto.scheduleDays }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
      },
    });
  }

  async remove(clerkId: string, habitId: string) {
    const userId = await this.resolveUserId(clerkId);
    await this.assertOwned(userId, habitId);
    await this.prisma.habit.delete({ where: { id: habitId } });
    return { message: 'Habit deleted.' };
  }

  // Toggle / set a check-in for one habit on one day.
  // No status (or 'TOGGLE') cycles: none → DONE → PARTIAL → none.
  async checkin(clerkId: string, habitId: string, day: string, status?: string) {
    const userId = await this.resolveUserId(clerkId);
    await this.assertOwned(userId, habitId);

    const existing = await this.prisma.habitCheckin.findUnique({
      where: { habitId_day: { habitId, day } },
    });

    // Resolve the next state.
    let next: HabitStatus | null;
    if (!status || status === 'TOGGLE') {
      next = existing === null ? 'DONE' : existing.status === 'DONE' ? 'PARTIAL' : null;
    } else if (status === 'NONE') {
      next = null;
    } else {
      next = status as HabitStatus;
    }

    if (next === null) {
      if (existing) await this.prisma.habitCheckin.delete({ where: { id: existing.id } });
      return { habitId, day, status: null };
    }

    const saved = await this.prisma.habitCheckin.upsert({
      where: { habitId_day: { habitId, day } },
      create: { habitId, userId, day, status: next },
      update: { status: next },
    });
    return { habitId, day, status: saved.status };
  }

  // Create the seven Life OS starter habits — only if the user has none yet.
  async seedDefaults(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const count = await this.prisma.habit.count({ where: { userId } });
    if (count > 0) return { created: 0, message: 'Habits already exist — nothing seeded.' };

    await this.prisma.habit.createMany({
      data: DEFAULT_HABITS.map((h, i) => ({
        userId,
        name: h.name,
        icon: h.icon!,
        color: h.color!,
        weeklyTarget: h.weeklyTarget!,
        scheduleDays: [0, 1, 2, 3, 4, 5, 6],
        order: i,
      })),
    });
    return { created: DEFAULT_HABITS.length, message: 'Starter habits added.' };
  }

  private async assertOwned(userId: string, habitId: string): Promise<Habit> {
    const habit = await this.prisma.habit.findFirst({ where: { id: habitId, userId } });
    if (!habit) throw new NotFoundException('Habit not found.');
    return habit;
  }
}

// Re-export the type so tests/controllers can reference check-in shapes.
export type { HabitCheckin };
