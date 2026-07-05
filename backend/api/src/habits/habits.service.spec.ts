import { statusWeight, weekDays, weekPercent, dailyScore } from './habits.service';
import { HabitStatus } from '@prisma/client';

describe('statusWeight', () => {
  it('scores DONE as 1 and PARTIAL as 0.5', () => {
    expect(statusWeight('DONE')).toBe(1);
    expect(statusWeight('PARTIAL')).toBe(0.5);
  });
});

describe('weekDays', () => {
  it('returns Monday→Sunday for a mid-week day', () => {
    // 2026-06-18 is a Thursday.
    expect(weekDays('2026-06-18')).toEqual([
      '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18',
      '2026-06-19', '2026-06-20', '2026-06-21',
    ]);
  });

  it('treats Sunday as the last day of its week, not the first', () => {
    // 2026-06-21 is a Sunday — should still map to the Mon 15 → Sun 21 week.
    expect(weekDays('2026-06-21')[0]).toBe('2026-06-15');
    expect(weekDays('2026-06-21')[6]).toBe('2026-06-21');
  });
});

describe('weekPercent', () => {
  const days = weekDays('2026-06-18');

  it('is 0 with no check-ins', () => {
    expect(weekPercent(new Map(), days)).toBe(0);
  });

  it('counts DONE as full and PARTIAL as half', () => {
    const m = new Map<string, HabitStatus>([
      ['2026-06-15', 'DONE'],
      ['2026-06-16', 'DONE'],
      ['2026-06-17', 'PARTIAL'],
    ]);
    // (1 + 1 + 0.5) / 7 = 0.357…
    expect(weekPercent(m, days)).toBeCloseTo(2.5 / 7, 5);
  });

  it('caps at 1 even if every day is done', () => {
    const m = new Map<string, HabitStatus>(days.map(d => [d, 'DONE' as HabitStatus]));
    expect(weekPercent(m, days)).toBe(1);
  });
});

describe('dailyScore', () => {
  // Thursday = dow 4
  it('returns 0 when nothing is scheduled today', () => {
    const r = dailyScore([{ scheduleDays: [0, 6], today: undefined }], 4);
    expect(r).toEqual({ score: 0, done: 0, due: 0 });
  });

  it('averages completion across habits due today', () => {
    const habits = [
      { scheduleDays: [4], today: 'DONE' as HabitStatus },
      { scheduleDays: [4], today: 'PARTIAL' as HabitStatus },
      { scheduleDays: [4], today: undefined },
      { scheduleDays: [0], today: 'DONE' as HabitStatus }, // not due Thursday — ignored
    ];
    // due = first 3; sum = 1 + 0.5 + 0 = 1.5; 1.5/3 = 0.5 → 50
    const r = dailyScore(habits, 4);
    expect(r).toEqual({ score: 50, done: 1, due: 3 });
  });

  it('is 100 when every due habit is DONE', () => {
    const habits = [
      { scheduleDays: [4], today: 'DONE' as HabitStatus },
      { scheduleDays: [4], today: 'DONE' as HabitStatus },
    ];
    expect(dailyScore(habits, 4).score).toBe(100);
  });
});
