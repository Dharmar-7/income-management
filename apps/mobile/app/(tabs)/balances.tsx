import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { bankColor } from '@/lib/bankColors';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import SlowSaveHint from '@/components/SlowSaveHint';
import type { Theme } from '@/lib/theme';

// Bank balances. IOB/TMB SMS say "Bal: NA", so Velora can't read balances from
// messages. You type each bank's balance once; the server moves it forward by
// that bank's transactions since then (see backend banks/bank-balance.util.ts).

interface Tracked { current: number; change: number; counted: number; unknown: number }
interface BankRow {
  id: string;
  name: string;
  color: string;
  balance: number | null;
  balanceAt: string | null;
  tracked: Tracked | null;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function signedINR(n: number) {
  return `${n >= 0 ? '+' : '−'}${formatINR(Math.abs(n))}`;
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (days === 0) return `today`;
  if (days === 1) return `yesterday`;
  return `on ${date}`;
}

export default function BalancesScreen() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [editing, setEditing] = useState<BankRow | null>(null);

  const banksQ = useQuery<BankRow[]>({
    queryKey: ['banks'],
    queryFn: async () => apiFetch('/banks', (await getToken())!),
  });
  const cashQ = useQuery<{ balance: number }>({
    queryKey: ['cash', 'balance'],
    queryFn: async () => apiFetch('/cash/balance', (await getToken())!),
  });

  // Transactions change all over the app; recompute whenever this screen shows.
  const { refetch: refetchBanks } = banksQ;
  const { refetch: refetchCash } = cashQ;
  useFocusEffect(useCallback(() => { refetchBanks(); refetchCash(); }, [refetchBanks, refetchCash]));

  const banks = banksQ.data ?? [];
  const tracked = banks.filter(b => b.tracked);
  const cash = cashQ.data?.balance ?? 0;
  const bankTotal = tracked.reduce((n, b) => n + b.tracked!.current, 0);
  const total = bankTotal + cash;

  async function save(bank: BankRow, balance: number | null) {
    const token = await getToken();
    await apiFetch(`/banks/${bank.id}`, token!, { method: 'PATCH', body: JSON.stringify({ balance }) });
    await qc.invalidateQueries({ queryKey: ['banks'] });
    toast.show(balance === null ? `Stopped tracking ${bank.name}` : `${bank.name} balance set to ${formatINR(balance)}`, { type: 'success' });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={banksQ.isRefetching}
            onRefresh={() => { refetchBanks(); refetchCash(); }}
            tintColor={c.textMuted}
          />
        }
      >
        {/* Total */}
        <View style={s.totalCard}>
          <Text style={s.totalLabel}>Total money</Text>
          <Text style={s.totalAmt}>{formatINR(total)}</Text>
          <Text style={s.totalSub}>
            {tracked.length > 0
              ? `${tracked.length} bank${tracked.length === 1 ? '' : 's'} ${formatINR(bankTotal)} · cash in hand ${formatINR(cash)}`
              : `Cash in hand ${formatINR(cash)} · set a bank balance below`}
          </Text>
        </View>

        {banksQ.isLoading && <ActivityIndicator color={c.textMuted} style={{ marginTop: 24 }} />}

        {!banksQ.isLoading && banks.length === 0 && (
          <View style={s.card}>
            <Text style={s.emptyTitle}>No banks yet</Text>
            <Text style={s.muted}>
              Banks are added from a transaction’s Bank field. Add one there (for example IOB or TMB), then set its balance here.
            </Text>
          </View>
        )}

