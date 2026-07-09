import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import AddSavingSheet, { type EditingSaving } from '@/components/AddSavingSheet';
import AddGoalSheet from '@/components/AddGoalSheet';
import ContributeGoalSheet from '@/components/ContributeGoalSheet';
import AppAlert from '@/components/AppAlert';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SavingType =
  | 'POST_OFFICE' | 'FIXED_DEPOSIT' | 'RECURRING_DEPOSIT'
  | 'STOCKS' | 'MUTUAL_FUNDS' | 'GOLD' | 'EPF' | 'NPS' | 'OTHER';

interface Platform {
  id: string;
  name: string;
  totalAdded: number;
  note: string | null;
  totalInvested: number;
  balance: number;
}

interface Saving {
  id: string;
  name: string;
  type: SavingType;
  investedAmount: number;
  charges: number;
  currentValue: number;
  sipAmount: number | null;
  netCost: number;
  gainLoss: number;
  gainPercent: number;
  startDate: string;
  maturityDate: string | null;
  note: string | null;
  platform: { id: string; name: string } | null;
}

interface Summary {
  totalInvested: number;
  totalCharges: number;
  totalNetCost: number;
  totalCurrentValue: number;
  totalGainLoss: number;
  totalGainPercent: number;
  count: number;
}

interface Goal {
  id: string;
  name: string;
  icon: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string | null;
  note: string | null;
  remaining: number;
  percent: number;
  reached: boolean;
}

