import { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { canAfford, cashflowBasics, sipNeeded, suggestedReturn, comparePayoff, type AffordMode } from '@/lib/brain/planners';
import { inr } from '@/lib/brain/core';
import type { BrainData } from '@/lib/brain/useBrainData';
import { Card, Muted, Faint, Big, ListRow, Pill, PillRow, NumberField, FieldLabel, Empty, toNum, useBrainStyles } from './ui';

// 🧮 Planners — "can I afford it?", a goal planner, and a loan payoff comparison.

type Tool = 'afford' | 'goal' | 'loans';

export default function PlannersPanel({ data }: { data: BrainData }) {
  const [tool, setTool] = useState<Tool>('afford');
  return (
    <View style={{ gap: 12 }}>
      <PillRow>
        <Pill label="🛒 Can I afford it?" active={tool === 'afford'} onPress={() => setTool('afford')} />
        <Pill label="🎯 Goal planner" active={tool === 'goal'} onPress={() => setTool('goal')} />
        <Pill label="🏦 Loan payoff" active={tool === 'loans'} onPress={() => setTool('loans')} />
      </PillRow>
      {tool === 'afford' && <Afford data={data} />}
      {tool === 'goal' && <Goal data={data} />}
      {tool === 'loans' && <Loans data={data} />}
    </View>
  );
}

// ─── Can I afford it? ────────────────────────────────────────────────────────

const VERDICT_ICON = { yes: '✅', maybe: '🟡', stretch: '🟠', no: '🔴' } as const;

function Afford({ data }: { data: BrainData }) {
  const { c } = useBrainStyles();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<AffordMode>('once');
  const basics = useMemo(() => cashflowBasics(data.txs, new Date()), [data.txs]);
  const existingEmi = data.loans.reduce((s, l) => s + l.emiAmount, 0);

  const value = toNum(amount);
  const result = value > 0
    ? canAfford({ amount: value, mode, basics, emergencyFund: data.safety.fund, essentialMonthly: data.safety.essentialMonthly, existingEmi })
    : null;
  const color = result ? { yes: c.success, maybe: c.warning, stretch: c.orange, no: c.danger }[result.verdict] : c.text;

  return (
    <Card title="🛒 Can I afford it?">
      <PillRow>
        <Pill label="One-time purchase" active={mode === 'once'} onPress={() => setMode('once')} />
        <Pill label="Monthly (EMI / plan)" active={mode === 'monthly'} onPress={() => setMode('monthly')} />
      </PillRow>
      <NumberField label={mode === 'once' ? 'Price (₹)' : 'Monthly amount (₹)'} value={amount} onChange={setAmount} placeholder={mode === 'once' ? 'e.g. 50000' : 'e.g. 3000'} />
      {result ? (
        <View style={styles.result}>
          <Text style={[styles.verdict, { color }]}>{VERDICT_ICON[result.verdict]} {result.headline}</Text>
          {result.points.map((p, i) => <Muted key={i}>• {p}</Muted>)}
        </View>
      ) : (
        <Faint>Uses your average income and spending over the last 3 complete months, plus your Safety Net emergency fund.</Faint>
      )}
    </Card>
  );
}

// ─── Goal planner ────────────────────────────────────────────────────────────

const RETURN_CHOICES = [6, 8, 10, 12];

function Goal({ data }: { data: BrainData }) {
  const [goalId, setGoalId] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [months, setMonths] = useState('');
  const [ret, setRet] = useState<number | null>(null);

  function pick(id: string) {
    const g = data.goals.find(x => x.id === id);
    if (!g) return;
    setGoalId(id);
    setTarget(String(Math.round(g.targetAmount)));
    setSaved(String(Math.round(g.savedAmount)));
    if (g.targetDate) {
      const m = Math.max(1, Math.ceil((Date.parse(g.targetDate) - Date.now()) / (30.4375 * 86_400_000)));
      setMonths(String(m));
    }
    setRet(null);
  }

  const t = toNum(target), s = toNum(saved), n = Math.round(toNum(months));
  const rate = ret ?? (n > 0 ? suggestedReturn(n) : 8);
  const plan = t > 0 && n > 0 ? sipNeeded(t, s, n, rate) : null;

  return (
    <Card title="🎯 Goal planner">
      {data.goals.length > 0 && (
        <>
          <Faint>Start from one of your goals:</Faint>
          <PillRow>
            {data.goals.map(g => <Pill key={g.id} label={`${g.icon} ${g.name}`} active={goalId === g.id} onPress={() => pick(g.id)} />)}
          </PillRow>
        </>
      )}
      <NumberField label="Target amount (₹)" value={target} onChange={v => { setTarget(v); setGoalId(null); }} placeholder="e.g. 500000" />
      <NumberField label="Already saved (₹)" value={saved} onChange={v => { setSaved(v); setGoalId(null); }} />
      <NumberField label="Months to go" value={months} onChange={v => { setMonths(v); setGoalId(null); }} placeholder="e.g. 36" />
      <FieldLabel>Expected return / year</FieldLabel>
      <PillRow>
        {RETURN_CHOICES.map(r => <Pill key={r} label={`${r}%`} active={rate === r && ret != null} onPress={() => setRet(r)} />)}
      </PillRow>
      {ret == null && n > 0 && <Faint>Using {rate}%, a conservative figure for a {n}-month horizon. Tap to change.</Faint>}

      {plan && (
        <View style={styles.result}>
          {plan.onTrack ? (
            <Text style={styles.verdict}>✅ You're on track. What you've saved should grow to {inr(plan.currentGrowsTo)}.</Text>
          ) : (
            <>
              <Big>{inr(plan.monthly)}<Text style={styles.per}>/month</Text></Big>
              <Muted>invested every month at {rate}% a year reaches {inr(t)} in {n} months.</Muted>
              <Muted>Without any returns you'd need {inr(plan.withoutReturns)}/month, so returns save you {inr(Math.max(0, plan.withoutReturns - plan.monthly))} a month.</Muted>
            </>
          )}
          <Faint>Returns aren't guaranteed. Equity can fall in the short run, so for goals under 3 years prefer safer options (see the Investment Coach).</Faint>
        </View>
      )}
    </Card>
  );
}

// ─── Loan payoff ─────────────────────────────────────────────────────────────

const EXTRA_CHOICES = [0, 1000, 2000, 5000, 10000];

function Loans({ data }: { data: BrainData }) {
  const { c } = useBrainStyles();
  const router = useRouter();
  const [extra, setExtra] = useState(2000);
  const states = useMemo(
    () => data.loans.map(l => ({ id: l.id, name: l.name, balance: l.outstandingBalance, rate: l.interestRate, emi: l.emiAmount })),
    [data.loans],
  );
  const cmp = useMemo(() => (states.length ? comparePayoff(states, extra) : null), [states, extra]);

  if (!cmp) {
    return (
      <Card title="🏦 Loan payoff">
        <Empty emoji="🎉" text="No active loans. Nothing to pay off." action="Open Loans" onPress={() => router.push('/(tabs)/loans')} />
      </Card>
    );
  }

  const best = cmp[cmp.best];
  const yrs = (m: number) => (m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m}m`);

  return (
    <Card title="🏦 Loan payoff">
      <FieldLabel>Extra you can pay each month</FieldLabel>
      <PillRow>
        {EXTRA_CHOICES.map(e => <Pill key={e} label={e === 0 ? 'None' : `+${inr(e)}`} active={extra === e} onPress={() => setExtra(e)} />)}
      </PillRow>

      {cmp.minimum.stuck && <Text style={[styles.verdict, { color: c.danger }]}>⚠️ One loan's EMI doesn't cover its interest, so it never finishes at this rate.</Text>}

      <ListRow label="EMIs only" value={yrs(cmp.minimum.months)} sub={`Total interest ${inr(cmp.minimum.totalInterest)}`} />
      {extra > 0 && (
        <>
          <ListRow label={`Avalanche (highest rate first)${cmp.best === 'avalanche' ? ' ⭐' : ''}`} value={yrs(cmp.avalanche.months)} sub={`Total interest ${inr(cmp.avalanche.totalInterest)}`} valueColor={c.success} />
          <ListRow label={`Snowball (smallest loan first)${cmp.best === 'snowball' ? ' ⭐' : ''}`} value={yrs(cmp.snowball.months)} sub={`Total interest ${inr(cmp.snowball.totalInterest)}`} />
          <View style={styles.result}>
            <Text style={[styles.verdict, { color: c.success }]}>
              Paying {inr(extra)} extra saves {inr(cmp.interestSaved)} in interest and makes you debt-free {yrs(cmp.monthsSaved)} sooner.
            </Text>
            <Muted>Order ({cmp.best}): {best.order.map(o => `${o.name} (month ${o.month})`).join(' → ')}</Muted>
            <Faint>Avalanche saves the most money. Snowball clears small loans first for quicker wins. When freed EMIs roll into the next loan, both get faster.</Faint>
          </View>
        </>
      )}
      <Faint>Based on each loan's outstanding balance, rate and EMI from your Loans. Check prepayment charges with your lender.</Faint>
    </Card>
  );
}

const styles = StyleSheet.create({
  result: { gap: 6, paddingTop: 4 },
  verdict: { fontSize: 14.5, fontWeight: '800', lineHeight: 20 },
  per: { fontSize: 15, fontWeight: '600' },
});
