/**
 * pay-cycle.ts
 * Pure helpers for a user's "money month" — a spending cycle that starts on
 * their `monthStartDay` instead of the 1st. Someone paid on the 28th has a
 * cycle running 28 Jun → 27 Jul, and calls that "July" (the month the salary
 * funds). Shared by Reports and Safe-to-Spend so the two never disagree.
 *
 * Naming rule: a cycle starting late in the month (day > 15) is named after the
 * month it ENDS in; an early cycle keeps its start month's name.
 */

/** The [start, end] date range of the cycle labelled (year `y`, month `m`). */
export function monthWindow(y: number, m: number, startDay: number) {
  const d = Math.min(Math.max(startDay || 1, 1), 28);
  if (d === 1) return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59) };
  if (d > 15) return { start: new Date(y, m - 2, d), end: new Date(y, m - 1, d - 1, 23, 59, 59) };
  return { start: new Date(y, m - 1, d), end: new Date(y, m, d - 1, 23, 59, 59) };
}

/** Which cycle label does `now` fall in? (Used when no month/year is passed.) */
export function currentCycle(now: Date, startDay: number) {
  const d = Math.min(Math.max(startDay || 1, 1), 28);
  let shift = 0;
  if (d > 15 && now.getDate() >= d) shift = 1; // late cycle already rolled into next label
  if (d > 1 && d <= 15 && now.getDate() < d) shift = -1; // early cycle still in previous label
  const ref = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  return { month: ref.getMonth() + 1, year: ref.getFullYear() };
}

/**
 * The cycle `now` sits in, plus day-counting for pacing:
 *  - totalDays: calendar days in the whole cycle
 *  - dayIndex:  today's 1-based position within the cycle
 *  - daysLeft:  today + all remaining days until the cycle ends
 */
export function currentCycleWindow(now: Date, startDay: number) {
  const { month, year } = currentCycle(now, startDay);
  const { start, end } = monthWindow(year, month, startDay);
  const MS = 86_400_000;
  const dayMs = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const totalDays = Math.round((dayMs(end) - dayMs(start)) / MS) + 1;
  const rawIndex = Math.round((dayMs(now) - dayMs(start)) / MS) + 1;
  const dayIndex = Math.min(Math.max(rawIndex, 1), totalDays);
  const daysLeft = totalDays - dayIndex + 1;
  return { month, year, start, end, totalDays, dayIndex, daysLeft };
}
