import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Share,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

interface MonthlyReport {
  month: number;
  year: number;
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

const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

const BAR_COLORS = [
  '#6366f1', '#f97316', '#06b6d4', '#ef4444', '#22c55e',
  '#ec4899', '#eab308', '#8b5cf6',
];

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function ReportsScreen() {
  const { theme: c } = useTheme();
  const { getToken } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
    if (isCurrentMonth) return;
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function handleShare() {
    if (!r) return;
    const lines = [
      `📊 Report — ${FULL_MONTHS[month - 1]} ${year}`,
      '',
      `💰 Income:      ${formatINR(r.summary.totalIncome)}`,
      `💸 Expenses:    ${formatINR(r.summary.totalExpenses)}`,
      `📈 Net Savings: ${formatINR(r.summary.netSavings)}`,
      `🔢 Transactions: ${r.summary.transactionCount}`,
      '',
      'Top Categories:',
      ...r.topCategories.map(c => `  ${c.category.icon} ${c.category.name}: ${formatINR(c.total)} (${c.count}×)`),
      '',
      'Top Merchants:',
      ...r.topMerchants.map((m, i) => `  ${i + 1}. ${m.merchant}: ${formatINR(m.total)}`),
    ];
    Share.share({
      message: lines.join('\n'),
      title: `Velora Report — ${FULL_MONTHS[month - 1]} ${year}`,
    });
  }

  const { data: r, isLoading } = useQuery({
    queryKey: ['report-monthly', month, year],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<MonthlyReport>(`/reports/monthly?month=${month}&year=${year}`, token!);
    },
  });

