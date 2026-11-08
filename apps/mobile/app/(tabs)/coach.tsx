import { useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScrollToTop } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter, type Href } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import type { Theme } from '@/lib/theme';
import { SkeletonList } from '@/components/Skeleton';
import { hSelect, hSuccess } from '@/lib/haptics';
import { useSafetyNet } from '@/lib/safetyNet';
import { useMoneyProfile } from '@/lib/moneyProfile';
import {
  checkPortfolio, readinessSteps, planGoals, calendarFor, calendarContext, inr, LEARN,
  type SavingInput, type LoanInput, type GoalInput, type MoneyProfile, type Risk, type TaxRegime,
  type StepStatus, type CalendarItem,
} from '@/lib/investCoach';

// The Investment Coach: an on-device, rules-and-maths investing guide. Reads the
// same cached data as Savings / Loans / Safety Net (no new server calls when
// those screens were opened) — see lib/investCoach.ts for the logic.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const FY_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]; // Indian financial year

const STATUS_ICON: Record<StepStatus, string> = { done: '✅', partial: '🟡', todo: '⭕', unknown: '❔' };

export default function CoachScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const { profile, update, isSetUp } = useMoneyProfile();
  const [editing, setEditing] = useState(false);
  const safety = useSafetyNet();

  // Same query keys as the Savings and Loans screens, so the cache is shared.
  const savingsQ = useQuery<SavingInput[]>({
    queryKey: ['savings-list'],
    queryFn: async () => apiFetch<SavingInput[]>('/savings', (await getToken())!),
    staleTime: 2 * 60 * 1000,
  });
  const loansQ = useQuery<LoanInput[]>({
    queryKey: ['loans'],
    queryFn: async () => apiFetch<LoanInput[]>('/loans', (await getToken())!),
    staleTime: 2 * 60 * 1000,
  });
  const goalsQ = useQuery<GoalInput[]>({
    queryKey: ['goals'],
    queryFn: async () => apiFetch<GoalInput[]>('/goals', (await getToken())!),
    staleTime: 2 * 60 * 1000,
  });

  const savings = savingsQ.data ?? [];
  const loans = loansQ.data ?? [];
  const goals = goalsQ.data ?? [];

  const portfolio = useMemo(() => checkPortfolio(savings, profile), [savings, profile]);
  const steps = useMemo(
    () => readinessSteps({ survivalMonths: safety.survivalMonths, loans, profile, savings }),
    [safety.survivalMonths, loans, profile, savings],
  );
  const goalPlans = useMemo(() => planGoals(goals), [goals]);
  const ctx = useMemo(() => calendarContext(savings, profile), [savings, profile]);

  const loading = savingsQ.isLoading || loansQ.isLoading || goalsQ.isLoading;
  const refreshing = savingsQ.isFetching || loansQ.isFetching || goalsQ.isFetching || safety.refreshing;

  function refresh() {
    savingsQ.refetch(); loansQ.refetch(); goalsQ.refetch(); safety.refetch();
  }

  const go = (href: string) => router.push(href as Href);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}
      >
        <View>
          <Text style={styles.h1}>🧭 Investment Coach</Text>
          <Text style={styles.sub}>Rules and maths, not predictions. Educational, not investment advice.</Text>
        </View>

        {!isSetUp || editing ? (
          <ProfileEditor
            initial={profile}
            styles={styles}
            c={c}
            onSave={async next => { await update(next); setEditing(false); }}
            onCancel={isSetUp ? () => setEditing(false) : undefined}
          />
        ) : (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>👤 Your money profile</Text>
              <TouchableOpacity onPress={() => setEditing(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.link}>Edit</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.muted}>
              Age {profile.age} · {cap(profile.risk)} risk · {cap(profile.regime)} tax regime
            </Text>
          </View>
        )}

        {loading ? <SkeletonList count={3} /> : (
          <>
            {/* 1 · Readiness */}
            <Section n={1} title="Are you ready to invest?" styles={styles} />
            <ReadinessCard steps={steps} styles={styles} onOpen={go} />

            {/* 2 · Portfolio */}
            <Section n={2} title="Your investment mix" styles={styles} />
            {portfolio.hasHoldings ? (
              <View style={styles.card}>
                <Text style={styles.muted}>Total invested value: <Text style={styles.strong}>{inr(portfolio.allocation.total)}</Text></Text>
                <AllocationRow label="Equity" actual={portfolio.allocation.pct.equity} target={portfolio.target.equity} color={c.primary} styles={styles} />
                <AllocationRow label="Debt" actual={portfolio.allocation.pct.debt} target={portfolio.target.debt} color={c.teal} styles={styles} />
                <AllocationRow label="Gold" actual={portfolio.allocation.pct.gold} target={portfolio.target.gold} color={c.warning} styles={styles} />
                {!isSetUp && <Text style={styles.faint}>Target uses a default. Set your age above for a personal one.</Text>}
                <View style={styles.msgs}>
                  {portfolio.messages.map((m, i) => (
                    <Text key={i} style={styles.msg}>
                      {m.tone === 'good' ? '✅' : m.tone === 'warn' ? '⚠️' : '💡'}  {m.text}
                    </Text>
                  ))}
                </View>
                {portfolio.assumptions.map((a, i) => <Text key={i} style={styles.faint}>• {a}</Text>)}
                <Text style={styles.faint}>
                  Target = "100 minus age" in equity, adjusted for your risk comfort, with 10% gold. A common rule of thumb, not a prescription.
                </Text>
              </View>
            ) : (
              <EmptyCard
                text="No investments added yet. Add them in Savings to see your mix against your target."
                action="Open Savings" onPress={() => go('/(tabs)/savings')} styles={styles}
              />
            )}

            {/* 3 · Goals */}
            <Section n={3} title="Your goals" styles={styles} />
            {goalPlans.length > 0 ? (
              <View style={styles.card}>
                {goalPlans.map((p, i) => (
                  <View key={p.goal.id} style={[styles.goal, i > 0 && styles.divider]}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.goalName}>{p.goal.icon} {p.goal.name}</Text>
                      {p.remaining > 0 && <Text style={styles.goalAmt}>{inr(p.remaining)} to go</Text>}
                    </View>
                    {p.monthlyNeeded != null && p.monthsLeft != null && (
                      <Text style={styles.muted}>≈ {inr(p.monthlyNeeded)}/month for {p.monthsLeft} month{p.monthsLeft === 1 ? '' : 's'}</Text>
                    )}
                    <Text style={styles.suggest}>{p.suggestion}</Text>
                  </View>
                ))}
                <Text style={styles.faint}>Monthly amounts ignore returns, so they err on the safe side.</Text>
              </View>
            ) : (
              <EmptyCard
                text="No goals yet. Add one (with a target date) in Savings and we'll match it to the right kind of investment."
                action="Add a goal" onPress={() => go('/(tabs)/savings')} styles={styles}
              />
            )}

            {/* 4 · Calendar */}
            <Section n={4} title="Money calendar" styles={styles} />
            <CalendarCard ctx={ctx} styles={styles} />

            {/* 5 · Learn */}
            <Section n={5} title="Learn: sectors without predictions" styles={styles} />
            <LearnCards styles={styles} />

            <Text style={styles.footer}>
              Tax figures follow the rules as of FY 2025-26, which change with each Union Budget. Double-check before acting, and talk to a SEBI-registered adviser or a CA for big decisions.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Profile editor ──────────────────────────────────────────────────────────

function ProfileEditor({
  initial, styles, c, onSave, onCancel,
}: {
  initial: MoneyProfile;
  styles: Styles;
  c: Theme;
  onSave: (p: MoneyProfile) => Promise<void>;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [age, setAge] = useState(initial.age != null ? String(initial.age) : '');
  const [risk, setRisk] = useState<Risk>(initial.risk);
  const [regime, setRegime] = useState<TaxRegime>(initial.regime);
  const [health, setHealth] = useState(initial.hasHealthInsurance);
  const [dependents, setDependents] = useState(initial.hasDependents);
  const [term, setTerm] = useState(initial.hasTermInsurance);

  async function save() {
    const n = Number(age.replace(/[^0-9]/g, ''));
    if (!n || n < 18 || n > 80) {
      toast.show('Enter an age between 18 and 80', { type: 'error' });
      return;
    }
    await onSave({ age: n, risk, regime, hasHealthInsurance: health, hasDependents: dependents, hasTermInsurance: term });
    hSuccess();
    toast.show('Profile saved', { type: 'success' });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>👤 Your money profile</Text>
      <Text style={styles.muted}>Stays on your phone. Used to personalise targets and the calendar.</Text>

      <Text style={styles.label}>Age</Text>
      <TextInput
        style={styles.input}
        value={age}
        onChangeText={setAge}
        keyboardType="number-pad"
        placeholder="e.g. 28"
        placeholderTextColor={c.textFaint}
        maxLength={2}
      />

      <Text style={styles.label}>Risk comfort</Text>
      <View style={styles.chips}>
        {(['low', 'medium', 'high'] as Risk[]).map(r => (
          <Pill key={r} label={cap(r)} active={risk === r} onPress={() => setRisk(r)} styles={styles} />
        ))}
      </View>
      <Text style={styles.faint}>Low = a 20% drop would make you sell. High = you'd hold or buy more.</Text>

      <Text style={styles.label}>Tax regime</Text>
      <View style={styles.chips}>
        <Pill label="New (default)" active={regime === 'new'} onPress={() => setRegime('new')} styles={styles} />
        <Pill label="Old" active={regime === 'old'} onPress={() => setRegime('old')} styles={styles} />
      </View>

      <ToggleRow label="I have health insurance" value={health} onChange={setHealth} styles={styles} c={c} />
      <ToggleRow label="Someone depends on my income" value={dependents} onChange={setDependents} styles={styles} c={c} />
      {dependents && <ToggleRow label="I have term life insurance" value={term} onChange={setTerm} styles={styles} c={c} />}

      <View style={styles.editorBtns}>
        {onCancel && (
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onCancel} activeOpacity={0.8}>
            <Text style={styles.btnGhostText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={save} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Save profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Section pieces ──────────────────────────────────────────────────────────

function ReadinessCard({ steps, styles, onOpen }: { steps: ReturnType<typeof readinessSteps>; styles: Styles; onOpen: (href: string) => void }) {
  const current = steps.findIndex(s => s.status !== 'done');
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {current === -1 ? 'All set. You\'re ready to invest with confidence 🎉' : `You're on step ${current + 1} of ${steps.length}: ${steps[current].title}`}
      </Text>
      {steps.map((s, i) => {
        const body = (
          <View style={[styles.step, i === current && styles.stepCurrent]}>
            <Text style={styles.stepIcon}>{STATUS_ICON[s.status]}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepDetail}>{s.detail}</Text>
            </View>
            {s.link && s.status !== 'done' ? <Text style={styles.chev}>›</Text> : null}
          </View>
        );
        return s.link && s.status !== 'done' ? (
          <TouchableOpacity key={s.id} activeOpacity={0.7} onPress={() => onOpen(s.link!)}>{body}</TouchableOpacity>
        ) : (
          <View key={s.id}>{body}</View>
        );
      })}
    </View>
  );
}

function AllocationRow({ label, actual, target, color, styles }: { label: string; actual: number; target: number; color: string; styles: Styles }) {
  return (
    <View style={styles.allocRow}>
      <View style={styles.rowBetween}>
        <Text style={styles.allocLabel}>{label}</Text>
        <Text style={styles.allocNums}>{actual}% <Text style={styles.faintInline}>· target {target}%</Text></Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, actual)}%`, backgroundColor: color }]} />
        <View style={[styles.marker, { left: `${Math.min(99, target)}%` }]} />
      </View>
    </View>
  );
}

function CalendarCard({ ctx, styles }: { ctx: ReturnType<typeof calendarContext>; styles: Styles }) {
  const [full, setFull] = useState(false);
  const now = new Date().getMonth() + 1;
  const next = now === 12 ? 1 : now + 1;
  const dated = (m: number) => calendarFor(m, ctx).filter(i => i.months !== 'monthly');
  const monthly = calendarFor(now, ctx).filter(i => i.months === 'monthly');

  return (
    <View style={styles.card}>
      {monthly.length > 0 && <CalGroup title="🔁 Every month" items={monthly} styles={styles} />}
      <CalGroup title={`📍 ${MONTH_NAMES[now - 1]} (this month)`} items={dated(now)} styles={styles} highlight />
      <CalGroup title={`➡️ ${MONTH_NAMES[next - 1]}`} items={dated(next)} styles={styles} />

      {full && FY_ORDER.filter(m => m !== now && m !== next).map(m => (
        <CalGroup key={m} title={MONTH_NAMES[m - 1]} items={dated(m)} styles={styles} />
      ))}

      <TouchableOpacity onPress={() => { hSelect(); setFull(f => !f); }} activeOpacity={0.7} style={styles.moreBtn}>
        <Text style={styles.link}>{full ? 'Show less' : 'Show the whole financial year'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function CalGroup({ title, items, styles, highlight }: { title: string; items: CalendarItem[]; styles: Styles; highlight?: boolean }) {
  return (
    <View style={[styles.calGroup, highlight && styles.calGroupHi]}>
      <Text style={styles.calTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.faint}>Nothing dated this month. Keep your SIPs running.</Text>
      ) : items.map(i => (
        <View key={i.id} style={styles.calItem}>
          <Text style={styles.calItemTitle}>• {i.title}</Text>
          <Text style={styles.stepDetail}>{i.detail}</Text>
        </View>
      ))}
    </View>
  );
}

function LearnCards({ styles }: { styles: Styles }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={styles.card}>
      {LEARN.map((l, i) => (
        <TouchableOpacity
          key={l.id}
          activeOpacity={0.7}
          onPress={() => { hSelect(); setOpen(o => (o === l.id ? null : l.id)); }}
          style={[styles.learn, i > 0 && styles.divider]}
        >
          <View style={styles.rowBetween}>
            <Text style={styles.learnTitle}>{l.emoji}  {l.title}</Text>
            <Text style={styles.chev}>{open === l.id ? '−' : '+'}</Text>
          </View>
          {open === l.id && <Text style={styles.learnBody}>{l.body}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Small building blocks ───────────────────────────────────────────────────

function Section({ n, title, styles }: { n: number; title: string; styles: Styles }) {
  return <Text style={styles.section}>{n} · {title}</Text>;
}

function EmptyCard({ text, action, onPress, styles }: { text: string; action: string; onPress: () => void; styles: Styles }) {
  return (
    <View style={styles.card}>
      <Text style={styles.muted}>{text}</Text>
      <TouchableOpacity style={[styles.btn, styles.btnPrimary, { alignSelf: 'flex-start' }]} onPress={onPress} activeOpacity={0.85}>
        <Text style={styles.btnPrimaryText}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Pill({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: Styles }) {
  return (
    <TouchableOpacity onPress={() => { hSelect(); onPress(); }} activeOpacity={0.8} style={[styles.pill, active && styles.pillOn]}>
      <Text style={[styles.pillText, active && styles.pillTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ToggleRow({ label, value, onChange, styles, c }: { label: string; value: boolean; onChange: (v: boolean) => void; styles: Styles; c: Theme }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={v => { hSelect(); onChange(v); }}
        trackColor={{ true: c.primary, false: c.track }}
        thumbColor="#fff"
      />
    </View>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Styles ──────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },

  h1: { fontSize: 22, fontWeight: '800', color: c.text },
  sub: { fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 18 },
  section: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: c.textMuted, textTransform: 'uppercase', marginTop: 10 },

  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: c.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  muted: { fontSize: 13, color: c.textMuted, lineHeight: 18 },
  faint: { fontSize: 11.5, color: c.textFaint, lineHeight: 16 },
  faintInline: { fontSize: 12, color: c.textFaint, fontWeight: '500' },
  strong: { fontWeight: '800', color: c.text },
  link: { fontSize: 13, fontWeight: '700', color: c.primary },
  chev: { fontSize: 18, color: c.textFaint, fontWeight: '700' },
  divider: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 10 },

  // profile editor
  label: { fontSize: 12, fontWeight: '800', color: c.textFaint, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  input: {
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: c.text, width: 110,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, backgroundColor: c.chipBg, borderColor: c.chipBorder },
  pillOn: { backgroundColor: c.primary, borderColor: c.primary },
  pillText: { fontSize: 13, fontWeight: '700', color: c.textMuted },
  pillTextOn: { color: c.onColor },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleLabel: { flex: 1, fontSize: 14, color: c.text },
  editorBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center' },
  btnPrimary: { backgroundColor: c.primary, flexGrow: 1 },
  btnPrimaryText: { color: c.onColor, fontSize: 14, fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: c.inputBorder },
  btnGhostText: { color: c.text, fontSize: 14, fontWeight: '700' },

  // readiness
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 12 },
  stepCurrent: { backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.primary },
  stepIcon: { fontSize: 16, marginTop: 1 },
  stepTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  stepDetail: { fontSize: 12.5, color: c.textMuted, marginTop: 2, lineHeight: 17 },

  // allocation
  allocRow: { gap: 6 },
  allocLabel: { fontSize: 13.5, fontWeight: '700', color: c.text },
  allocNums: { fontSize: 13.5, fontWeight: '800', color: c.text },
  track: { height: 10, backgroundColor: c.track, borderRadius: 99, overflow: 'visible', position: 'relative' },
  fill: { height: '100%', borderRadius: 99 },
  marker: { position: 'absolute', top: -3, width: 2, height: 16, backgroundColor: c.text, borderRadius: 1 },
  msgs: { gap: 6, marginTop: 2 },
  msg: { fontSize: 13, color: c.text, lineHeight: 18 },

  // goals
  goal: { gap: 3 },
  goalName: { fontSize: 14.5, fontWeight: '700', color: c.text, flexShrink: 1 },
  goalAmt: { fontSize: 13, fontWeight: '700', color: c.textMuted },
  suggest: { fontSize: 12.5, color: c.primary, fontWeight: '600', lineHeight: 17 },

  // calendar
  calGroup: { gap: 6, padding: 10, borderRadius: 12 },
  calGroupHi: { backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder },
  calTitle: { fontSize: 13, fontWeight: '800', color: c.text },
  calItem: { gap: 1 },
  calItemTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
  moreBtn: { alignSelf: 'center', paddingVertical: 4 },

  // learn
  learn: { gap: 6 },
  learnTitle: { fontSize: 14, fontWeight: '700', color: c.text, flex: 1 },
  learnBody: { fontSize: 13, color: c.textMuted, lineHeight: 19 },

  footer: { fontSize: 11.5, color: c.textFaint, textAlign: 'center', lineHeight: 16, marginTop: 6, paddingHorizontal: 8 },
});
