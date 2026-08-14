import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType } from '@prisma/client';
// Pay-cycle "money month" windows — shared with Safe-to-Spend so they agree.
import { monthWindow, currentCycle } from '../common/pay-cycle';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  private async getMonthStartDay(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { monthStartDay: true },
    });
    return user?.monthStartDay ?? 1;
  }

  // ─── Monthly Report ──────────────────────────────────────────────────────────
  // Returns a rich breakdown for a single month: summary, top categories, top merchants
  async getMonthlyReport(clerkId: string, month?: number, year?: number) {
    const userId = await this.resolveUserId(clerkId);
    const startDay = await this.getMonthStartDay(userId);
    const cur = currentCycle(new Date(), startDay);
    const m = month ?? cur.month;
    const y = year ?? cur.year;

    const { start, end } = monthWindow(y, m, startDay);
    // Previous cycle window — for the month-over-month category deltas.
    const { start: prevStart, end: prevEnd } = monthWindow(y, m - 1, startDay);

    // Run all queries in parallel for speed
    const [income, expenses, txCount, categoryGroups, merchantGroups, curCatAll, prevCatAll] = await Promise.all([
      // Total income
      this.prisma.transaction.aggregate({
        where: { userId, type: TransactionType.CREDIT, date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      // Total expenses
      this.prisma.transaction.aggregate({
        where: { userId, type: TransactionType.DEBIT, date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      // Total transaction count
      this.prisma.transaction.count({
        where: { userId, date: { gte: start, lte: end } },
      }),
      // Group expenses by category
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: TransactionType.DEBIT,
          date: { gte: start, lte: end },
          categoryId: { not: null },
        },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      // Group expenses by merchant
      this.prisma.transaction.groupBy({
        by: ['merchant'],
        where: { userId, type: TransactionType.DEBIT, date: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      // Full per-category spend, this month + previous month (for deltas —
      // the top-5 list above can't compute changes for categories outside it)
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: TransactionType.DEBIT, date: { gte: start, lte: end }, categoryId: { not: null } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: TransactionType.DEBIT, date: { gte: prevStart, lte: prevEnd }, categoryId: { not: null } },
        _sum: { amount: true },
      }),
    ]);

    // Enrich category groups with category details (top-5 + every delta id)
    const categoryIds = [
      ...new Set([
        ...categoryGroups.map(g => g.categoryId!),
        ...curCatAll.map(g => g.categoryId!),
        ...prevCatAll.map(g => g.categoryId!),
      ]),
    ].filter(Boolean);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
    });
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    // Month-over-month movers: join current & previous by category, keep the
    // biggest absolute changes. changePercent is null for brand-new spending.
    const prevByCat = new Map(prevCatAll.map(g => [g.categoryId, g._sum.amount ?? 0]));
    const curByCat = new Map(curCatAll.map(g => [g.categoryId, g._sum.amount ?? 0]));
    const allCatIds = new Set([...prevByCat.keys(), ...curByCat.keys()]);
    const categoryDeltas = [...allCatIds]
      .map(id => {
        const current = curByCat.get(id) ?? 0;
        const previous = prevByCat.get(id) ?? 0;
        return {
          category: categoryMap.get(id!) ?? { name: 'Other', icon: '📦' },
          current,
          previous,
          changeAmount: current - previous,
          changePercent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
        };
      })
      .filter(d => Math.abs(d.changeAmount) >= 1)
      .sort((a, b) => Math.abs(b.changeAmount) - Math.abs(a.changeAmount))
      .slice(0, 5);

    const totalIncome = income._sum.amount ?? 0;
    const totalExpenses = expenses._sum.amount ?? 0;

    return {
      month: m,
      year: y,
      // The actual date range this "month" covers — differs from the calendar
      // month when the user sets a custom monthStartDay. UIs show it so the
      // cycle is never a mystery.
      period: { start: start.toISOString(), end: end.toISOString(), startDay },
      summary: {
        totalIncome,
        totalExpenses,
        netSavings: totalIncome - totalExpenses,
        transactionCount: txCount,
      },
      topCategories: categoryGroups.map(g => ({
        category: categoryMap.get(g.categoryId!) ?? { name: 'Other', icon: '📦' },
        total: g._sum.amount ?? 0,
        count: g._count,
      })),
      topMerchants: merchantGroups.map(g => ({
        merchant: g.merchant,
        total: g._sum.amount ?? 0,
        count: g._count,
      })),
      categoryDeltas,
    };
  }

  // ─── Annual Report ───────────────────────────────────────────────────────────
  // Single raw SQL query instead of 24 separate aggregate calls (12 months × 2 types).
  async getAnnualReport(clerkId: string, year?: number) {
    const userId = await this.resolveUserId(clerkId);
    const y = year ?? new Date().getFullYear();
    const startOfYear = new Date(y, 0, 1);
    const endOfYear = new Date(y, 11, 31, 23, 59, 59);

    const rows = await this.prisma.$queryRaw<
      { mo: number; type: string; total: number }[]
    >`
      SELECT
        EXTRACT(MONTH FROM date)::int AS mo,
        type,
        COALESCE(SUM(amount), 0)      AS total
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND date >= ${startOfYear}
        AND date <= ${endOfYear}
      GROUP BY mo, type
      ORDER BY mo
    `;

    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const inc = Number(rows.find(r => r.mo === m && r.type === 'CREDIT')?.total ?? 0);
      const exp = Number(rows.find(r => r.mo === m && r.type === 'DEBIT')?.total ?? 0);
      return {
        month: m,
        income: inc,
        expenses: exp,
        savings: inc - exp,
        // % of income kept that month — the savings-rate trend line.
        savingsRate: inc > 0 ? Math.round(((inc - exp) / inc) * 100) : null,
      };
    });

    const totals = months.reduce(
      (acc, m) => ({
        income: acc.income + m.income,
        expenses: acc.expenses + m.expenses,
        savings: acc.savings + m.savings,
      }),
      { income: 0, expenses: 0, savings: 0 },
    );

    return { year: y, months, totals };
  }

  // ─── CSV Export ──────────────────────────────────────────────────────────────
  // Returns a CSV string of all transactions in a given month (or all time)
  async generateCsv(clerkId: string, month?: number, year?: number): Promise<string> {
    const userId = await this.resolveUserId(clerkId);

    // Build date filter only if month/year are provided — same pay-cycle
    // window as the monthly report so the CSV matches what's on screen.
    const startDay = await this.getMonthStartDay(userId);
    const cur = currentCycle(new Date(), startDay);
    const m = month ?? cur.month;
    const y = year ?? cur.year;
    const { start, end } = monthWindow(y, m, startDay);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(month || year ? { date: { gte: start, lte: end } } : {}),
      },
      include: { category: true },
      orderBy: { date: 'desc' },
    });

    // Build CSV — escape commas and quotes in text fields
    const escape = (val: string | null | undefined) => {
      if (!val) return '';
      const str = String(val);
      // Wrap in quotes if the value contains a comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = 'Date,Merchant,Type,Category,Amount,Description';

    const rows = transactions.map(tx =>
      [
        tx.date.toISOString().split('T')[0],   // YYYY-MM-DD
        escape(tx.merchant),
        tx.type,
        escape(tx.category?.name ?? 'Uncategorized'),
        tx.amount.toFixed(2),
        escape(tx.description),
      ].join(','),
    );

    return [header, ...rows].join('\n');
  }
}