  const { data: a } = useQuery({
    queryKey: ['report-annual', year],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<AnnualReport>(`/reports/annual?year=${year}`, token!);
    },
  });

  const maxCategory = r?.topCategories[0]?.total ?? 1;
  const maxBar = Math.max(...(a?.months.map(m => Math.max(m.income, m.expenses)) ?? [1]), 1);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >
      {/* Month navigator */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: c.card, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14,
        borderWidth: 1, borderColor: c.cardBorder, marginBottom: 16,
      }}>
        <TouchableOpacity onPress={prevMonth} style={{ padding: 4 }}>
          <Text style={{ fontSize: 22, color: c.primary, fontWeight: '600' }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>
          {FULL_MONTHS[month - 1]} {year}
        </Text>
        <TouchableOpacity onPress={nextMonth} style={{ padding: 4 }}>
          <Text style={{
            fontSize: 22, fontWeight: '600',
            color: (month === now.getMonth() + 1 && year === now.getFullYear()) ? c.textFaint : c.primary,
          }}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Download / share */}
      <TouchableOpacity
        onPress={handleShare}
        disabled={!r}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: r ? c.primary : c.track,
          borderRadius: 14, paddingVertical: 13, marginBottom: 16,
          opacity: r ? 1 : 0.55,
        }}
      >
        <Text style={{ fontSize: 16 }}>↗</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: r ? c.onColor : c.textFaint }}>
          {r ? 'Share Report' : 'No data to share'}
        </Text>
      </TouchableOpacity>

      {isLoading ? (
        <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 48 }} />
      ) : r ? (
        <>
          {/* Summary cards */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <SummaryCard label="Income" value={formatINR(r.summary.totalIncome)} bg={c.success} />
            <SummaryCard label="Expenses" value={formatINR(r.summary.totalExpenses)} bg={c.danger} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            <SummaryCard
              label="Net Savings"
              value={formatINR(r.summary.netSavings)}
              bg={r.summary.netSavings >= 0 ? c.primary : c.orange}
            />
            <SummaryCard label="Transactions" value={String(r.summary.transactionCount)} bg={c.teal} />
          </View>

          {/* Top categories */}
          <View style={{
            backgroundColor: c.card, borderRadius: 16, padding: 16,
            borderWidth: 1, borderColor: c.cardBorder, marginBottom: 16,
          }}>
            <Text style={{ fontWeight: '700', color: c.text, fontSize: 15, marginBottom: 14 }}>
              Top Categories
            </Text>
            {r.topCategories.length === 0 ? (
              <Text style={{ color: c.textFaint, fontSize: 13 }}>No expense data this month.</Text>
            ) : r.topCategories.map((item, i) => (
              <View key={i} style={{ marginBottom: i < r.topCategories.length - 1 ? 14 : 0 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ color: c.text, fontSize: 13 }}>
                    {item.category.icon} {item.category.name}
                    <Text style={{ color: c.textFaint, fontSize: 11 }}> ({item.count}×)</Text>
                  </Text>
                  <Text style={{ fontWeight: '700', color: c.text, fontSize: 13 }}>
                    {formatINR(item.total)}
                  </Text>
                </View>
                <View style={{ height: 7, backgroundColor: c.track, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{
                    width: `${(item.total / maxCategory) * 100}%` as any,
                    height: '100%',
                    backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                    borderRadius: 4,
                  }} />
                </View>
              </View>
            ))}
          </View>

          {/* What changed vs last month */}
          {(r.categoryDeltas?.length ?? 0) > 0 && (
            <View style={{
              backgroundColor: c.card, borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: c.cardBorder, marginBottom: 16,
            }}>
              <Text style={{ fontWeight: '700', color: c.text, fontSize: 15, marginBottom: 4 }}>
                What Changed vs Last Month
              </Text>
              {r.categoryDeltas.map((d, i) => {
                const up = d.changeAmount > 0; // spending increases are the red ones
                return (
                  <View key={i} style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 11,
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.cardBorder,
                  }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', color: c.text, fontSize: 13 }}>
                        {d.category.icon} {d.category.name}
                      </Text>
                      <Text style={{ color: c.textFaint, fontSize: 11, marginTop: 1 }}>
                        {formatINR(d.previous)} → {formatINR(d.current)}
                      </Text>
                    </View>
                    <Text style={{ fontWeight: '800', fontSize: 13, color: up ? c.danger : c.success }}>
                      {up ? '▲' : '▼'} {d.changePercent === null ? 'new' : `${Math.abs(d.changePercent)}%`}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Top merchants */}
          <View style={{
            backgroundColor: c.card, borderRadius: 16, padding: 16,
            borderWidth: 1, borderColor: c.cardBorder, marginBottom: 16,
          }}>
            <Text style={{ fontWeight: '700', color: c.text, fontSize: 15, marginBottom: 4 }}>
              Top Merchants
            </Text>
            {r.topMerchants.length === 0 ? (
              <Text style={{ color: c.textFaint, fontSize: 13, marginTop: 8 }}>No expense data this month.</Text>
            ) : r.topMerchants.map((item, i) => (
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 11,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.cardBorder,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{
                    width: 24, height: 24, borderRadius: 12,
                    backgroundColor: c.track, alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: c.textMuted }}>{i + 1}</Text>
                  </View>
                  <View>
                    <Text style={{ fontWeight: '600', color: c.text, fontSize: 13 }}>
                      {item.merchant}
                    </Text>
                    <Text style={{ color: c.textFaint, fontSize: 11, marginTop: 1 }}>
                      {item.count} transactions
                    </Text>
                  </View>
                </View>
                <Text style={{ fontWeight: '700', color: c.text, fontSize: 13 }}>
                  {formatINR(item.total)}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* Annual overview */}
      {a && (
        <View style={{
          backgroundColor: c.card, borderRadius: 16, padding: 16,
          borderWidth: 1, borderColor: c.cardBorder, marginBottom: 8,
        }}>
          <Text style={{ fontWeight: '700', color: c.text, fontSize: 15, marginBottom: 16 }}>
            {year} Annual Overview
          </Text>

          {/* Mini bar chart */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 72, gap: 3, marginBottom: 6 }}>
            {a.months.map((m) => (
              <View key={m.month} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
                <View style={{
                  flex: 1, height: Math.max((m.income / maxBar) * 72, 2),
                  backgroundColor: c.success, borderRadius: 2,
                }} />
                <View style={{
                  flex: 1, height: Math.max((m.expenses / maxBar) * 72, 2),
                  backgroundColor: c.danger, borderRadius: 2,
                }} />
              </View>
            ))}
          </View>

          {/* Month labels */}
          <View style={{ flexDirection: 'row', gap: 3, marginBottom: 12 }}>
            {a.months.map((m) => (
              <Text key={m.month} style={{
                flex: 1, textAlign: 'center', fontSize: 9,
                color: m.month === month ? c.text : c.textFaint,
                fontWeight: m.month === month ? '700' : '400',
              }}>
                {SHORT_MONTHS[m.month - 1]}
              </Text>
            ))}
          </View>

          {/* Legend */}
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.success }} />
              <Text style={{ fontSize: 11, color: c.textMuted }}>Income</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.danger }} />
              <Text style={{ fontSize: 11, color: c.textMuted }}>Expenses</Text>
            </View>
          </View>

          {/* Savings-rate trend — % of income kept, month by month */}
          <View style={{ borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 12, marginBottom: 14 }}>
            <Text style={{ fontSize: 11, color: c.textFaint, marginBottom: 8 }}>
              Savings rate (% of income kept)
              {(() => {
                const cur = a.months[month - 1]?.savingsRate;
                return cur !== null && cur !== undefined ? ` — ${cur}% in ${FULL_MONTHS[month - 1].slice(0, 3)}` : '';
              })()}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 40, gap: 3 }}>
              {a.months.map(m => {
                const rate = m.savingsRate;
                const h = rate === null ? 2 : Math.max((Math.min(Math.max(rate, 0), 100) / 100) * 40, 2);
                return (
                  <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{
                      width: '70%', height: h, borderRadius: 2,
                      backgroundColor: rate === null ? c.track : rate < 0 ? c.danger : c.primary,
                      opacity: m.month === month ? 1 : 0.55,
                    }} />
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 3, marginTop: 4 }}>
              {a.months.map(m => (
                <Text key={m.month} style={{
                  flex: 1, textAlign: 'center', fontSize: 8,
                  color: m.month === month ? c.text : c.textFaint,
                }}>
                  {m.savingsRate === null ? '·' : `${m.savingsRate}`}
                </Text>
              ))}
            </View>
          </View>

          {/* Year totals */}
          <View style={{
            flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 14,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: c.textFaint }}>Total Income</Text>
              <Text style={{ fontWeight: '700', color: c.success, fontSize: 14, marginTop: 2 }}>
                {formatINR(a.totals.income)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: c.textFaint }}>Total Expenses</Text>
              <Text style={{ fontWeight: '700', color: c.danger, fontSize: 14, marginTop: 2 }}>
                {formatINR(a.totals.expenses)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: c.textFaint }}>Net Savings</Text>
              <Text style={{
                fontWeight: '700', fontSize: 14, marginTop: 2,
                color: a.totals.savings >= 0 ? c.primary : c.orange,
              }}>
                {formatINR(a.totals.savings)}
              </Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function SummaryCard({ label, value, bg }: { label: string; value: string; bg: string }) {
  const { theme: c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: bg, borderRadius: 16, padding: 16 }}>
      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginBottom: 4 }}>{label}</Text>
      <Text
        style={{ color: c.onColor, fontWeight: '800', fontSize: 16 }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}
