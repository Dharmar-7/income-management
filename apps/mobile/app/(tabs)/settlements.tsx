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
import SettlementLegSheet from '@/components/SettlementLegSheet';
import AppAlert from '@/components/AppAlert';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SettlementStatus = 'PENDING' | 'SETTLED' | 'CANCELLED';

export interface SettlementEntry {
  id: string;
  kind: 'PRINCIPAL' | 'REPAYMENT';
  amount: number;
  occurredAt: string;
  note: string | null;
  transaction: { id: string; merchant: string; amount: number; date: string; type: string } | null;
}

export interface SettlementItem {
  id: string;
  personName: string;
  direction: 'SENT' | 'RECEIVED';
  status: SettlementStatus;
  note: string | null;
  transferredAt: string;
  settledAt: string | null;
  amount: number;          // = totalPrincipal
  totalPrincipal: number;
  totalRepaid: number;
  outstanding: number;
  entries: SettlementEntry[];
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

function shortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettlementsScreen() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [legSheet, setLegSheet] = useState<{ id: string; kind: 'PRINCIPAL' | 'REPAYMENT'; direction: 'SENT' | 'RECEIVED' } | null>(null);
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
  const pending = all.filter(x => x.status === 'PENDING');
  const history = all.filter(x => x.status !== 'PENDING');

