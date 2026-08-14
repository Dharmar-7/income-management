import { useState, useMemo, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import DatePickerField from '@/components/DatePickerField';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

interface RecentTx {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT' | 'TRANSFER';
}

// Which real transaction type a leg should link to.
//  SENT principal = DEBIT, SENT return = CREDIT
//  RECEIVED principal = CREDIT, RECEIVED return = DEBIT
function targetTxType(direction: 'SENT' | 'RECEIVED', kind: 'PRINCIPAL' | 'REPAYMENT') {
  if (direction === 'SENT') return kind === 'PRINCIPAL' ? 'DEBIT' : 'CREDIT';
  return kind === 'PRINCIPAL' ? 'CREDIT' : 'DEBIT';
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  visible: boolean;
  settlementId: string;
  kind: 'PRINCIPAL' | 'REPAYMENT';
  direction: 'SENT' | 'RECEIVED';
  onClose: () => void;
  onSaved: () => void;
}

// Adds one leg (another send, or a return) to an existing settlement tab. Pick a
// real transaction (it gets excluded from income/expense) or enter a manual amount.
export default function SettlementLegSheet({ visible, settlementId, kind, direction, onClose, onSaved }: Props) {
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString());
  const [linkedTxId, setLinkedTxId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setAmount(''); setOccurredAt(new Date().toISOString());
      setLinkedTxId(null); setShowPicker(false); setError('');
    }
  }, [visible]);

  const { data: txData } = useQuery<{ data: RecentTx[] }>({
    queryKey: ['transactions', 'recent-for-settle'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch('/transactions?limit=50&sortBy=date&sortOrder=desc', token!);
    },
    enabled: visible,
  });

  const wanted = targetTxType(direction, kind);
  const relevantTxs = (txData?.data ?? []).filter(t => t.type === wanted);
  const linkedTx = linkedTxId ? relevantTxs.find(t => t.id === linkedTxId) : null;

  const isReturn = kind === 'REPAYMENT';
  const title = isReturn ? 'Record a return' : 'Add another send';

  // If a transaction is linked but you're only putting part of it on the tab,
  // the rest stays your real expense/income (the backend splits the row).
  const parsedAmt = parseFloat(amount);
  const splitRemainder =
    linkedTx && parsedAmt > 0 && parsedAmt < linkedTx.amount - 0.005
      ? linkedTx.amount - parsedAmt
      : 0;

  async function submit() {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    setSaving(true);
    setError('');
    try {
      const token = await getToken();
      await apiFetch(`/settlements/${settlementId}/entries`, token!, {
        method: 'POST',
        body: JSON.stringify({
          kind, amount: amt,
          occurredAt: new Date(occurredAt).toISOString(),
          ...(linkedTxId && { transactionId: linkedTxId }),
        }),
      });
      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, kb) + 20 }]}>
          <View style={s.handle} />
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>
            {isReturn
              ? 'Money coming back. Link the real transaction so it stays out of your income/expense.'
              : 'Another transfer to the same person. It joins this tab and is excluded from expense.'}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Amount on this tab (₹)</Text>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={c.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            {linkedTx ? (
              <Text style={s.amountHint}>
                Transaction is {formatINR(linkedTx.amount)}. Lower this if only part of it is theirs.
              </Text>
            ) : null}
            {splitRemainder > 0 && (
              <View style={s.splitNote}>
                <Text style={s.splitNoteText}>
                  ✂️ Split: {formatINR(parsedAmt)} goes on this tab; the remaining {formatINR(splitRemainder)} stays your {isReturn ? 'income' : 'expense'}.
                </Text>
              </View>
            )}

            <Text style={s.label}>Date</Text>
            <DatePickerField value={occurredAt} onChange={setOccurredAt} />

            <Text style={s.label}>Link to transaction (optional)</Text>
            {linkedTx ? (
              <TouchableOpacity style={s.linkedChip} onPress={() => setLinkedTxId(null)}>
                <Text style={s.linkedText} numberOfLines={1}>🔗 {linkedTx.merchant} · {formatINR(linkedTx.amount)}</Text>
                <Text style={s.linkedRemove}>✕</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.linkBtn} onPress={() => setShowPicker(v => !v)}>
                <Text style={s.linkBtnText}>{showPicker ? '▲ Hide transactions' : '▼ Pick from recent transactions'}</Text>
              </TouchableOpacity>
            )}

            {showPicker && !linkedTx && (
              <View style={s.pickerWrap}>
                {relevantTxs.length === 0 ? (
                  <Text style={s.pickerEmpty}>No {wanted.toLowerCase()} transactions found.</Text>
                ) : (
                  relevantTxs.slice(0, 15).map(tx => (
                    <TouchableOpacity
                      key={tx.id}
                      style={s.pickerItem}
                      onPress={() => { setLinkedTxId(tx.id); setAmount(String(tx.amount)); setShowPicker(false); }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.pickerMerchant} numberOfLines={1}>{tx.merchant}</Text>
                        <Text style={s.pickerDate}>{new Date(tx.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
                      </View>
                      <Text style={s.pickerAmt}>{formatINR(tx.amount)}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            {error ? <Text style={s.error}>{error}</Text> : null}
          </ScrollView>

          <View style={s.footer}>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.saveBtn} onPress={submit} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{isReturn ? 'Add return' : 'Add send'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
    title: { color: c.text, fontSize: 18, fontWeight: '800' },
    subtitle: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 4 },
    label: { color: c.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.text, fontSize: 15 },
    amountHint: { color: c.textFaint, fontSize: 11, marginTop: 5 },
    splitNote: { marginTop: 8, backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(99,102,241,0.22)' },
    splitNoteText: { color: '#6366f1', fontSize: 12, lineHeight: 17, fontWeight: '600' },
    linkedChip: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 12, padding: 12,
      borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)',
    },
    linkedText: { color: '#6366f1', fontSize: 13, fontWeight: '600', flex: 1 },
    linkedRemove: { color: c.textMuted, fontSize: 16, paddingLeft: 8 },
    linkBtn: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, alignItems: 'center' },
    linkBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '600' },
    pickerWrap: { marginTop: 6, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    pickerItem: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: 12, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.bg, gap: 10,
    },
    pickerMerchant: { color: c.text, fontSize: 14, fontWeight: '600' },
    pickerDate: { color: c.textMuted, fontSize: 11, marginTop: 2 },
    pickerAmt: { color: c.text, fontSize: 14, fontWeight: '700' },
    pickerEmpty: { color: c.textMuted, fontSize: 13, padding: 14, textAlign: 'center' },
    error: { color: '#ef4444', fontSize: 13, marginTop: 10 },
    footer: { flexDirection: 'row', gap: 10, marginTop: 16 },
    cancelBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
    cancelText: { color: c.textMuted, fontSize: 15, fontWeight: '700' },
    saveBtn: { flex: 2, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#6366f1' },
    saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
}
