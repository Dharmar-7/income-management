import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentCycleWindow } from '../common/pay-cycle';
import { calcSafeToSpend, round2 } from '../common/safe-to-spend.calc';
import { occurrenceInfo, EVENT_ICON } from '../events/events.service';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Bill {
  name: string;
  amount: number;
  date: Date;
  kind: 'EMI' | 'RECURRING';
}

@Injectable()
export class SafeToSpendService {
  constructor(private prisma: PrismaService) {}

  async getSafeToSpend(clerkId: string) {
    const userId = await this.prisma.resolveUserId(clerkId);
    const now = new Date();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { monthStartDay: true, stsBuffer: true, stsDailyTarget: true },
    });
    const startDay = user?.monthStartDay ?? 1;
    const buffer = user?.stsBuffer ?? 0;
    const manualDailyTarget = user?.stsDailyTarget ?? null;

    const { month, year, start, end, totalDays, dayIndex } = currentCycleWindow(now, startDay);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [creditAgg, spentGroups, todayGroups, loans, recurring, events] = await Promise.all([
      // Income received across the whole cycle (salary may land any day in it).
      this.prisma.transaction.aggregate({
        where: { userId, type: TransactionType.CREDIT, date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      // Spend so far this cycle (DEBIT − REFUND). INVESTMENT/TRANSFER excluded by type.
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: {
          userId,
          type: { in: [TransactionType.DEBIT, TransactionType.REFUND] },
          date: { gte: start, lte: now },
        },
        _sum: { amount: true },
      }),
      // Spend today.
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: {
          userId,
          type: { in: [TransactionType.DEBIT, TransactionType.REFUND] },
          date: { gte: todayStart, lte: now },
        },
        _sum: { amount: true },
      }),
      // Active loans → EMI obligations that fall in this cycle.
      this.prisma.loan.findMany({
        where: { userId, isActive: true },
        include: { payments: { select: { id: true } } },
      }),
      // Active recurring EXPENSE bills (salary/SIP handled elsewhere).
      this.prisma.recurringTransaction.findMany({
        where: { userId, isActive: true, type: TransactionType.DEBIT },
      }),
      // Occasions — for the "just remind me" heads-up next to the card.
      this.prisma.event.findMany({ where: { userId } }),
    ]);

    const sumType = (groups: { type: TransactionType; _sum: { amount: number | null } }[], t: TransactionType) =>
      groups.find(g => g.type === t)?._sum.amount ?? 0;

    const income = creditAgg._sum.amount ?? 0;
    const netSpentSoFar = Math.max(0, sumType(spentGroups, TransactionType.DEBIT) - sumType(spentGroups, TransactionType.REFUND));
    const netSpentToday = Math.max(0, sumType(todayGroups, TransactionType.DEBIT) - sumType(todayGroups, TransactionType.REFUND));

    // ── Bills scheduled inside this cycle window ──────────────────────────────
    const bills: Bill[] = [];
    for (const loan of loans) {
      if (loan.tenure - loan.payments.length <= 0) continue; // fully paid
      const date = this.scheduledDayInWindow(loan.emiDay, start, end);
      if (date) bills.push({ name: `EMI · ${loan.name}`, amount: loan.emiAmount, date, kind: 'EMI' });
    }
    for (const rec of recurring) {
      const date = this.recurringDateInWindow(rec, start, end);
      if (date) bills.push({ name: rec.name, amount: rec.amount, date, kind: 'RECURRING' });
    }

    const allCycleBills = bills.reduce((s, b) => s + b.amount, 0);
    const upcoming = bills
      .filter(b => b.date >= todayStart)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const upcomingBills = upcoming.reduce((s, b) => s + b.amount, 0);

    const calc = calcSafeToSpend({
      income, buffer, manualDailyTarget,
      allCycleBills, upcomingBills, netSpentSoFar, netSpentToday,
      totalDays, dayIndex,
    });

    // ── Upcoming occasions (reminders only, no money reserved) ────────────────
    const upcomingEvents = events
      .map(e => ({ info: occurrenceInfo(e.date, now), e }))
      .filter(x => x.info.daysUntil >= 0 && x.info.daysUntil <= 40)
      .sort((a, b) => a.info.daysUntil - b.info.daysUntil)
      .slice(0, 5)
      .map(x => ({
        title: x.e.title,
        icon: EVENT_ICON[x.e.type],
        personName: x.e.personName,
        date: x.info.next.toISOString(),
        daysUntil: x.info.daysUntil,
        isToday: x.info.isToday,
      }));

    return {
      currency: 'INR',
      cycle: {
        month, year,
        label: MONTHS[month],
        start: start.toISOString(),
        end: end.toISOString(),
        totalDays,
        dayIndex,
        daysLeft: calc.daysLeft,
      },
      ...calc,
      income: round2(income),
      buffer: round2(buffer),
      manualDailyTarget,
      reservedBills: round2(upcomingBills),
      bills: upcoming.slice(0, 6).map(b => ({ ...b, date: b.date.toISOString() })),
      upcomingEvents,
    };
  }

  // A date whose day-of-month === `day` falling inside [start, end]. A pay cycle
  // spans at most two calendar months, so at most one candidate matches.
  private scheduledDayInWindow(day: number, start: Date, end: Date): Date | null {
    const candidates = [
      new Date(start.getFullYear(), start.getMonth(), day),
      new Date(end.getFullYear(), end.getMonth(), day),
    ];
    for (const d of candidates) {
      if (d >= start && d <= end) return d;
    }
    return null;
  }

  private recurringDateInWindow(
    rec: { frequency: string; dayOfMonth: number | null; nextDueDate: Date },
    start: Date,
    end: Date,
  ): Date | null {
    if (rec.frequency === 'MONTHLY') {
      const day = rec.dayOfMonth ?? rec.nextDueDate.getDate();
      return this.scheduledDayInWindow(day, start, end);
    }
    // WEEKLY/YEARLY: count a single occurrence if its next due date lands in-cycle.
    const due = new Date(rec.nextDueDate);
    return due >= start && due <= end ? due : null;
  }
}