        {banks.map(b => {
          const col = bankColor(b.color).base;
          const t = b.tracked;
          return (
            <View key={b.id} style={s.card}>
              <View style={s.rowTop}>
                <View style={[s.dot, { backgroundColor: col }]} />
                <Text style={s.bankName} numberOfLines={1}>{b.name}</Text>
                <TouchableOpacity onPress={() => setEditing(b)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={s.link}>{t ? 'Update' : 'Set balance'}</Text>
                </TouchableOpacity>
              </View>

              {t && b.balance != null && b.balanceAt ? (
                <>
                  <Text style={[s.balance, t.current < 0 && { color: c.danger }]}>{formatINR(t.current)}</Text>
                  <Text style={s.muted}>
                    You set {formatINR(b.balance)} {whenLabel(b.balanceAt)}
                    {t.counted > 0
                      ? ` · ${signedINR(t.change)} from ${t.counted} transaction${t.counted === 1 ? '' : 's'} since`
                      : ' · no transactions since'}
                  </Text>
                  {t.unknown > 0 && (
                    <Text style={[s.muted, { marginTop: 4 }]}>
                      {t.unknown} transfer{t.unknown === 1 ? '' : 's'} not counted (direction unknown).
                    </Text>
                  )}
                </>
              ) : (
                <Text style={[s.muted, { marginTop: 6 }]}>Not tracked yet. Tap “Set balance” and type what your bank app shows.</Text>
              )}
            </View>
          );
        })}

        {/* Cash in hand, for completeness */}
        <View style={s.card}>
          <View style={s.rowTop}>
            <Text style={{ fontSize: 16 }}>💵</Text>
            <Text style={[s.bankName, { marginLeft: 8 }]}>Cash in hand</Text>
          </View>
          <Text style={s.balance}>{formatINR(cash)}</Text>
          <Text style={s.muted}>From your Cash in Hand entries on Home.</Text>
        </View>

        <Text style={s.footnote}>
          Your bank SMS don’t include the balance, so type each bank’s balance once. Velora then keeps it up to date
          from that bank’s transactions (SMS, manual and imported). If it ever drifts, for example after a missed SMS,
          tap Update and type the real balance again.
        </Text>
      </ScrollView>

      {editing && (
        <BalanceSheet
          bank={editing}
          c={c}
          onClose={() => setEditing(null)}
          onSave={async (v) => { await save(editing, v); setEditing(null); }}
        />
      )}
    </SafeAreaView>
  );
}

function BalanceSheet({ bank, c, onClose, onSave }: {
  bank: BankRow; c: Theme; onClose: () => void; onSave: (balance: number | null) => Promise<void>;
}) {
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const [value, setValue] = useState(bank.tracked ? String(Math.round(bank.tracked.current * 100) / 100) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function run(balance: number | null) {
    setSaving(true);
    setError('');
    try {
      await onSave(balance);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save.');
      setSaving(false);
    }
  }

  function submit() {
    const n = parseFloat(value.replace(/,/g, ''));
    if (value.trim() === '' || isNaN(n)) { setError('Enter the balance your bank app shows.'); return; }
    run(Math.round(n * 100) / 100);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, kb) + 20 }]}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{bank.name} balance</Text>
          <Text style={s.muted}>Type the balance your bank app or passbook shows right now.</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            placeholder="e.g. 25000"
            placeholderTextColor={c.textFaint}
            style={s.input}
            autoFocus
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <TouchableOpacity style={s.saveBtn} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={c.onColor} /> : <Text style={s.saveText}>Save balance</Text>}
          </TouchableOpacity>
          {saving && <SlowSaveHint />}
          {bank.tracked && !saving && (
            <TouchableOpacity onPress={() => run(null)} style={{ alignSelf: 'center', marginTop: 14 }}>
              <Text style={[s.muted, { color: c.danger }]}>Stop tracking this bank</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={{ alignSelf: 'center', marginTop: 14 }} disabled={saving}>
            <Text style={s.muted}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  scroll: { padding: 16, gap: 12, paddingBottom: 100 },
  totalCard: {
    backgroundColor: c.card, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center',
  },
  totalLabel: { fontSize: 12, fontWeight: '700', color: c.textMuted, letterSpacing: 0.5 },
  totalAmt: { fontSize: 30, fontWeight: '800', color: c.text, marginTop: 4 },
  totalSub: { fontSize: 12, color: c.textMuted, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  bankName: { flex: 1, fontSize: 16, fontWeight: '700', color: c.text },
  link: { fontSize: 13, fontWeight: '700', color: c.primary },
  balance: { fontSize: 24, fontWeight: '800', color: c.text, marginTop: 8 },
  muted: { fontSize: 12, lineHeight: 17, color: c.textMuted },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 4 },
  footnote: { fontSize: 12, lineHeight: 18, color: c.textFaint, marginTop: 4, paddingHorizontal: 4 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 4 },
  input: {
    marginTop: 14, backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700', color: c.text,
  },
  error: { color: c.danger, fontSize: 12, marginTop: 8 },
  saveBtn: { marginTop: 16, backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: c.onColor, fontSize: 15, fontWeight: '700' },
});