const TYPE_META: Record<SavingType, { label: string; icon: string }> = {
  POST_OFFICE:       { label: 'Post Office',    icon: '📮' },
  FIXED_DEPOSIT:     { label: 'Fixed Deposit',  icon: '🏦' },
  RECURRING_DEPOSIT: { label: 'RD',             icon: '📅' },
  MUTUAL_FUNDS:      { label: 'Mutual Funds',   icon: '📈' },
  STOCKS:            { label: 'Stocks',          icon: '💹' },
  GOLD:              { label: 'Gold',            icon: '🥇' },
  EPF:               { label: 'EPF',             icon: '🏢' },
  NPS:               { label: 'NPS',             icon: '🛡️' },
  OTHER:             { label: 'Other',           icon: '📦' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

// ─── Screen ─────────────────────────────────────────────────────────────────────

export default function SavingsScreen() {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const queryClient = useQueryClient();

  const [sheetMode, setSheetMode] = useState<'platform' | 'saving' | null>(null);
  const [editingSaving, setEditingSaving] = useState<Saving | null>(null);
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [contributingGoal, setContributingGoal] = useState<Goal | null>(null);
  const [alertData, setAlertData] = useState<{
    title: string; message: string;
    confirmLabel?: string; confirmDestructive?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['savings-summary'] });
    queryClient.invalidateQueries({ queryKey: ['savings-platforms'] });
    queryClient.invalidateQueries({ queryKey: ['savings-list'] });
    queryClient.invalidateQueries({ queryKey: ['goals'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }); // investments feed dashboard savings + net worth
  };

  function openAddPlatform() { setEditingSaving(null); setSheetMode('platform'); }
  function openAddSaving() { setEditingSaving(null); setSheetMode('saving'); }
  function openEditSaving(s: Saving) { setEditingSaving(s); setSheetMode('saving'); }
  function closeSheet() { setSheetMode(null); setEditingSaving(null); }

  function openAddGoal() { setEditingGoal(null); setGoalSheetOpen(true); }
  function openEditGoal(g: Goal) { setEditingGoal(g); setGoalSheetOpen(true); }
  function closeGoalSheet() { setGoalSheetOpen(false); setEditingGoal(null); }

  function deleteGoal(g: Goal) {
    setAlertData({
      title: 'Delete Goal',
      message: `Delete "${g.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        try {
          const token = await getToken();
          await apiFetch(`/goals/${g.id}`, token!, { method: 'DELETE' });
          invalidate();
        } catch {
          setAlertData({ title: 'Error', message: 'Failed to delete goal.' });
        }
      },
    });
  }

  // Map the list row into the shape the edit form needs (platform → platformId).
  const editingPayload: EditingSaving | null = editingSaving ? {
    id: editingSaving.id,
    name: editingSaving.name,
    type: editingSaving.type,
    investedAmount: editingSaving.investedAmount,
    charges: editingSaving.charges,
    currentValue: editingSaving.currentValue,
    sipAmount: editingSaving.sipAmount,
    startDate: editingSaving.startDate,
    maturityDate: editingSaving.maturityDate,
    platformId: editingSaving.platform?.id ?? '',
    note: editingSaving.note,
  } : null;

  const summaryQuery = useQuery({
    queryKey: ['savings-summary'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Summary>('/savings/summary', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const platformsQuery = useQuery({
    queryKey: ['savings-platforms'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Platform[]>('/savings/platforms', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const savingsQuery = useQuery({
    queryKey: ['savings-list'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Saving[]>('/savings', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Goal[]>('/goals', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const isRefreshing = summaryQuery.isFetching || savingsQuery.isFetching || platformsQuery.isFetching || goalsQuery.isFetching;

  function handleRefresh() {
    summaryQuery.refetch();
    platformsQuery.refetch();
    savingsQuery.refetch();
    goalsQuery.refetch();
  }

  function deleteSaving(id: string, name: string) {
    setAlertData({
      title: 'Delete Investment',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        try {
          const token = await getToken();
          await apiFetch(`/savings/${id}`, token!, { method: 'DELETE' });
          invalidate();
        } catch {
          setAlertData({ title: 'Error', message: 'Failed to delete investment.' });
        }
      },
    });
  }

  function contributeSip(s: Saving) {
    if (!s.sipAmount) return;
    // The monthly top-up isn't SIP-only — RDs and other instruments use it too.
    const word = s.type === 'MUTUAL_FUNDS' ? 'SIP' : s.type === 'RECURRING_DEPOSIT' ? 'deposit' : 'contribution';
    setAlertData({
      title: `Add this month’s ${word}`,
      message: `Add ${formatINR(s.sipAmount)} to "${s.name}"? This bumps both the invested amount and current value.`,
      confirmLabel: 'Add',
      onConfirm: async () => {
        try {
          const token = await getToken();
          await apiFetch(`/savings/${s.id}/contribute`, token!, { method: 'POST', body: JSON.stringify({}) });
          invalidate();
          setAlertData({
            title: `Added ✅`,
            message: `Added ${formatINR(s.sipAmount!)} to "${s.name}".`,
          });
        } catch (err: any) {
          setAlertData({ title: `Could not add ${word}`, message: err?.message ?? 'Please try again.' });
        }
      },
    });
  }

  function deletePlatform(id: string, name: string) {
    setAlertData({
      title: 'Delete Platform',
      message: `Delete "${name}" and all linked investments?`,
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        try {
          const token = await getToken();
          await apiFetch(`/savings/platforms/${id}`, token!, { method: 'DELETE' });
          invalidate();
        } catch {
          setAlertData({ title: 'Error', message: 'Failed to delete platform.' });
        }
      },
    });
  }

  const sum = summaryQuery.data;
  const platforms = platformsQuery.data ?? [];
  const savings = savingsQuery.data ?? [];
  const goals = goalsQuery.data ?? [];
  const isGain = (sum?.totalGainLoss ?? 0) >= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {sheetMode && (
        <AddSavingSheet
          visible
          mode={sheetMode}
          editing={editingPayload}
          platforms={platforms.map(p => ({ id: p.id, name: p.name, balance: p.balance }))}
          onClose={closeSheet}
          onSuccess={() => { invalidate(); closeSheet(); }}
        />
      )}

      {goalSheetOpen && (
        <AddGoalSheet
          visible
          editing={editingGoal}
          onClose={closeGoalSheet}
          onSuccess={() => { invalidate(); closeGoalSheet(); }}
        />
      )}

      {contributingGoal && (
        <ContributeGoalSheet
          visible
          goalId={contributingGoal.id}
          goalName={contributingGoal.name}
          onClose={() => setContributingGoal(null)}
          onSuccess={() => { invalidate(); setContributingGoal(null); }}
        />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        {/* ── Portfolio Summary ───────────────────────────────────────── */}
        {sum && sum.count > 0 && (
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { backgroundColor: c.primary }]}>
              <Text style={styles.summaryLabel}>Invested</Text>
              <Text style={styles.summaryValue}>{formatINR(sum.totalNetCost)}</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: c.primaryDeep }]}>
              <Text style={styles.summaryLabel}>Current</Text>
              <Text style={styles.summaryValue}>{formatINR(sum.totalCurrentValue)}</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: isGain ? c.success : c.danger }]}>
              <Text style={styles.summaryLabel}>Gain/Loss</Text>
              <Text style={styles.summaryValue}>
                {isGain ? '+' : ''}{formatINR(sum.totalGainLoss)}
              </Text>
              <Text style={styles.summaryPct}>
                {sum.totalGainPercent >= 0 ? '+' : ''}{sum.totalGainPercent.toFixed(1)}%
              </Text>
            </View>
          </View>
        )}

        {/* ── Platforms ───────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Platforms</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAddPlatform}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {platforms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No platforms yet.</Text>
            <Text style={styles.emptyHint}>Add one to track your in-app wallet balance.</Text>
          </View>
        ) : (
          platforms.map(p => (
            <View key={p.id} style={styles.platformCard}>
              <View style={styles.platformHeader}>
                <Text style={styles.platformName}>{p.name}</Text>
                <TouchableOpacity onPress={() => deletePlatform(p.id, p.name)}>
                  <Text style={styles.deleteIcon}>🗑️</Text>
                </TouchableOpacity>
              </View>
              {p.note ? <Text style={styles.platformNote}>{p.note}</Text> : null}
              <View style={styles.platformRow}>
                <Text style={styles.platformRowLabel}>Transferred in</Text>
                <Text style={styles.platformRowValue}>{formatINR(p.totalAdded)}</Text>
              </View>
              <View style={styles.platformRow}>
                <Text style={styles.platformRowLabel}>Invested</Text>
                <Text style={styles.platformRowValue}>{formatINR(p.totalInvested)}</Text>
              </View>
              <View style={[styles.platformRow, styles.platformRowLast]}>
                <Text style={styles.platformRowLabelBold}>Balance</Text>
                <Text style={[styles.platformRowValueBold, p.balance < 0 ? styles.negative : styles.positive]}>
                  {formatINR(p.balance)}
                </Text>
              </View>
            </View>
          ))
        )}

        {/* ── Investments ─────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Investments</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAddSaving}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {savings.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No investments yet.</Text>
            <Text style={styles.emptyHint}>Tap "+ Add" to start tracking.</Text>
          </View>
        ) : (
          savings.map(s => {
            const meta = TYPE_META[s.type] ?? { label: s.type, icon: '📦' };
            const gain = s.gainLoss >= 0;
            return (
              <TouchableOpacity key={s.id} style={styles.savingCard} activeOpacity={0.7} onPress={() => openEditSaving(s)}>
                <View style={styles.savingHeader}>
                  <View style={styles.savingIconBox}>
                    <Text style={styles.savingIcon}>{meta.icon}</Text>
                  </View>
                  <View style={styles.savingMeta}>
                    <Text style={styles.savingName} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.savingType}>{meta.label}{s.platform ? ` · ${s.platform.name}` : ''}</Text>
                  </View>
                  <View style={styles.savingValues}>
                    <Text style={styles.savingCurrentValue}>{formatINR(s.currentValue)}</Text>
                    <Text style={[styles.savingGainLoss, gain ? styles.positive : styles.negative]}>
                      {gain ? '+' : ''}{formatINR(s.gainLoss)} ({s.gainPercent >= 0 ? '+' : ''}{s.gainPercent.toFixed(1)}%)
                    </Text>
                  </View>
                </View>
                <View style={styles.savingFooter}>
                  <Text style={styles.savingDetail}>
                    Invested {formatINR(s.investedAmount)}
                    {s.charges > 0 ? ` + ${formatINR(s.charges)} charges` : ''}
                  </Text>
                  <View style={styles.savingActions}>
                    {s.sipAmount ? (
                      <TouchableOpacity style={styles.sipBtn} onPress={() => contributeSip(s)}>
                        <Text style={styles.sipBtnText}>+ {formatINR(s.sipAmount)}/mo</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => deleteSaving(s.id, s.name)}>
                      <Text style={styles.deleteIcon}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* ── Goals ───────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Goals</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAddGoal}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {goals.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No goals yet.</Text>
            <Text style={styles.emptyHint}>Set a target like an emergency fund or a trip.</Text>
          </View>
        ) : (
          goals.map(g => (
            <TouchableOpacity key={g.id} style={styles.savingCard} activeOpacity={0.7} onPress={() => openEditGoal(g)}>
              <View style={styles.savingHeader}>
                <View style={styles.savingIconBox}>
                  <Text style={styles.savingIcon}>{g.icon}</Text>
                </View>
                <View style={styles.savingMeta}>
                  <Text style={styles.savingName} numberOfLines={1}>{g.name}</Text>
                  <Text style={styles.savingType}>
                    {g.reached ? '🎉 Reached!' : `${formatINR(g.remaining)} to go`}
                    {g.targetDate ? ` · by ${new Date(g.targetDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}` : ''}
                  </Text>
                </View>
                <View style={styles.savingValues}>
                  <Text style={styles.savingCurrentValue}>{formatINR(g.savedAmount)}</Text>
                  <Text style={styles.goalTarget}>of {formatINR(g.targetAmount)}</Text>
                </View>
              </View>

              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${g.percent}%`, backgroundColor: g.reached ? c.success : c.primary }]} />
              </View>

              <View style={styles.savingFooter}>
                <Text style={styles.savingDetail}>{g.percent.toFixed(0)}% saved</Text>
                <View style={styles.savingActions}>
                  <TouchableOpacity style={styles.sipBtn} onPress={() => setContributingGoal(g)}>
                    <Text style={styles.sipBtnText}>+ Add money</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteGoal(g)}>
                    <Text style={styles.deleteIcon}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
      <AppAlert
        visible={!!alertData}
        title={alertData?.title ?? ''}
        message={alertData?.message ?? ''}
        confirmLabel={alertData?.confirmLabel}
        confirmDestructive={alertData?.confirmDestructive}
        onClose={() => setAlertData(null)}
        onConfirm={alertData?.onConfirm}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 32 },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  summaryCard: { flex: 1, borderRadius: 14, padding: 12, gap: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  summaryLabel: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: c.onColor },
  summaryPct: { fontSize: 10, color: 'rgba(255,255,255,0.8)' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  addBtn: { backgroundColor: c.primary, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 },
  addBtnText: { color: c.onColor, fontSize: 13, fontWeight: '700' },

  emptyCard: { backgroundColor: c.card, borderRadius: 14, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder },
  emptyText: { fontSize: 14, color: c.textMuted, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: c.textFaint, marginTop: 4 },

  platformCard: {
    backgroundColor: c.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  platformHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  platformName: { fontSize: 15, fontWeight: '700', color: c.text },
  platformNote: { fontSize: 12, color: c.textFaint, marginBottom: 8 },
  platformRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  platformRowLast: { borderTopWidth: 1, borderTopColor: c.cardBorder, marginTop: 4, paddingTop: 8 },
  platformRowLabel: { fontSize: 13, color: c.textMuted },
  platformRowValue: { fontSize: 13, color: c.text, fontWeight: '500' },
  platformRowLabelBold: { fontSize: 13, color: c.text, fontWeight: '600' },
  platformRowValueBold: { fontSize: 14, fontWeight: '700' },

  savingCard: {
    backgroundColor: c.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  savingHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  savingIconBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center' },
  savingIcon: { fontSize: 18 },
  savingMeta: { flex: 1 },
  savingName: { fontSize: 14, fontWeight: '600', color: c.text },
  savingType: { fontSize: 11, color: c.textFaint, marginTop: 1 },
  savingValues: { alignItems: 'flex-end' },
  savingCurrentValue: { fontSize: 14, fontWeight: '700', color: c.text },
  goalTarget: { fontSize: 11, color: c.textFaint, marginTop: 1 },
  goalTrack: { height: 8, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden', marginTop: 10 },
  goalFill: { height: '100%', borderRadius: 99 },
  savingGainLoss: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  savingFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.cardBorder },
  savingDetail: { fontSize: 11, color: c.textFaint, flex: 1 },
  savingActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sipBtn: { backgroundColor: c.primary, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  sipBtnText: { color: c.onColor, fontSize: 12, fontWeight: '700' },

  deleteIcon: { fontSize: 16 },
  positive: { color: c.success },
  negative: { color: c.danger },
});
