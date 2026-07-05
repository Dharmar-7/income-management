import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import AddSettlementSheet from '@/components/AddSettlementSheet';
import AppAlert from '@/components/AppAlert';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SettlementStatus = 'PENDING' | 'SETTLED' | 'CANCELLED';

export interface SettlementItem {
  id: string;
  personName: string;
  amount: number;
  direction: 'SENT' | 'RECEIVED';
  status: SettlementStatus;
  note: string | null;
  transferredAt: string;
  settledAt: string | null;
  originalTxId:  string | null;
  repaymentTxId: string | null;
  originalTx:  { id: string; merchant: string; amount: number; date: string } | null;
  repaymentTx: { id: string; merchant: string; amount: number; date: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 30)  return `${diff}d ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}y ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettlementsScreen() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settling, setSettling] = useState<SettlementItem | null>(null);
  const [alertData, setAlertData] = useState<{
    title: string; message: string; icon?: string;
    confirmLabel?: string; confirmDestructive?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const { data, isLoading, refetch } = useQuery<SettlementItem[]>({
    queryKey: ['settlements'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch('/settlements', token!);
    },
  });

  const all = data ?? [];
  const pending = all.filter(s => s.status === 'PENDING');
  const history = all.filter(s => s.status !== 'PENDING');

  // Summaries for pending
  const owedToMe  = pending.filter(s => s.direction === 'SENT').reduce((sum, s) => sum + s.amount, 0);
  const iOwe      = pending.filter(s => s.direction === 'RECEIVED').reduce((sum, s) => sum + s.amount, 0);

  async function handleSettle(item: SettlementItem) {
    setAlertData({
      title: 'Mark as Settled',
      message: `Mark ₹${item.amount.toLocaleString('en-IN')} ${item.direction === 'SENT' ? 'received back' : 'repaid'} to ${item.personName}?\n\nBoth transactions will remain excluded from income/expense reports.`,
      icon: '✅',
      confirmLabel: 'Mark Settled',
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/settlements/${item.id}/settle`, token!, {
          method: 'POST',
          body: JSON.stringify({ settledAt: new Date().toISOString() }),
        });
        qc.invalidateQueries({ queryKey: ['settlements'] });
      },
    });
  }

  async function handleCancel(item: SettlementItem) {
    setAlertData({
      title: 'Remove Settlement',
      message: `Remove this settlement? The linked transaction(s) will be restored to their original type and will appear in income/expense again.`,
      icon: '↩️',
      confirmLabel: 'Remove',
      confirmDestructive: true,
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/settlements/${item.id}`, token!, { method: 'DELETE' });
        qc.invalidateQueries({ queryKey: ['settlements'] });
        qc.invalidateQueries({ queryKey: ['transactions'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] }); // tx types revert → summary changes
      },
    });
  }

  const displayed = tab === 'pending' ? pending : history;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={c.textMuted} />}
      >
        {/* Summary strip */}
        {pending.length > 0 && (
          <View style={s.summaryRow}>
            <View style={[s.summaryCard, { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)' }]}>
              <Text style={s.summaryEmoji}>💸</Text>
              <Text style={[s.summaryLabel, { color: '#22c55e' }]}>Owed to me</Text>
              <Text style={[s.summaryAmt, { color: '#22c55e' }]}>{formatINR(owedToMe)}</Text>
            </View>
            <View style={[s.summaryCard, { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
              <Text style={s.summaryEmoji}>🤝</Text>
              <Text style={[s.summaryLabel, { color: '#ef4444' }]}>I owe</Text>
              <Text style={[s.summaryAmt, { color: '#ef4444' }]}>{formatINR(iOwe)}</Text>
            </View>
          </View>
        )}

        {/* Explainer card (first visit) */}
        {all.length === 0 && (
          <View style={s.explainerCard}>
            <Text style={s.explainerIcon}>🔄</Text>
            <Text style={s.explainerTitle}>How Settlements work</Text>
            <Text style={s.explainerBody}>
              When you send money to someone and they return it (or vice versa), both transactions inflate your income and expenses — even though no real spending happened.{'\n\n'}
              Mark them as a <Text style={{ fontWeight: '700', color: '#6366f1' }}>Peer Transfer</Text> and both transactions are excluded from your income and expense totals.
            </Text>
          </View>
        )}

        {/* Tabs */}
        {all.length > 0 && (
          <View style={s.tabRow}>
            <TouchableOpacity
              style={[s.tabBtn, tab === 'pending' && s.tabBtnActive]}
              onPress={() => setTab('pending')}
            >
              <Text style={[s.tabBtnText, tab === 'pending' && s.tabBtnTextActive]}>
                Pending {pending.length > 0 ? `(${pending.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tabBtn, tab === 'history' && s.tabBtnActive]}
              onPress={() => setTab('history')}
            >
              <Text style={[s.tabBtnText, tab === 'history' && s.tabBtnTextActive]}>
                History {history.length > 0 ? `(${history.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Settlement cards */}
        {displayed.length === 0 && all.length > 0 && (
          <View style={s.emptyWrap}>
            <Text style={s.emptyText}>
              {tab === 'pending' ? 'No pending settlements' : 'No settlement history yet'}
            </Text>
          </View>
        )}

        {displayed.map(item => (
          <SettlementCard
            key={item.id}
            item={item}
            s={s}
            c={c}
            onSettle={() => handleSettle(item)}
            onRemove={() => handleCancel(item)}
          />
        ))}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setSheetOpen(true)}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <AddSettlementSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={() => {
          setSheetOpen(false);
          qc.invalidateQueries({ queryKey: ['settlements'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] }); // tx types become TRANSFER → summary changes
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
    </SafeAreaView>
  );
}

// ─── Settlement Card ──────────────────────────────────────────────────────────

function SettlementCard({
  item, s, c, onSettle, onRemove,
}: { item: SettlementItem; s: any; c: Theme; onSettle: () => void; onRemove: () => void }) {
  const isSent   = item.direction === 'SENT';
  const isPending = item.status === 'PENDING';
  const isSettled = item.status === 'SETTLED';

  return (
    <View style={s.card}>
      {/* Header row */}
      <View style={s.cardHeader}>
        <View style={s.cardLeft}>
          <View style={[s.dirBadge, isSent ? s.dirSent : s.dirReceived]}>
            <Text style={s.dirIcon}>{isSent ? '📤' : '📥'}</Text>
          </View>
          <View>
            <Text style={s.cardName}>{item.personName}</Text>
            <Text style={s.cardDate}>{timeAgo(item.transferredAt)}</Text>
          </View>
        </View>
        <View style={s.cardRight}>
          <Text style={[s.cardAmt, isSent ? s.amtSent : s.amtReceived]}>
            {isSent ? '−' : '+'}{formatINR(item.amount)}
          </Text>
          <View style={[s.statusBadge,
            isPending ? s.statusPending : isSettled ? s.statusSettled : s.statusCancelled
          ]}>
            <Text style={[s.statusText,
              isPending ? { color: '#f59e0b' } : isSettled ? { color: '#22c55e' } : { color: c.textMuted }
            ]}>
              {isPending ? '⏳ Pending' : isSettled ? '✅ Settled' : '✗ Cancelled'}
            </Text>
          </View>
        </View>
      </View>

      {/* Direction label */}
      <Text style={s.dirLabel}>
        {isSent
          ? `You sent this · ${isPending ? 'waiting to receive back' : 'received back'}`
          : `You received this · ${isPending ? 'waiting to repay' : 'repaid'}`}
      </Text>

      {/* Linked tx chips */}
      {item.originalTx && (
        <View style={s.txChip}>
          <Text style={s.txChipIcon}>🔗</Text>
          <Text style={s.txChipText} numberOfLines={1}>
            Transfer: {item.originalTx.merchant} · {formatINR(item.originalTx.amount)}
          </Text>
        </View>
      )}
      {item.repaymentTx && (
        <View style={s.txChip}>
          <Text style={s.txChipIcon}>🔗</Text>
          <Text style={s.txChipText} numberOfLines={1}>
            Repayment: {item.repaymentTx.merchant} · {formatINR(item.repaymentTx.amount)}
          </Text>
        </View>
      )}

      {item.note && <Text style={s.noteText}>📝 {item.note}</Text>}

      {/* Actions — only for PENDING */}
      {isPending && (
        <View style={s.cardActions}>
          <TouchableOpacity style={[s.actionBtn, s.settleBtn]} onPress={onSettle}>
            <Text style={s.settleBtnText}>✅ Mark Settled</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.actionBtn, s.removeBtn]} onPress={onRemove}>
            <Text style={s.removeBtnText}>↩</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(c: Theme) {
  return StyleSheet.create({
    scroll: { padding: 16, gap: 12, paddingBottom: 100 },

    summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
    summaryCard: {
      flex: 1, borderRadius: 14, padding: 14,
      borderWidth: 1.5, alignItems: 'center', gap: 4,
    },
    summaryEmoji: { fontSize: 22 },
    summaryLabel: { fontSize: 11, fontWeight: '700' },
    summaryAmt:   { fontSize: 18, fontWeight: '800' },

    explainerCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: 'rgba(99,102,241,0.25)',
      alignItems: 'center',
      gap: 10,
    },
    explainerIcon:  { fontSize: 40 },
    explainerTitle: { color: c.text, fontSize: 17, fontWeight: '800' },
    explainerBody:  { color: c.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center' },

    tabRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    tabBtn: {
      flex: 1, paddingVertical: 10, borderRadius: 10,
      alignItems: 'center',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    tabBtnActive:     { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: '#6366f1' },
    tabBtnText:       { color: c.textMuted, fontSize: 13, fontWeight: '700' },
    tabBtnTextActive: { color: '#6366f1' },

    emptyWrap: { paddingVertical: 32, alignItems: 'center' },
    emptyText: { color: c.textMuted, fontSize: 14 },

    card: {
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardLeft:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dirBadge:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    dirSent:     { backgroundColor: 'rgba(239,68,68,0.12)' },
    dirReceived: { backgroundColor: 'rgba(34,197,94,0.12)' },
    dirIcon:    { fontSize: 18 },
    cardName:   { color: c.text, fontSize: 15, fontWeight: '700' },
    cardDate:   { color: c.textMuted, fontSize: 12, marginTop: 2 },
    cardRight:  { alignItems: 'flex-end', gap: 6 },
    cardAmt:    { fontSize: 17, fontWeight: '800' },
    amtSent:    { color: '#ef4444' },
    amtReceived:{ color: '#22c55e' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    statusPending:   { backgroundColor: 'rgba(245,158,11,0.1)' },
    statusSettled:   { backgroundColor: 'rgba(34,197,94,0.1)' },
    statusCancelled: { backgroundColor: c.bg },
    statusText: { fontSize: 11, fontWeight: '700' },

    dirLabel: { color: c.textMuted, fontSize: 12 },
    txChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
      borderWidth: 1, borderColor: c.border,
    },
    txChipIcon: { fontSize: 12 },
    txChipText: { color: c.textMuted, fontSize: 12, flex: 1 },
    noteText:   { color: c.textMuted, fontSize: 12, fontStyle: 'italic' },

    cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    actionBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
    settleBtn: { flex: 1, backgroundColor: 'rgba(34,197,94,0.10)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
    settleBtnText: { color: '#22c55e', fontSize: 13, fontWeight: '700' },
    removeBtn: { backgroundColor: 'rgba(99,102,241,0.08)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)', paddingHorizontal: 12 },
    removeBtnText: { fontSize: 16, color: '#6366f1' },

    fab: {
      position: 'absolute', right: 20, bottom: 100,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center',
      elevation: 8, shadowColor: '#6366f1',
      shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 10,
    },
    fabText: { color: '#fff', fontSize: 26, lineHeight: 30 },
  });
}
