import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Money alerts reuse the push pipeline to nudge users about their own finances:
//   • Bills & EMIs due within the next couple of days.
//   • Budgets crossing 80% / 100% of their monthly limit.
// One daily cron (9am IST) — never sub-hourly, so it's easy on the Neon budget.
// Each item is de-duped so a user isn't reminded about the same thing twice.

const REMIND_WITHIN_DAYS = 2;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

function inr(n: number): string {
  try {
    return '₹' + Math.round(n).toLocaleString('en-IN');
  } catch {
    return '₹' + Math.round(n);
  }
}

// Calendar parts of a Date as seen in IST.
function istParts(date: Date) {
  const s = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate() };
}

// A whole-day index in IST, so date differences are clean day counts.
function dayIndexIST(date: Date): number {
  const { y, m, d } = istParts(date);
  return Math.floor(Date.UTC(y, m, d) / DAY_MS);
}

function whenLabel(delta: number): string {
  return delta === 0 ? 'today' : delta === 1 ? 'tomorrow' : `in ${delta} days`;
}

function addLine(map: Map<string, string[]>, userId: string, line: string): void {
  const arr = map.get(userId) ?? [];
  arr.push(line);
  map.set(userId, arr);
}

@Injectable()
export class MoneyAlertsService {
  private readonly logger = new Logger(MoneyAlertsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async runDaily(): Promise<void> {
    await this.remindBills().catch(e => this.logger.warn(`bill reminders failed: ${(e as Error).message}`));
    await this.warnBudgets().catch(e => this.logger.warn(`budget warnings failed: ${(e as Error).message}`));
  }

  // ── Bills & EMIs due soon ──
  private async remindBills(): Promise<void> {
    const now = new Date();
    const today = dayIndexIST(now);
    const { y, m, d } = istParts(now);

    const perUser = new Map<string, string[]>();
    const stampRecurring: { id: string; due: Date }[] = [];
    const stampLoan: { id: string; emi: Date }[] = [];

    // Recurring bills (rent, subscriptions, SIPs…) by their next due date.
    const recs = await this.prisma.recurringTransaction.findMany({
      where: { isActive: true, user: { notifyBills: true } },
      select: { id: true, name: true, amount: true, nextDueDate: true, lastRemindedDue: true, userId: true },
    });
    for (const r of recs) {
      const delta = dayIndexIST(r.nextDueDate) - today;
      if (delta < 0 || delta > REMIND_WITHIN_DAYS) continue;
      if (r.lastRemindedDue && dayIndexIST(r.lastRemindedDue) === dayIndexIST(r.nextDueDate)) continue;
      addLine(perUser, r.userId, `${r.name} ${inr(r.amount)} ${whenLabel(delta)}`);
      stampRecurring.push({ id: r.id, due: r.nextDueDate });
    }

    // Loan EMIs by their monthly due day (roll to next month once this month's passed).
    const loans = await this.prisma.loan.findMany({
      where: { isActive: true, user: { notifyBills: true } },
      select: { id: true, name: true, emiAmount: true, emiDay: true, lastRemindedEmi: true, userId: true },
    });
    for (const l of loans) {
      let ey = y, em = m;
      if (l.emiDay < d) { em = m + 1; if (em > 11) { em = 0; ey = y + 1; } }
      const delta = Math.floor(Date.UTC(ey, em, l.emiDay) / DAY_MS) - today;
      if (delta < 0 || delta > REMIND_WITHIN_DAYS) continue;
      const emiDate = new Date(Date.UTC(ey, em, l.emiDay) - IST_OFFSET_MS);
      if (l.lastRemindedEmi && l.lastRemindedEmi.getTime() === emiDate.getTime()) continue;
      addLine(perUser, l.userId, `${l.name} EMI ${inr(l.emiAmount)} ${whenLabel(delta)}`);
      stampLoan.push({ id: l.id, emi: emiDate });
    }

    for (const [userId, lines] of perUser) {
      const tokens = await this.notifications.tokensFor([userId]);
      await this.notifications.sendToTokens(tokens, {
        title: `🔔 ${lines.length} upcoming ${lines.length > 1 ? 'bills' : 'bill'}`,
        body: lines.join('\n'),
        data: { type: 'bills' },
      });
    }

    // Stamp as reminded even when the user has no token, so we don't re-check daily.
    await Promise.all([
      ...stampRecurring.map(x => this.prisma.recurringTransaction.update({ where: { id: x.id }, data: { lastRemindedDue: x.due } })),
      ...stampLoan.map(x => this.prisma.loan.update({ where: { id: x.id }, data: { lastRemindedEmi: x.emi } })),
    ]);
  }

  // ── Budgets nearing / over their limit ──
  private async warnBudgets(): Promise<void> {
    const now = new Date();
    // Budgets are calendar-month (matching BudgetsService.getBudgetsWithProgress).
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));

    const budgets = await this.prisma.budget.findMany({
      where: { month: m, year: y, user: { notifyBudgets: true } },
      select: { id: true, amount: true, categoryId: true, lastAlertedPct: true, userId: true, category: { select: { name: true } } },
    });
    if (!budgets.length) return;

    const spentRows = await this.prisma.transaction.groupBy({
      by: ['userId', 'categoryId'],
      where: {
        type: TransactionType.DEBIT,
        date: { gte: start, lte: end },
        userId: { in: [...new Set(budgets.map(b => b.userId))] },
        categoryId: { in: budgets.map(b => b.categoryId) },
      },
      _sum: { amount: true },
    });
    const spent = new Map(spentRows.map(r => [`${r.userId}:${r.categoryId}`, r._sum.amount ?? 0]));

    const perUser = new Map<string, string[]>();
    const stamp: { id: string; pct: number }[] = [];
    for (const b of budgets) {
      if (b.amount <= 0) continue;
      const pct = ((spent.get(`${b.userId}:${b.categoryId}`) ?? 0) / b.amount) * 100;
      const threshold = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
      if (threshold <= b.lastAlertedPct) continue; // already alerted at this level this month
      addLine(perUser, b.userId, `${b.category.name} ${Math.round(pct)}% of ${inr(b.amount)}`);
      stamp.push({ id: b.id, pct: threshold });
    }

    for (const [userId, lines] of perUser) {
      const tokens = await this.notifications.tokensFor([userId]);
      await this.notifications.sendToTokens(tokens, {
        title: `⚠️ ${lines.length} budget${lines.length > 1 ? 's need' : ' needs'} attention`,
        body: lines.join('\n'),
        data: { type: 'budgets' },
      });
    }

    await Promise.all(stamp.map(u => this.prisma.budget.update({ where: { id: u.id }, data: { lastAlertedPct: u.pct } })));
  }
}
