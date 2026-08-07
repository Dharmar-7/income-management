import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import AddLoanSheet from '@/components/AddLoanSheet';
import AppAlert from '@/components/AppAlert';
import LinkTransactionSheet, { type TxMatch } from '@/components/LinkTransactionSheet';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LoanType =
  | 'HOME_LOAN' | 'CAR_LOAN' | 'PERSONAL_LOAN'
  | 'EDUCATION_LOAN' | 'TWO_WHEELER_LOAN' | 'CREDIT_CARD_EMI' | 'OTHER';

export interface LoanItem {
  id: string;
  name: string;
  loanType: LoanType;
  lender: string;
  principalAmount: number;
  interestRate: number;
  tenure: number;
  emiAmount: number;
  emiDay: number;
  startDate: string;
  isActive: boolean;
  note: string | null;
  // enriched
  paidEmis: number;
  remainingEmis: number;
  outstandingBalance: number;
  totalPaid: number;
  progressPercent: number;
  nextEmiDate: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

const LOAN_META: Record<LoanType, { label: string; icon: string }> = {
  HOME_LOAN:        { label: 'Home Loan',       icon: '🏠' },
  CAR_LOAN:         { label: 'Car Loan',         icon: '🚗' },
  PERSONAL_LOAN:    { label: 'Personal Loan',    icon: '💼' },
  EDUCATION_LOAN:   { label: 'Education Loan',   icon: '🎓' },
  TWO_WHEELER_LOAN: { label: '2-Wheeler Loan',   icon: '🏍️' },
  CREDIT_CARD_EMI:  { label: 'Credit Card EMI',  icon: '💳' },
  OTHER:            { label: 'Other',            icon: '📋' },
};

function daysUntilEmi(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (diff === 0) return 'Due today!';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0)   return `Overdue ${Math.abs(diff)}d`;
  return `In ${diff}d`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LoansScreen() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<LoanItem | null>(null);
  const [linkState, setLinkState] = useState<{ loan: LoanItem; matches: TxMatch[] } | null>(null);
  const [alertData, setAlertData] = useState<{
    title: string; message: string; icon?: string;
    confirmLabel?: string; confirmDestructive?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const { data, isLoading, refetch } = useQuery<LoanItem[]>({
    queryKey: ['loans'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch('/loans', token!);
    },
  });

  function invalidatePay() {
    qc.invalidateQueries({ queryKey: ['loans'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  // Show what happened after paying so the user knows it wasn't double-counted.
  function showPayResult(linkResult?: { transactionId: string | null; autoCreated: boolean }) {
    const linked = linkResult && linkResult.transactionId && !linkResult.autoCreated;
    setAlertData({
      title: linked ? 'Linked ✅' : 'EMI Recorded',
      icon: linked ? '🔗' : '💳',
      message: linked
        ? 'Matched to your existing bank transaction — no duplicate created.'
        : 'Recorded as a new transaction (no matching bank transaction found).',
    });
  }

  async function payEmi(loan: LoanItem, transactionId?: string | null) {
    const token = await getToken();
    const res = await apiFetch<{ linkResult?: { transactionId: string | null; autoCreated: boolean } }>(
      `/loans/${loan.id}/pay`, token!,
      { method: 'POST', body: JSON.stringify(transactionId ? { transactionId } : {}) },
    );
    invalidatePay();
    showPayResult(res.linkResult);
  }

  async function handlePayEmi(loan: LoanItem) {
    setAlertData({
      title: 'Pay EMI',
      message: `Pay EMI of ${formatINR(loan.emiAmount)} for "${loan.name}"?\n\nWe'll match it to your bank transaction so it isn't counted twice.`,
      icon: '💳',
      confirmLabel: 'Pay EMI',
      onConfirm: async () => {
        const token = await getToken();
        // If several bank transactions could be this EMI, ask which one.
        const matches = await apiFetch<TxMatch[]>(`/loans/${loan.id}/payment-matches`, token!);
        if (matches.length >= 2) {
          setLinkState({ loan, matches });
          return;
        }
        // 0 or 1 → backend auto-links the single match or records a new one.
        await payEmi(loan);
      },
    });
  }

  async function handleDelete(loan: LoanItem) {
    setAlertData({
      title: 'Delete Loan',
      message: `Delete "${loan.name}"? All payment history will be lost.`,
      icon: '🗑️',
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/loans/${loan.id}`, token!, { method: 'DELETE' });
        qc.invalidateQueries({ queryKey: ['loans'] });
      },
    });
  }

  const loans = data ?? [];
  const activeLoans = loans.filter(l => l.isActive);
  const totalOutstanding = activeLoans.reduce((s, l) => s + l.outstandingBalance, 0);
  const totalMonthlyEmi  = activeLoans.reduce((s, l) => s + l.emiAmount, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={c.textMuted} />}
      >
        {/* Summary cards */}
        {loans.length > 0 && (
          <View style={s.summaryRow}>
            <View style={[s.summaryCard, { backgroundColor: '#ef4444' }]}>
              <Text style={s.summaryLabel}>Outstanding</Text>
              <Text style={s.summaryAmount}>{formatINR(totalOutstanding)}</Text>
            </View>
            <View style={[s.summaryCard, { backgroundColor: '#6366f1' }]}>
              <Text style={s.summaryLabel}>Monthly EMI</Text>
              <Text style={s.summaryAmount}>{formatINR(totalMonthlyEmi)}</Text>
            </View>
          </View>
        )}

        {/* Loan cards */}
        {loans.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyIcon}>🏦</Text>
            <Text style={s.emptyTitle}>No loans tracked</Text>
            <Text style={s.emptyBody}>Track your home loan, car loan, or any EMI to stay on top of repayments.</Text>
          </View>
        ) : (
          loans.map(loan => {
            const meta = LOAN_META[loan.loanType];
            const dueLabel = daysUntilEmi(loan.nextEmiDate);
            const isOverdue = new Date(loan.nextEmiDate) < new Date();
            return (
              <TouchableOpacity
                key={loan.id}
                style={[s.card, !loan.isActive && s.cardClosed]}
                onPress={() => { setEditing(loan); setSheetOpen(true); }}
                activeOpacity={0.75}
              >
                {/* Header */}
                <View style={s.cardHeader}>
                  <View style={s.cardTitleRow}>
                    <Text style={s.cardIcon}>{meta.icon}</Text>
                    <View>
                      <Text style={s.cardName}>{loan.name}</Text>
                      <Text style={s.cardLender}>{meta.label} • {loan.lender}</Text>
                    </View>
                  </View>
                  {!loan.isActive && (
                    <View style={s.closedBadge}><Text style={s.closedText}>Closed</Text></View>
                  )}
                </View>

                {/* Progress bar */}
                <View style={s.progressWrap}>
                  <View style={[s.progressBar, { width: `${Math.min(loan.progressPercent, 100)}%` as any }]} />
                </View>
                <View style={s.progressLabels}>
                  <Text style={s.progressText}>{loan.paidEmis}/{loan.tenure} EMIs paid ({loan.progressPercent}%)</Text>
                  <Text style={s.progressText}>{loan.remainingEmis} remaining</Text>
                </View>

                {/* Stats */}
                <View style={s.statsRow}>
                  <View style={s.stat}>
                    <Text style={s.statLabel}>EMI</Text>
                    <Text style={s.statValue}>{formatINR(loan.emiAmount)}</Text>
                  </View>
                  <View style={s.stat}>
                    <Text style={s.statLabel}>Outstanding</Text>
                    <Text style={[s.statValue, { color: '#ef4444' }]}>{formatINR(loan.outstandingBalance)}</Text>
                  </View>
                  <View style={s.stat}>
                    <Text style={s.statLabel}>Next EMI</Text>
                    <Text style={[s.statValue, { color: isOverdue ? '#ef4444' : c.text }]}>{dueLabel}</Text>
                  </View>
                </View>

                {/* Actions */}
                {loan.isActive && (
                  <View style={s.cardActions}>
                    <TouchableOpacity style={[s.actionBtn, s.payBtn]} onPress={() => handlePayEmi(loan)}>
                      <Text style={s.payBtnText}>💳 Pay EMI</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actionBtn, s.deleteBtn]} onPress={() => handleDelete(loan)}>
                      <Text style={s.deleteBtnText}>🗑</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => { setEditing(null); setSheetOpen(true); }}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <AddLoanSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        onSaved={() => {
          setSheetOpen(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ['loans'] });
        }}
      />

      {alertData && (
        <AppAlert
          visible
          title={alertData.title}
          message={alertData.message}
          icon={alertData.icon}
          confirmLabel={alertData.confirmLabel}
          confirmDestructive={alertData.confirmDestructive}
          onClose={() => setAlertData(null)}
          onConfirm={alertData.onConfirm}
        />
      )}

      {linkState && (
        <LinkTransactionSheet
          visible
          title="Link this EMI"
          subtitle={`${formatINR(linkState.loan.emiAmount)} · ${linkState.loan.name}`}
          matches={linkState.matches}
          onClose={() => setLinkState(null)}
          onPick={async (txId) => {
            const loan = linkState.loan;
            setLinkState(null);
            await payEmi(loan, txId);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(c: Theme) {
  return StyleSheet.create({
    scroll: { padding: 16, gap: 12, paddingBottom: 100 },

    summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
    summaryCard: {
      flex: 1,
      borderRadius: 14,
      padding: 16,
      alignItems: 'center',
    },
    summaryLabel:  { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '500' },
    summaryAmount: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 4 },

    emptyWrap:  { alignItems: 'center', paddingTop: 60, gap: 10 },
    emptyIcon:  { fontSize: 48 },
    emptyTitle: { color: c.text, fontSize: 17, fontWeight: '700' },
    emptyBody:  { color: c.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },

    card: {
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
      gap: 10,
    },
    cardClosed: { opacity: 0.6 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardIcon:  { fontSize: 26 },
    cardName:  { color: c.text, fontSize: 15, fontWeight: '700' },
    cardLender:{ color: c.textMuted, fontSize: 12, marginTop: 2 },
    closedBadge: { backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
    closedText:  { color: '#22c55e', fontSize: 11, fontWeight: '700' },

    progressWrap: { height: 6, backgroundColor: c.border, borderRadius: 3, overflow: 'hidden' },
    progressBar:  { height: '100%', backgroundColor: '#6366f1', borderRadius: 3 },
    progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    progressText: { color: c.textMuted, fontSize: 11 },

    statsRow: { flexDirection: 'row', gap: 6 },
    stat: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 10,
      padding: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    statLabel: { color: c.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 3 },
    statValue: { color: c.text, fontSize: 13, fontWeight: '700' },

    cardActions: { flexDirection: 'row', gap: 8 },
    actionBtn:   { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, alignItems: 'center' },
    payBtn:      { flex: 1, backgroundColor: 'rgba(99,102,241,0.12)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.3)' },
    payBtnText:  { color: '#6366f1', fontSize: 13, fontWeight: '700' },
    deleteBtn:   { backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', paddingHorizontal: 10 },
    deleteBtnText: { fontSize: 16 },

    fab: {
      position: 'absolute',
      right: 20, bottom: 100,
      width: 56, height: 56,
      borderRadius: 28,
      backgroundColor: '#6366f1',
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
      shadowColor: '#6366f1',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.45,
      shadowRadius: 10,
    },
    fabText: { color: '#fff', fontSize: 26, lineHeight: 30 },
  });
}
