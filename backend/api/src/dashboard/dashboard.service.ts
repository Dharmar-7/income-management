import { Injectable } from '@nestjs/common';
import { TransactionType, CashFlow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeStreaks, fetchActiveDays } from '../streaks/streaks.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // Single endpoint that replaces 8 individual API calls on the dashboard.
  // All DB queries run in one Promise.all — wall-clock ≈ slowest single query.
  async getOverview(clerkId: string) {
    const userId = await this.prisma.resolveUserId(clerkId);
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const todayIso = now.toISOString().slice(0, 10);

    // ── Phase 1: 14 queries fired simultaneously ─────────────────────────────
    const [
      summaryGroups,
      catGroups,
      monthRows,
      budgets,
      spendRows,
      cashGroups,
      savAgg,
      nwHistory,
      activeDays,
      txCount,
      savCount,
      budgCount,
      noteCount,
      goals,
    ] = await Promise.all([
      // 1 — summary: group by type for current month
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),
      // 2 — category breakdown (DEBIT only, this month)
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: TransactionType.DEBIT,
          date: { gte: startOfMonth, lte: endOfMonth },
          categoryId: { not: null },
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
      // 3 — monthly trend: raw SQL, last 6 months
      this.prisma.$queryRaw<{ yr: number; mo: number; type: string; total: number }[]>`
        SELECT
          EXTRACT(YEAR  FROM date)::int AS yr,
          EXTRACT(MONTH FROM date)::int AS mo,
          type,
          COALESCE(SUM(amount), 0)      AS total
        FROM "Transaction"
        WHERE "userId" = ${userId}
          AND date >= ${sixMonthsAgo}
          AND type != 'INVESTMENT'
        GROUP BY yr, mo, type
        ORDER BY yr, mo
      `,
      // 4 — budgets for this month
      this.prisma.budget.findMany({
        where: { userId, month, year },
        include: { category: true },
        orderBy: { category: { name: 'asc' } },
      }),
      // 5 — all category spending this month (matched to budgets in code)
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: TransactionType.DEBIT,
          date: { gte: startOfMonth, lte: endOfMonth },
          categoryId: { not: null },
        },
        _sum: { amount: true },
      }),
      // 6 — cash balance: group IN vs OUT
      this.prisma.cashTransaction.groupBy({
        by: ['flow'],
        where: { userId },
        _sum: { amount: true },
      }),
      // 7 — investments aggregate
      this.prisma.saving.aggregate({
        where: { userId },
        _sum: { investedAmount: true, charges: true, currentValue: true },
        _count: true,
      }),
      // 8 — net worth history (last 12 monthly snapshots)
      this.prisma.netWorthSnapshot.findMany({
        where: { userId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 12,
      }),
      // 9-14 — streak + achievement inputs (distinct days computed in the DB)
      fetchActiveDays(this.prisma, userId),
      this.prisma.transaction.count({ where: { userId } }),
      this.prisma.saving.count({ where: { userId } }),
      this.prisma.budget.count({ where: { userId } }),
      this.prisma.note.count({ where: { userId } }),
      this.prisma.goal.findMany({ where: { userId }, select: { savedAmount: true, targetAmount: true } }),
    ]);

    // ── Phase 2: category name enrichment (1 query, depends on catGroups) ───
    const catIds = catGroups.map(g => g.categoryId!).filter(Boolean);
    const categoryDetails = catIds.length
      ? await this.prisma.category.findMany({ where: { id: { in: catIds } } })
      : [];
    const categoryMap = new Map(categoryDetails.map(c => [c.id, c]));

    // ── Compute ──────────────────────────────────────────────────────────────

    // Summary
    const sumByType = (t: TransactionType) =>
      summaryGroups.find(g => g.type === t)?._sum.amount ?? 0;
    const totalIncome = sumByType(TransactionType.CREDIT);
    const totalExpenses = sumByType(TransactionType.DEBIT);
    const totalRefunds = sumByType(TransactionType.REFUND);
    const totalInvestments = sumByType(TransactionType.INVESTMENT);
    const netExpenses = totalExpenses - totalRefunds;

    const summary = {
      month, year,
      totalIncome,
      totalExpenses: netExpenses,
      totalRefunds,
      totalInvestments,
      netSavings: totalIncome - netExpenses,
    };

    // Categories
    const categories = catGroups.map(g => ({
      category: categoryMap.get(g.categoryId!) ?? { name: 'Other', icon: '📦' },
      total: g._sum.amount ?? 0,
    }));

    // Monthly trend
    const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const yr = d.getFullYear();
      const mo = d.getMonth() + 1;
      const inc = monthRows.find(r => r.yr === yr && r.mo === mo && r.type === 'CREDIT');
      const exp = monthRows.find(r => r.yr === yr && r.mo === mo && r.type === 'DEBIT');
      return { month: MON[mo], year: yr, income: Number(inc?.total ?? 0), expenses: Number(exp?.total ?? 0) };
    });

    // Budgets with progress
    const spendByCat = new Map(spendRows.map(r => [r.categoryId, r._sum.amount ?? 0]));
    const budgetData = {
      data: budgets.map(b => {
        const spent = spendByCat.get(b.categoryId) ?? 0;
        return {
          id: b.id, amount: b.amount, month: b.month, year: b.year,
          category: b.category, spent,
          remaining: b.amount - spent,
          percentUsed: b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0,
        };
      }),
      month, year,
    };

    // Cash
    const cashIn  = cashGroups.find(g => g.flow === CashFlow.IN)?._sum.amount  ?? 0;
    const cashOut = cashGroups.find(g => g.flow === CashFlow.OUT)?._sum.amount ?? 0;
    const cash = { balance: cashIn - cashOut, totalIn: cashIn, totalOut: cashOut };

    // Savings / investments
    const totalInvested = savAgg._sum.investedAmount ?? 0;
    const totalCharges  = savAgg._sum.charges        ?? 0;
    const totalNetCost  = totalInvested + totalCharges;
    const totalCurrentValue = savAgg._sum.currentValue ?? 0;
    const totalGainLoss     = totalCurrentValue - totalNetCost;
    const savings = {
      totalNetCost, totalCurrentValue, totalGainLoss,
      totalGainPercent: totalNetCost > 0 ? (totalGainLoss / totalNetCost) * 100 : 0,
      count: savAgg._count,
    };

    // Net worth
    const investments  = totalCurrentValue;
    const netWorthVal  = cash.balance + investments;
    const nwHistorySorted = nwHistory
      .map(s => ({ year: s.year, month: s.month, netWorth: s.netWorth }))
      .reverse();
    const networth = { cash: cash.balance, investments, netWorth: netWorthVal, history: nwHistorySorted };

    // Streaks & achievements
    const { current, longest } = computeStreaks(activeDays, todayIso);
    const goalsReached = goals.filter(g => g.savedAmount >= g.targetAmount).length;

    const achievements = [
      { key: 'first-txn',  title: 'First Step',        icon: '👟', unlocked: txCount  >= 1,   hint: 'Log your first transaction' },
      { key: 'budgeter',   title: 'Budgeter',           icon: '🎯', unlocked: budgCount >= 1,  hint: 'Set your first budget' },
      { key: 'investor',   title: 'Investor',           icon: '📈', unlocked: savCount >= 1,   hint: 'Add your first investment' },
      { key: 'note-taker', title: 'Note Taker',         icon: '📝', unlocked: noteCount >= 1,  hint: 'Write your first note' },
      { key: 'goal-getter',title: 'Goal Getter',        icon: '🏆', unlocked: goalsReached >= 1, hint: 'Reach a savings goal' },
      { key: 'week-streak',title: '7-Day Streak',       icon: '🔥', unlocked: longest >= 7,    hint: 'Log activity 7 days running' },
      { key: 'month-streak',title: '30-Day Streak',     icon: '⚡', unlocked: longest >= 30,   hint: 'Log activity 30 days running' },
      { key: 'portfolio',  title: 'Portfolio Builder',  icon: '💼', unlocked: savCount >= 5,   hint: 'Track 5 investments' },
      { key: 'centurion',  title: 'Centurion',          icon: '💯', unlocked: txCount  >= 100, hint: 'Log 100 transactions' },
    ];

    const streaks = {
      currentStreak: current,
      longestStreak: longest,
      activeToday: activeDays.has(todayIso),
      unlockedCount: achievements.filter(a => a.unlocked).length,
      total: achievements.length,
      achievements,
    };

    return { summary, categories, monthly, budgets: budgetData, cash, savings, networth, streaks };
  }
}
