'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { apiFetch } from '@/lib/api';
import CustomSelect from '@/components/CustomSelect';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyReport {
  month: number;
  year: number;
  // Actual date range this "month" covers — shifts when a custom pay-cycle
  // start day is set in Settings.
  period?: { start: string; end: string; startDay: number };
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netSavings: number;
    transactionCount: number;
  };
  topCategories: { category: { name: string; icon: string }; total: number; count: number }[];
  topMerchants: { merchant: string; total: number; count: number }[];
  categoryDeltas: {
    category: { name: string; icon: string };
    current: number;
    previous: number;
    changeAmount: number;
    changePercent: number | null; // null = no spending last month (new)
  }[];
}

interface AnnualReport {
  year: number;
  months: { month: number; income: number; expenses: number; savings: number; savingsRate: number | null }[];
  totals: { income: number; expenses: number; savings: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const BAR_COLORS = [
  '#6366f1', '#f97316', '#06b6d4', '#ef4444', '#22c55e',
  '#ec4899', '#eab308', '#8b5cf6', '#14b8a6', '#f43f5e',
];

const FULL_MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── CSV Download ─────────────────────────────────────────────────────────────
// We can't use apiFetch here because the endpoint returns a file, not JSON.
// Instead we fetch raw bytes, create a Blob, and trigger a browser download.
async function downloadCsv(token: string, month: number, year: number) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(
    `${API_URL}/reports/export?month=${month}&year=${year}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Export failed');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${year}-${String(month).padStart(2, '0')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportView() {
  const { getToken } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [downloading, setDownloading] = useState(false);

  const monthlyQuery = useQuery({
    queryKey: ['report-monthly', month, year],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<MonthlyReport>(`/reports/monthly?month=${month}&year=${year}`, token!);
    },
  });

  const annualQuery = useQuery({
    queryKey: ['report-annual', year],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<AnnualReport>(`/reports/annual?year=${year}`, token!);
    },
  });

  async function handleExport() {
    try {
      setDownloading(true);
      const token = await getToken();
      await downloadCsv(token!, month, year);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  const r = monthlyQuery.data;
  const a = annualQuery.data;
  const maxCategoryTotal = r?.topCategories[0]?.total ?? 1;
  const maxMonthExpense = Math.max(...(a?.months.map(m => m.expenses) ?? [1]));

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex flex-wrap gap-3 items-center">
        <CustomSelect
          value={String(month)}
          onChange={v => setMonth(Number(v))}
          placeholder="Month"
          options={FULL_MONTHS.slice(1).map((name, i) => ({ value: String(i + 1), label: name, icon: '📅' }))}
        />

        <CustomSelect
          value={String(year)}
          onChange={v => setYear(Number(v))}
          placeholder="Year"
          options={[now.getFullYear() - 1, now.getFullYear()].map(y => ({ value: String(y), label: String(y) }))}
        />

        {r?.period && r.period.startDay > 1 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {new Date(r.period.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            {' – '}
            {new Date(r.period.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        )}

        <button
          onClick={handleExport}
          disabled={downloading || !r || r.summary.transactionCount === 0}
          title={r && r.summary.transactionCount === 0 ? 'No transactions this month' : undefined}
          className="ml-auto rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-indigo-200"
        >
          {downloading ? 'Exporting...' : '↓ Export CSV'}
        </button>
      </div>

      {/* Monthly summary cards */}
      {monthlyQuery.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 animate-pulse">
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20 mb-3" />
              <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded w-28" />
            </div>
          ))}
        </div>
      ) : r ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Income" value={formatINR(r.summary.totalIncome)} color="text-white" bg="bg-gradient-to-br from-emerald-500 to-teal-600" />
            <SummaryCard label="Expenses" value={formatINR(r.summary.totalExpenses)} color="text-white" bg="bg-gradient-to-br from-rose-500 to-pink-600" />
            <SummaryCard
              label="Net Savings"
              value={formatINR(r.summary.netSavings)}
              color="text-white"
              bg={r.summary.netSavings >= 0 ? 'bg-gradient-to-br from-violet-500 to-indigo-600' : 'bg-gradient-to-br from-orange-500 to-amber-600'}
            />
            <SummaryCard label="Transactions" value={String(r.summary.transactionCount)} color="text-white" bg="bg-gradient-to-br from-sky-500 to-blue-600" />
          </div>

          {/* The month's bottom line, spelled out as the actual deduction */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatINR(r.summary.totalIncome)} income − {formatINR(r.summary.totalExpenses)} spent
            </p>
            <p className={`mt-1 text-xl font-bold ${r.summary.netSavings >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {r.summary.netSavings >= 0
                ? `= ${formatINR(r.summary.netSavings)} left this month`
                : `= ${formatINR(Math.abs(r.summary.netSavings))} overspent this month`}
            </p>
          </div>
        </>
      ) : null}

      {/* Top categories + Top merchants */}
      {r && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Top categories — horizontal bar chart */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Top Categories</h3>
            {r.topCategories.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No expense data for this month.</p>
            ) : (
              <div className="space-y-4">
                {r.topCategories.map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 dark:text-gray-200">
                        {item.category.icon} {item.category.name}
                        <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">({item.count}×)</span>
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatINR(item.total)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(item.total / maxCategoryTotal) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top merchants */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Top Merchants</h3>
            {r.topMerchants.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No expense data for this month.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {r.topMerchants.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{item.merchant}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{item.count} transactions</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatINR(item.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* What changed vs last month */}
          {(r.categoryDeltas?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 md:col-span-2">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">What Changed vs Last Month</h3>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {r.categoryDeltas.map((d, i) => {
                  const up = d.changeAmount > 0; // rising spend = red
                  return (
                    <div key={i} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {d.category.icon} {d.category.name}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {formatINR(d.previous)} → {formatINR(d.current)}
                        </p>
                      </div>
                      <span className={`text-sm font-bold ${up ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {up ? '▲' : '▼'} {d.changePercent === null ? 'new' : `${Math.abs(d.changePercent)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Annual overview table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">{year} Annual Overview</h3>

        {annualQuery.isLoading ? (
          <div className="h-32 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-xl" />
        ) : a ? (
          <>
            {/* Mini bar chart — income + expenses side-by-side per month */}
            <div className="flex items-end gap-1.5 h-28 mb-3">
              {a.months.map((m) => {
                const maxVal = Math.max(maxMonthExpense, ...a.months.map(x => x.income), 1);
                return (
                  <div key={m.month} className="flex-1 flex items-end justify-center gap-0.5">
                    <div
                      className="w-2/5 bg-gradient-to-t from-emerald-500 to-teal-400 rounded-t"
                      style={{ height: `${(m.income / maxVal) * 100}px` }}
                    />
                    <div
                      className="w-2/5 bg-gradient-to-t from-rose-500 to-pink-400 rounded-t"
                      style={{ height: `${(m.expenses / maxVal) * 100}px` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Month labels */}
            <div className="flex gap-1.5 mb-4">
              {a.months.map(m => (
                <div
                  key={m.month}
                  className={`flex-1 text-center text-xs ${m.month === month ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}
                >
                  {MONTH_NAMES[m.month]}
                </div>
              ))}
            </div>

            {/* Savings-rate trend — % of income kept per month */}
            <div className="mb-4">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Savings rate (% of income kept)</p>
              <div className="flex items-end gap-1.5 h-10">
                {a.months.map(m => {
                  const rate = m.savingsRate;
                  const h = rate === null ? 4 : Math.max((Math.min(Math.max(rate, 0), 100) / 100) * 40, 4);
                  return (
                    <div key={m.month} className="flex-1 flex justify-center">
                      <div
                        className={`w-2/5 rounded-t ${rate === null ? 'bg-gray-100 dark:bg-gray-700' : rate < 0 ? 'bg-rose-400' : 'bg-indigo-500'} ${m.month === month ? '' : 'opacity-50'}`}
                        style={{ height: `${h}px` }}
                        title={rate === null ? 'No income' : `${rate}%`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1.5 mt-1">
                {a.months.map(m => (
                  <div key={m.month} className={`flex-1 text-center text-[10px] ${m.month === month ? 'font-bold text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                    {m.savingsRate === null ? '·' : `${m.savingsRate}%`}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mb-4">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Income</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Expenses</span>
            </div>

            {/* Year totals */}
            <div className="grid grid-cols-3 gap-4 border-t border-gray-100 dark:border-gray-700 pt-4">
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500">Total Income</p>
                <p className="font-semibold text-emerald-600">{formatINR(a.totals.income)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500">Total Expenses</p>
                <p className="font-semibold text-rose-600">{formatINR(a.totals.expenses)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500">Net Savings</p>
                <p className={`font-semibold ${a.totals.savings >= 0 ? 'text-indigo-600' : 'text-orange-600'}`}>
                  {formatINR(a.totals.savings)}
                </p>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, color, bg,
}: {
  label: string; value: string; color: string; bg: string;
}) {
  return (
    <div className={`${bg} rounded-2xl p-5 shadow-lg shadow-black/10`}>
      <p className={`text-xs mb-1 ${color === 'text-white' ? 'text-white/75' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
