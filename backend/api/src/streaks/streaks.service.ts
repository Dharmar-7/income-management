import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ── Pure date helpers (exported for testing) ────────────────────────────────
export function isoAddDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Given the set of distinct active days (YYYY-MM-DD) and "today", return the
// current run (counting back from today or yesterday) and the longest-ever run.
export function computeStreaks(daySet: Set<string>, todayIso: string): { current: number; longest: number } {
  if (daySet.size === 0) return { current: 0, longest: 0 };

  const sorted = [...daySet].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (isoAddDays(sorted[i - 1], 1) === sorted[i]) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current streak only counts if there was activity today or yesterday.
  const yesterday = isoAddDays(todayIso, -1);
  let cursor: string | null = daySet.has(todayIso) ? todayIso : daySet.has(yesterday) ? yesterday : null;
  let current = 0;
  while (cursor && daySet.has(cursor)) {
    current++;
    cursor = isoAddDays(cursor, -1);
  }

  return { current, longest };
}

// Distinct UTC days (YYYY-MM-DD) with any logged activity. Computed in the DB —
// previously we fetched every Transaction/CashTransaction row's createdAt over a
// cross-region link just to dedupe them into days.
export async function fetchActiveDays(prisma: PrismaService, userId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ day: string }[]>`
    SELECT DISTINCT DATE("createdAt")::text AS day FROM "Transaction" WHERE "userId" = ${userId}
    UNION
    SELECT DISTINCT DATE("createdAt")::text AS day FROM "CashTransaction" WHERE "userId" = ${userId}
  `;
  return new Set(rows.map(r => r.day));
}

export interface Achievement {
  key: string;
  title: string;
  icon: string;
  unlocked: boolean;
  hint: string;
}
const ach = (key: string, title: string, icon: string, unlocked: boolean, hint: string): Achievement =>
  ({ key, title, icon, unlocked, hint });

@Injectable()
export class StreaksService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  async getSummary(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);

    const [days, txCount, savingsCount, budgetsCount, notesCount, goals] = await Promise.all([
      fetchActiveDays(this.prisma, userId),
      this.prisma.transaction.count({ where: { userId } }),
      this.prisma.saving.count({ where: { userId } }),
      this.prisma.budget.count({ where: { userId } }),
      this.prisma.note.count({ where: { userId } }),
      this.prisma.goal.findMany({ where: { userId }, select: { savedAmount: true, targetAmount: true } }),
    ]);

    const todayIso = new Date().toISOString().slice(0, 10);
    const { current, longest } = computeStreaks(days, todayIso);

    const goalsReached = goals.filter(g => g.savedAmount >= g.targetAmount).length;

    const achievements: Achievement[] = [
      ach('first-txn', 'First Step', '👟', txCount >= 1, 'Log your first transaction'),
      ach('budgeter', 'Budgeter', '🎯', budgetsCount >= 1, 'Set your first budget'),
      ach('investor', 'Investor', '📈', savingsCount >= 1, 'Add your first investment'),
      ach('note-taker', 'Note Taker', '📝', notesCount >= 1, 'Write your first note'),
      ach('goal-getter', 'Goal Getter', '🏆', goalsReached >= 1, 'Reach a savings goal'),
      ach('week-streak', '7-Day Streak', '🔥', longest >= 7, 'Log activity 7 days running'),
      ach('month-streak', '30-Day Streak', '⚡', longest >= 30, 'Log activity 30 days running'),
      ach('portfolio', 'Portfolio Builder', '💼', savingsCount >= 5, 'Track 5 investments'),
      ach('centurion', 'Centurion', '💯', txCount >= 100, 'Log 100 transactions'),
    ];

    return {
      currentStreak: current,
      longestStreak: longest,
      activeToday: days.has(todayIso),
      unlockedCount: achievements.filter(a => a.unlocked).length,
      total: achievements.length,
      achievements,
    };
  }
}