  const owedToMe = pending.filter(x => x.direction === 'SENT').reduce((sum, x) => sum + x.outstanding, 0);
  const iOwe     = pending.filter(x => x.direction === 'RECEIVED').reduce((sum, x) => sum + x.outstanding, 0);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['settlements'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] }); // tx types change → summary changes
  }

  function handleSettleFull(item: SettlementItem) {
    setAlertData({
      title: 'Settle in full',
      message: `Record ${formatINR(item.outstanding)} ${item.direction === 'SENT' ? 'received back from' : 'repaid to'} ${item.personName}? This closes the tab.`,
      icon: '✅',
      confirmLabel: 'Settle',
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/settlements/${item.id}/settle`, token!, {
          method: 'POST',
          body: JSON.stringify({ settledAt: new Date().toISOString() }),
        });
        invalidateAll();
      },
    });
  }

  function handleRemoveEntry(item: SettlementItem, entry: SettlementEntry) {
    setAlertData({
      title: 'Remove this transaction?',
      message: 'It will be taken off this tab and restored to its normal type in income/expense.',
      icon: '↩️',
      confirmLabel: 'Remove',
      confirmDestructive: true,
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/settlements/${item.id}/entries/${entry.id}`, token!, { method: 'DELETE' });
        invalidateAll();
      },
    });
  }

  function handleDeleteTab(item: SettlementItem) {
    setAlertData({
      title: 'Delete this tab',
      message: `Remove the whole settlement with ${item.personName}? Every linked transaction is restored to its normal type and reappears in income/expense.`,
      icon: '🗑️',
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        const token = await getToken();
        await apiFetch(`/settlements/${item.id}`, token!, { method: 'DELETE' });
        invalidateAll();
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

        {/* Explainer (first visit) */}
        {all.length === 0 && (
          <View style={s.explainerCard}>
            <Text style={s.explainerIcon}>🔄</Text>
            <Text style={s.explainerTitle}>How Settlements work</Text>
            <Text style={s.explainerBody}>
              A tab tracks money that moves between you and a person but isn’t real spending — like lending a friend money.{'\n\n'}
              Add every transfer (you can add <Text style={{ fontWeight: '700', color: '#6366f1' }}>several</Text>), and record returns as they come — even one return that covers many sends. Every linked transaction is excluded from your income and expense totals.
            </Text>
          </View>
        )}

        {/* Tabs */}
        {all.length > 0 && (
          <View style={s.tabRow}>
            <TouchableOpacity style={[s.tabBtn, tab === 'pending' && s.tabBtnActive]} onPress={() => setTab('pending')}>
              <Text style={[s.tabBtnText, tab === 'pending' && s.tabBtnTextActive]}>
                Pending {pending.length > 0 ? `(${pending.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.tabBtn, tab === 'history' && s.tabBtnActive]} onPress={() => setTab('history')}>
              <Text style={[s.tabBtnText, tab === 'history' && s.tabBtnTextActive]}>
                History {history.length > 0 ? `(${history.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {displayed.length === 0 && all.length > 0 && (
          <View style={s.emptyWrap}>
            <Text style={s.emptyText}>{tab === 'pending' ? 'No pending settlements' : 'No settlement history yet'}</Text>
          </View>
        )}

        {displayed.map(item => (
          <SettlementCard
            key={item.id}
            item={item}
            s={s}
            c={c}
            onAddSend={() => setLegSheet({ id: item.id, kind: 'PRINCIPAL', direction: item.direction })}
            onRecordReturn={() => setLegSheet({ id: item.id, kind: 'REPAYMENT', direction: item.direction })}
            onSettleFull={() => handleSettleFull(item)}
            onRemoveEntry={(entry) => handleRemoveEntry(item, entry)}
            onDelete={() => handleDeleteTab(item)}
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
        onSaved={() => { setSheetOpen(false); invalidateAll(); }}
      />

      {legSheet && (
        <SettlementLegSheet
          visible
          settlementId={legSheet.id}
          kind={legSheet.kind}
          direction={legSheet.direction}
          onClose={() => setLegSheet(null)}
          onSaved={() => { setLegSheet(null); invalidateAll(); }}
        />
      )}

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
  item, s, c, onAddSend, onRecordReturn, onSettleFull, onRemoveEntry, onDelete,
}: {
  item: SettlementItem; s: any; c: Theme;
  onAddSend: () => void; onRecordReturn: () => void; onSettleFull: () => void;
  onRemoveEntry: (e: SettlementEntry) => void; onDelete: () => void;
}) {
  const isSent = item.direction === 'SENT';
  const isPending = item.status === 'PENDING';
  const isSettled = item.status === 'SETTLED';

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={s.cardLeft}>
          <View style={[s.dirBadge, isSent ? s.dirSent : s.dirReceived]}>
            <Text style={s.dirIcon}>{isSent ? '📤' : '📥'}</Text>
          </View>
          <View>
            <Text style={s.cardName}>{item.personName}</Text>
            <Text style={s.cardDate}>{isSent ? 'You lent' : 'You borrowed'} · {timeAgo(item.transferredAt)}</Text>
          </View>
        </View>
        <View style={[s.statusBadge, isPending ? s.statusPending : isSettled ? s.statusSettled : s.statusCancelled]}>
          <Text style={[s.statusText, isPending ? { color: '#f59e0b' } : isSettled ? { color: '#22c55e' } : { color: c.textMuted }]}>
            {isPending ? '⏳ Pending' : isSettled ? '✅ Settled' : '✗ Cancelled'}
          </Text>
        </View>
      </View>

      {/* Balance */}
      <View style={s.balanceRow}>
        {isPending ? (
          <>
            <Text style={s.balanceLabel}>{isSent ? 'Still owed to you' : 'You still owe'}</Text>
            <Text style={[s.balanceAmt, { color: isSent ? '#22c55e' : '#ef4444' }]}>{formatINR(item.outstanding)}</Text>
          </>
        ) : (
          <>
            <Text style={s.balanceLabel}>Total {isSent ? 'lent' : 'borrowed'}</Text>
            <Text style={[s.balanceAmt, { color: c.text }]}>{formatINR(item.totalPrincipal)}</Text>
          </>
        )}
      </View>
      <Text style={s.breakdown}>
        {isSent ? 'Sent' : 'Received'} {formatINR(item.totalPrincipal)} · Returned {formatINR(item.totalRepaid)}
      </Text>

      {/* Entries */}
      <View style={s.entryList}>
        {item.entries.map(e => {
          const legacyRow = e.id.startsWith('legacy-');
          const isPrincipal = e.kind === 'PRINCIPAL';
          // Money-flow icon: principal moves in the tab's direction; return reverses it.
          const outFlow = isPrincipal ? isSent : !isSent;
          const label = e.transaction ? e.transaction.merchant : (isPrincipal ? 'Manual amount' : 'Return (manual)');
          return (
            <View key={e.id} style={s.entryRow}>
              <Text style={s.entryIcon}>{outFlow ? '📤' : '📥'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.entryLabel} numberOfLines={1}>
                  {isPrincipal ? '' : '↩ '}{label}
                </Text>
                <Text style={s.entryDate}>{shortDate(e.occurredAt)}{e.transaction ? ' · 🔗 linked' : ''}</Text>
              </View>
              <Text style={[s.entryAmt, { color: isPrincipal ? c.text : '#22c55e' }]}>
                {isPrincipal ? '' : '+'}{formatINR(e.amount)}
              </Text>
              {isPending && !legacyRow && (
                <TouchableOpacity onPress={() => onRemoveEntry(e)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={s.entryRemove}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {item.note && <Text style={s.noteText}>📝 {item.note}</Text>}

      {/* Actions */}
      {isPending ? (
        <>
          <View style={s.cardActions}>
            <TouchableOpacity style={[s.actionBtn, s.addBtn]} onPress={onAddSend}>
              <Text style={s.addBtnText}>＋ {isSent ? 'Send' : 'Receipt'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.returnBtn]} onPress={onRecordReturn}>
              <Text style={s.returnBtnText}>＋ Return</Text>
            </TouchableOpacity>
          </View>
          <View style={s.cardActions}>
            <TouchableOpacity style={[s.actionBtn, s.settleBtn]} onPress={onSettleFull}>
              <Text style={s.settleBtnText}>✅ Settle in full</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.removeBtn]} onPress={onDelete}>
              <Text style={s.removeBtnText}>🗑</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={s.cardActions}>
          <TouchableOpacity style={[s.actionBtn, s.removeBtn, { flex: 1 }]} onPress={onDelete}>
            <Text style={s.removeBtnText}>🗑 Delete tab</Text>
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
    summaryCard: { flex: 1, borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: 'center', gap: 4 },
    summaryEmoji: { fontSize: 22 },
    summaryLabel: { fontSize: 11, fontWeight: '700' },
    summaryAmt: { fontSize: 18, fontWeight: '800' },

    explainerCard: {
      backgroundColor: c.card, borderRadius: 16, padding: 20,
      borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)', alignItems: 'center', gap: 10,
    },
    explainerIcon: { fontSize: 40 },
    explainerTitle: { color: c.text, fontSize: 17, fontWeight: '800' },
    explainerBody: { color: c.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center' },

    tabRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    tabBtnActive: { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: '#6366f1' },
    tabBtnText: { color: c.textMuted, fontSize: 13, fontWeight: '700' },
    tabBtnTextActive: { color: '#6366f1' },

    emptyWrap: { paddingVertical: 32, alignItems: 'center' },
    emptyText: { color: c.textMuted, fontSize: 14 },

    card: { backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, gap: 8 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dirBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    dirSent: { backgroundColor: 'rgba(239,68,68,0.12)' },
    dirReceived: { backgroundColor: 'rgba(34,197,94,0.12)' },
    dirIcon: { fontSize: 18 },
    cardName: { color: c.text, fontSize: 15, fontWeight: '700' },
    cardDate: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    statusPending: { backgroundColor: 'rgba(245,158,11,0.1)' },
    statusSettled: { backgroundColor: 'rgba(34,197,94,0.1)' },
    statusCancelled: { backgroundColor: c.bg },
    statusText: { fontSize: 11, fontWeight: '700' },

    balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 },
    balanceLabel: { color: c.textMuted, fontSize: 13, fontWeight: '600' },
    balanceAmt: { fontSize: 20, fontWeight: '800' },
    breakdown: { color: c.textMuted, fontSize: 12 },

    entryList: { gap: 6, marginTop: 2 },
    entryRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
      borderWidth: 1, borderColor: c.border,
    },
    entryIcon: { fontSize: 13 },
    entryLabel: { color: c.text, fontSize: 12.5, fontWeight: '600' },
    entryDate: { color: c.textMuted, fontSize: 10.5, marginTop: 1 },
    entryAmt: { fontSize: 13, fontWeight: '700' },
    entryRemove: { color: '#ef4444', fontSize: 14, fontWeight: '700', paddingLeft: 4 },

    noteText: { color: c.textMuted, fontSize: 12, fontStyle: 'italic' },

    cardActions: { flexDirection: 'row', gap: 8 },
    actionBtn: { borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, alignItems: 'center' },
    addBtn: { flex: 1, backgroundColor: 'rgba(99,102,241,0.10)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.3)' },
    addBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '700' },
    returnBtn: { flex: 1, backgroundColor: 'rgba(34,197,94,0.10)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
    returnBtnText: { color: '#22c55e', fontSize: 13, fontWeight: '700' },
    settleBtn: { flex: 1, backgroundColor: '#22c55e' },
    settleBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    removeBtn: { backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', paddingHorizontal: 14, alignItems: 'center' },
    removeBtnText: { fontSize: 14, color: '#ef4444', fontWeight: '700' },

    fab: {
      position: 'absolute', right: 20, bottom: 100,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center',
      elevation: 8, shadowColor: '#6366f1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 10,
    },
    fabText: { color: '#fff', fontSize: 26, lineHeight: 30 },
  });
}
