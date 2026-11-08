import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { buildInsights } from '@/lib/brain/insights';
import { paceTitle } from '@/lib/brain/ask';
import { inr, shortDate } from '@/lib/brain/core';
import type { BrainData } from '@/lib/brain/useBrainData';
import { Card, Muted, Faint, Big, ListRow, Empty, useBrainStyles } from './ui';

// 💡 Insights — what your own numbers say this month. Each card only appears
// when there's enough data behind it.

export default function InsightsPanel({ data }: { data: BrainData }) {
  const { c } = useBrainStyles();
  const router = useRouter();
  const m = useMemo(() => buildInsights(data.txs, data.categories, new Date()), [data.txs, data.categories]);

  if (!m.hasData) {
    return (
      <Card>
        <Empty
          emoji="📥" text="No transactions yet. Import a statement or add a few and your insights will appear here."
          action="Import a statement" onPress={() => router.push('/(tabs)/import')}
        />
      </Card>
    );
  }

  const maxSpend = Math.max(...m.series.map(x => x.spend), 1);
  const ratePct = m.lastMonthSavings?.rate;

  return (
    <View style={{ gap: 12 }}>
      {/* This month + pace */}
      <Card title={`📍 ${m.thisMonth.label}`}>
        <Big>{inr(m.thisMonth.spend)}</Big>
        <Muted>spent so far this month</Muted>
        {m.pace && (
          <View style={styles.paceBox}>
            <Text style={[styles.paceTitle, { color: m.pace.pacePct > 110 ? c.warning : m.pace.pacePct < 90 ? c.success : c.text }]}>
              {paceTitle(m.pace.pacePct)}
            </Text>
            <Muted>
              By day {m.pace.day} you usually spend {inr(m.pace.usualByToday)}. Expect about {inr(m.pace.forecast)} by month-end (usual {inr(m.pace.usualMonth)}).
            </Muted>
            {m.pace.bigOneOff && <Faint>Mostly one purchase: {m.pace.bigOneOff.merchant}, {inr(m.pace.bigOneOff.amount)}.</Faint>}
            {m.pace.early && <Faint>Early in the month, so this is a rough guide.</Faint>}
          </View>
        )}
        {m.thisMonth.topCategories.length > 0 && (
          <View style={{ gap: 2 }}>
            {m.thisMonth.topCategories.map(t => (
              <ListRow key={t.category.id} label={`${t.category.icon} ${t.category.name}`} value={inr(t.amount)} sub={`${t.count} transaction${t.count === 1 ? '' : 's'}`} />
            ))}
          </View>
        )}
      </Card>

      {/* 6-month trend */}
      <Card title="📊 Last 6 months">
        <View style={styles.chart}>
          {m.series.map(x => (
            <View key={x.label} style={styles.col}>
              <View style={styles.barWrap}>
                <View style={[styles.bar, { height: `${Math.max(3, (x.spend / maxSpend) * 100)}%`, backgroundColor: x.hasData ? c.primary : c.track }]} />
              </View>
              <Text style={[styles.colLabel, { color: c.textFaint }]}>{x.short}</Text>
            </View>
          ))}
        </View>
        <Faint>Monthly spending (debits minus refunds). Investments and transfers aren't counted.</Faint>
      </Card>

      {/* Savings rate */}
      {m.lastMonthSavings && ratePct != null && (
        <Card title={`💰 Savings rate, ${m.lastMonthSavings.label}`}>
          <Big color={ratePct >= 20 ? c.success : ratePct >= 0 ? c.warning : c.danger}>{Math.round(ratePct)}%</Big>
          <Muted>
            Earned {inr(m.lastMonthSavings.income)}, spent {inr(m.lastMonthSavings.spend)}: {m.lastMonthSavings.saved >= 0 ? 'kept' : 'overspent by'} {inr(Math.abs(m.lastMonthSavings.saved))}.
            {m.avgSavingsRate != null ? ` Your 3-month average is ${Math.round(m.avgSavingsRate)}%.` : ''}
          </Muted>
          <Faint>{ratePct >= 20 ? '20%+ is a strong habit. 👍' : 'Aim for 20%+ of income if you can.'}</Faint>
        </Card>
      )}

      {/* Category changes */}
      {m.changes.changes.length > 0 && (
        <Card title={`📈 What changed in ${m.changes.monthLabel}`}>
          {m.changes.changes.map(ch => (
            <ListRow
              key={ch.category.id}
              label={`${ch.category.icon} ${ch.category.name}`}
              value={`${ch.diff > 0 ? '+' : '−'}${inr(Math.abs(ch.diff))}`}
              valueColor={ch.diff > 0 ? c.danger : c.success}
              sub={ch.changePct == null
                ? `${inr(ch.last)}, new this month`
                : `${inr(ch.last)} vs usual ${inr(ch.usual)} (${ch.changePct > 0 ? '+' : ''}${Math.round(ch.changePct)}%)`}
            />
          ))}
          <Faint>Compared with your average of the months before.</Faint>
        </Card>
      )}

      {/* Unusual spends */}
      <Card title="🔍 Unusual spends (last 30 days)">
        {m.unusual.length === 0 ? (
          <Muted>Nothing stood out against your history. ✅</Muted>
        ) : m.unusual.map(u => (
          <ListRow key={u.tx.id} label={`${u.tx.merchant} · ${shortDate(u.tx.date)}`} value={inr(u.tx.amount)} sub={u.reason} />
        ))}
      </Card>

      {/* Repeating charges */}
      <Card title="🔁 Repeating monthly charges">
        {m.repeats.items.length === 0 ? (
          <Muted>No steady monthly charges found yet. They show up after 3+ months of history.</Muted>
        ) : (
          <>
            <Muted>
              {m.repeats.items.length} charge{m.repeats.items.length === 1 ? '' : 's'} ≈ {inr(m.repeats.monthlyTotal)}/month ({inr(m.repeats.monthlyTotal * 12)}/year). Cancel any you don't use.
            </Muted>
            {m.repeats.items.map(r => (
              <ListRow
                key={r.merchant + r.lastDate}
                label={r.merchant}
                value={`${inr(r.monthly)}/mo`}
                valueColor={r.priceUp ? c.danger : undefined}
                sub={r.priceUp && r.prevAmount != null ? `⬆️ Price went up from ${inr(r.prevAmount)}` : `Last paid ${shortDate(r.lastDate)} · ${r.count} times`}
              />
            ))}
          </>
        )}
      </Card>

      {data.truncated && <Faint>Showing your most recent 5,000 transactions.</Faint>}
    </View>
  );
}

const styles = StyleSheet.create({
  paceBox: { gap: 4, paddingTop: 4 },
  paceTitle: { fontSize: 14.5, fontWeight: '800' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 8 },
  col: { flex: 1, alignItems: 'center', height: '100%' },
  barWrap: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  colLabel: { fontSize: 11, marginTop: 4, fontWeight: '600' },
});
