import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import AddRecurringSheet from '@/components/AddRecurringSheet';
import AppAlert from '@/components/AppAlert';
import TransactionPickerSheet, { type PickerTx } from '@/components/TransactionPickerSheet';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

type Frequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type TxType    = 'DEBIT' | 'CREDIT';

export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  type: TxType;
  frequency: Frequency;
  dayOfMonth: number | null;
  dayOfWeek:  number | null;
  startDate:  string;
  nextDueDate: string;
  isActive:   boolean;
  note:       string | null;
  category:   { id: string; name: string; icon: string | null } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDINAL = (n: number) => {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

function frequencyLabel(item: RecurringItem) {
  if (item.frequency === 'WEEKLY')  return `Every ${DAY_NAMES[item.dayOfWeek ?? 0]}`;
  if (item.frequency === 'MONTHLY') return `${ORDINAL(item.dayOfMonth ?? 1)} of month`;
  return 'Every year';
}

function daysUntil(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0)   return `Overdue ${Math.abs(diff)}d`;
  return `In ${diff}d`;
}

function urgencyColor(dateStr: string, c: Theme) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (diff < 0)  return '#ef4444';
  if (diff <= 3) return '#f59e0b';
  return c.textMuted;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RecurringScreen() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringItem | null>(null);
  const [payingItem, setPayingItem] = useState<RecurringItem | null>(null);
  const [alertData, setAlertData] = useState<{
    title: string; message: string; icon?: string;
    confirmLabel?: string; confirmDestructive?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const { data, isLoading, refetch } = useQuery<RecurringItem[]>({
    queryKey: ['recurring'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch('/recurring', token!);
    },
  });

  function invalidatePay() {
    qc.invalidateQueries({ queryKey: ['recurring'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  function showPayResult(linkResult?: { transactionId: string | null; autoCreated: boolean }) {
    const linked = linkResult && linkResult.transactionId && !linkResult.autoCreated;
    setAlertData({
      title: linked ? 'Linked ✅' : 'Marked Paid',
      icon: linked ? '🔗' : '✅',
      message: linked
        ? 'Matched to your existing bank transaction — no duplicate created.'
        : 'Recorded as a new transaction (no matching bank transaction found).',
    });
  }

  async function pay(item: RecurringItem, transactionId?: string | null) {
    const token = await getToken();
    const res = await apiFetch<{ linkResult?: { transactionId: string | null; autoCreated: boolean } }>(
      `/recurring/${item.id}/pay`, token!,
      { method: 'POST', body: JSON.stringify(transactionId ? { transactionId } : {}) },
    );
    invalidatePay();
    showPayResult(res.linkResult);
  }

  // Opens the transaction picker so the user links this bill to its bank debit
  // (or skips to record it separately). Picking / skipping marks it paid.
  function handlePay(item: RecurringItem) {
    setPayingItem(item);
  }

  async function handleDelete(item: RecurringItem) {
    setAlertData({
      title: 'Delete Recurring',
      message: `Delete "${item.name}"? This cannot be undone.`,
      icon: '🗑️',
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/recurring/${item.id}`, token!, { method: 'DELETE' });
        qc.invalidateQueries({ queryKey: ['recurring'] });
      },
    });
  }

  const items = data ?? [];
  const totalMonthly = items
    .filter(i => i.type === 'DEBIT' && i.frequency === 'MONTHLY')
    .reduce((s, i) => s + i.amount, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={c.textMuted} />}
      >
        {/* Summary card */}
        <View style={s.summaryCard}>
          <Text style={s.summaryLabel}>Monthly Recurring Bills</Text>
          <Text style={s.summaryAmount}>{formatINR(totalMonthly)}</Text>
          <Text style={s.summaryCount}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
        </View>

        {/* Items */}
        {items.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyIcon}>🔄</Text>
            <Text style={s.emptyTitle}>No recurring transactions</Text>
            <Text style={s.emptyBody}>Add bills, subscriptions and rent that repeat on a schedule.</Text>
          </View>
        ) : (
          items.map(item => (
            <TouchableOpacity
              key={item.id}
              style={s.card}
              onPress={() => { setEditing(item); setSheetOpen(true); }}
              activeOpacity={0.75}
            >
              <View style={s.cardRow}>
                <View style={s.cardLeft}>
                  <Text style={s.cardIcon}>{item.category?.icon ?? (item.type === 'CREDIT' ? '💵' : '📅')}</Text>
                  <View>
                    <Text style={s.cardName}>{item.name}</Text>
                    <Text style={s.cardFreq}>{frequencyLabel(item)}</Text>
                    {item.category && <Text style={s.cardCat}>{item.category.name}</Text>}
                  </View>
                </View>
                <View style={s.cardRight}>
                  <Text style={[s.cardAmount, item.type === 'CREDIT' ? s.credit : s.debit]}>
                    {item.type === 'CREDIT' ? '+' : '-'}{formatINR(item.amount)}
                  </Text>
                  <Text style={[s.cardDue, { color: urgencyColor(item.nextDueDate, c) }]}>
                    {daysUntil(item.nextDueDate)}
                  </Text>
                </View>
              </View>

              <View style={s.cardActions}>
                <TouchableOpacity
                  style={[s.actionBtn, s.payBtn]}
                  onPress={() => handlePay(item)}
                >
                  <Text style={s.payBtnText}>✓ Mark Paid</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, s.deleteBtn]}
                  onPress={() => handleDelete(item)}
                >
                  <Text style={s.deleteBtnText}>🗑</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => { setEditing(null); setSheetOpen(true); }}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <AddRecurringSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        onSaved={() => {
          setSheetOpen(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ['recurring'] });
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

      {payingItem && (
        <TransactionPickerSheet
          visible
          suggestAmount={payingItem.amount}
          type={payingItem.type}
          title="Mark paid — link a transaction"
          subtitle={`${formatINR(payingItem.amount)} · ${payingItem.name}`}
          onClose={() => setPayingItem(null)}
          onPick={async (tx: PickerTx | null) => {
            const item = payingItem;
            setPayingItem(null);
            await pay(item, tx?.id ?? null);
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

    summaryCard: {
      backgroundColor: '#6366f1',
      borderRadius: 16,
      padding: 20,
      marginBottom: 4,
      alignItems: 'center',
    },
    summaryLabel:  { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '500' },
    summaryAmount: { color: '#fff', fontSize: 28, fontWeight: '800', marginVertical: 4 },
    summaryCount:  { color: 'rgba(255,255,255,0.65)', fontSize: 12 },

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
    },
    cardRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    cardIcon:  { fontSize: 26 },
    cardName:  { color: c.text, fontSize: 15, fontWeight: '700' },
    cardFreq:  { color: c.textMuted, fontSize: 12, marginTop: 2 },
    cardCat:   { color: '#6366f1', fontSize: 11, marginTop: 2, fontWeight: '600' },
    cardRight: { alignItems: 'flex-end' },
    cardAmount:{ fontSize: 16, fontWeight: '700' },
    cardDue:   { fontSize: 12, marginTop: 3, fontWeight: '600' },
    credit:    { color: '#22c55e' },
    debit:     { color: c.text },

    cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
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
