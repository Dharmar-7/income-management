import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator, ScrollView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// Bank balances on the Home header. IOB/TMB SMS say "Bal: NA", so Velora can't
// read balances from messages: the user types each bank's balance once, and the
// server moves it forward by that bank's transactions since then (see backend
// banks/bank-balance.util.ts). The chip shows the total; tapping it opens a
// sheet with each bank and an Update action.

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

// Short form for the chip, so big balances fit the header.
function compactINR(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const one = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e7) return `${sign}₹${one(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${one(a / 1e5)}L`;
  return `${sign}${formatINR(a)}`;
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `on ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

function useBanks() {
  const { getToken } = useAuth();
  const q = useQuery<BankRow[]>({
    queryKey: ['banks'],
    queryFn: async () => apiFetch('/banks', (await getToken())!),
  });
  // Transactions change all over the app; recompute when Home comes back into view.
  const { refetch } = q;
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  return q;
}

export default function BankBalanceChip() {
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);
  const { data } = useBanks();

  const tracked = (data ?? []).filter(b => b.tracked);
  const total = tracked.reduce((n, b) => n + b.tracked!.current, 0);

  return (
    <>
      <TouchableOpacity
        style={s.chip}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={tracked.length ? `Bank balance ${formatINR(total)}` : 'Set your bank balances'}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      >
        <Text style={s.chipLabel}>🏦 Bank</Text>
        <Text style={[s.chipAmt, total < 0 && { color: c.danger }]} numberOfLines={1}>
          {tracked.length ? compactINR(total) : 'Set ›'}
        </Text>
      </TouchableOpacity>
      {open && <BankBalancesSheet banks={data ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}

function BankBalancesSheet({ banks, onClose }: { banks: BankRow[]; onClose: () => void }) {
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [editing, setEditing] = useState<BankRow | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const tracked = banks.filter(b => b.tracked);
  const total = tracked.reduce((n, b) => n + b.tracked!.current, 0);

  function startEdit(b: BankRow) {
    setEditing(b);
    setValue(b.tracked ? String(Math.round(b.tracked.current * 100) / 100) : '');
    setError('');
  }

  async function save(balance: number | null) {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      const token = await getToken();
      await apiFetch(`/banks/${editing.id}`, token!, { method: 'PATCH', body: JSON.stringify({ balance }) });
      await qc.invalidateQueries({ queryKey: ['banks'] });
      toast.show(
        balance === null ? `Stopped tracking ${editing.name}` : `${editing.name} balance set to ${formatINR(balance)}`,
        { type: 'success' },
      );
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save.');
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    const n = parseFloat(value.replace(/,/g, ''));
    if (value.trim() === '' || isNaN(n)) { setError('Enter the balance your bank app shows.'); return; }
    save(Math.round(n * 100) / 100);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={editing ? () => setEditing(null) : onClose}>
      <Pressable style={s.overlay} onPress={saving ? undefined : onClose}>
        {/* Inner Pressable swallows taps so only the backdrop closes the sheet. */}
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, kb) + 20 }]} onPress={() => undefined}>
          <View style={s.handle} />

          {editing ? (
            <>
              <Text style={s.title}>{editing.name} balance</Text>
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
              {!saving && (
                <View style={s.editLinks}>
                  <TouchableOpacity onPress={() => setEditing(null)}>
                    <Text style={s.muted}>‹ Back</Text>
                  </TouchableOpacity>
                  {editing.tracked && (
                    <TouchableOpacity onPress={() => save(null)}>
                      <Text style={[s.muted, { color: c.danger }]}>Stop tracking</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={s.title}>Bank balances</Text>
              <Text style={s.total}>{tracked.length ? formatINR(total) : '—'}</Text>
              <Text style={s.muted}>
                {tracked.length
                  ? `Total across ${tracked.length} bank${tracked.length === 1 ? '' : 's'}`
                  : 'Set a balance for each bank to see your total here.'}
              </Text>

              <ScrollView style={{ maxHeight: 380, marginTop: 12 }}>
                {banks.length === 0 && (
                  <Text style={[s.muted, { marginTop: 8 }]}>
                    No banks yet. Add one from a transaction’s Bank field (for example IOB or TMB), then set its balance here.
                  </Text>
                )}
                {banks.map(b => {
                  const t = b.tracked;
                  return (
                    <View key={b.id} style={s.row}>
                      <View style={[s.dot, { backgroundColor: bankColor(b.color).base }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.bankName} numberOfLines={1}>{b.name}</Text>
                        <Text style={s.small} numberOfLines={2}>
                          {t && b.balance != null && b.balanceAt
                            ? `Set ${formatINR(b.balance)} ${whenLabel(b.balanceAt)}` +
                              (t.counted ? ` · ${t.change >= 0 ? '+' : '−'}${formatINR(Math.abs(t.change))} from ${t.counted} since` : '') +
                              (t.unknown ? ` · ${t.unknown} transfer${t.unknown === 1 ? '' : 's'} not counted` : '')
                            : 'Not set yet'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {t && <Text style={[s.bankAmt, t.current < 0 && { color: c.danger }]}>{formatINR(t.current)}</Text>}
                        <TouchableOpacity onPress={() => startEdit(b)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={s.link}>{t ? 'Update' : 'Set balance'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <Text style={s.footnote}>
                Your bank SMS don’t include the balance, so type it once. Velora keeps it up to date from that bank’s
                transactions. If it drifts, tap Update.
              </Text>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  chip: {
    minWidth: 64, maxWidth: 130, height: 40, paddingHorizontal: 10, borderRadius: 14,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    alignItems: 'flex-end', justifyContent: 'center',
  },
  chipLabel: { fontSize: 9, fontWeight: '700', color: c.textFaint, letterSpacing: 0.3 },
  chipAmt: { fontSize: 14, fontWeight: '800', color: c.text },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: c.text },
  total: { fontSize: 28, fontWeight: '800', color: c.text, marginTop: 6 },
  muted: { fontSize: 12, lineHeight: 17, color: c.textMuted },
  small: { fontSize: 11, lineHeight: 15, color: c.textFaint, marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: c.cardBorder,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bankName: { fontSize: 15, fontWeight: '700', color: c.text },
  bankAmt: { fontSize: 15, fontWeight: '800', color: c.text },
  link: { fontSize: 12, fontWeight: '700', color: c.primary, marginTop: 2 },
  footnote: { fontSize: 11, lineHeight: 16, color: c.textFaint, marginTop: 12 },
  input: {
    marginTop: 14, backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700', color: c.text,
  },
  error: { color: c.danger, fontSize: 12, marginTop: 8 },
  saveBtn: { marginTop: 16, backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: c.onColor, fontSize: 15, fontWeight: '700' },
  editLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
});
