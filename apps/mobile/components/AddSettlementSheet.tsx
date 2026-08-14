import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

interface RecentTx {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT' | 'TRANSFER';
}

// A send being added to the new tab (before it's created). `amountStr` is the
// share that goes on the tab (editable); `fullAmount` is the linked transaction's
// total — if the share is smaller, the backend splits the transaction.
interface Leg {
  key: number;
  amountStr: string;
  fullAmount?: number;
  transactionId?: string;
  label: string;      // merchant name or "Manual amount"
  occurredAt: string; // ISO
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export default function AddSettlementSheet({ visible, onClose, onSaved }: Props) {
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { theme: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const keyRef = useRef(1);

  const [personName, setPersonName] = useState('');
  const [direction, setDirection] = useState<'SENT' | 'RECEIVED'>('SENT');
  const [note, setNote] = useState('');
  const [legs, setLegs] = useState<Leg[]>([]);
  const [manualAmount, setManualAmount] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setPersonName(''); setDirection('SENT'); setNote('');
      setLegs([]); setManualAmount(''); setShowPicker(false); setError('');
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

  // SENT → the sends are DEBITs; RECEIVED → they're CREDITs. Hide ones already added.
  const wanted = direction === 'SENT' ? 'DEBIT' : 'CREDIT';
  const addedTxIds = new Set(legs.map(l => l.transactionId).filter(Boolean));
  const relevantTxs = (txData?.data ?? []).filter(t => t.type === wanted && !addedTxIds.has(t.id));

  const legShare = (l: Leg) => parseFloat(l.amountStr) || 0;
  const total = legs.reduce((sum, l) => sum + legShare(l), 0);

  function addTxLeg(tx: RecentTx) {
    setLegs(prev => [...prev, {
      key: keyRef.current++, amountStr: String(tx.amount), fullAmount: tx.amount,
      transactionId: tx.id, label: tx.merchant, occurredAt: tx.date,
    }]);
    setShowPicker(false);
  }

  function addManualLeg() {
    const amt = parseFloat(manualAmount);
    if (!manualAmount || isNaN(amt) || amt <= 0) { setError('Enter a valid amount to add.'); return; }
    setError('');
    setLegs(prev => [...prev, { key: keyRef.current++, amountStr: manualAmount, label: 'Manual amount', occurredAt: new Date().toISOString() }]);
    setManualAmount('');
  }

  function setLegAmount(key: number, text: string) {
    setLegs(prev => prev.map(l => (l.key === key ? { ...l, amountStr: text } : l)));
  }

  function removeLeg(key: number) {
    setLegs(prev => prev.filter(l => l.key !== key));
  }

  function changeDirection(d: 'SENT' | 'RECEIVED') {
    setDirection(d);
    setLegs([]); // tx type filter changes — start the list fresh
    setShowPicker(false);
  }

  async function handleSubmit() {
    if (!personName.trim()) { setError('Person name is required.'); return; }
    if (legs.length === 0) { setError('Add at least one transfer.'); return; }
    if (legs.some(l => legShare(l) <= 0)) { setError('Every row needs an amount above 0.'); return; }
    setSaving(true);
    setError('');
    try {
      const token = await getToken();
      await apiFetch('/settlements', token!, {
        method: 'POST',
        body: JSON.stringify({
          personName: personName.trim(),
          direction,
          ...(note.trim() && { note: note.trim() }),
          principals: legs.map(l => ({
            // Cap the tab share at the linked transaction's total.
            amount: l.fullAmount ? Math.min(legShare(l), l.fullAmount) : legShare(l),
            occurredAt: l.occurredAt,
            ...(l.transactionId && { transactionId: l.transactionId }),
          })),
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
          <Text style={s.title}>New Settlement Tab</Text>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Direction */}
            <Text style={s.label}>What happened?</Text>
            <View style={s.chips}>
              <TouchableOpacity style={[s.chip, direction === 'SENT' && s.chipActive]} onPress={() => changeDirection('SENT')}>
                <Text style={[s.chipText, direction === 'SENT' && s.chipTextActive]}>📤 I sent money</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.chip, direction === 'RECEIVED' && s.chipActive]} onPress={() => changeDirection('RECEIVED')}>
                <Text style={[s.chipText, direction === 'RECEIVED' && s.chipTextActive]}>📥 I received money</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.helperText}>
              {direction === 'SENT'
                ? 'You sent money — expecting it back. Add every send; they’re excluded from expenses.'
                : 'You received money — planning to return it. Add every receipt; they’re excluded from income.'}
            </Text>

            {/* Person */}
            <Text style={s.label}>Person / Contact</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Ravi, Mom, Colleague"
              placeholderTextColor={c.textMuted}
              value={personName}
              onChangeText={setPersonName}
            />

            {/* The sends list */}
            <Text style={s.label}>{direction === 'SENT' ? 'Sends' : 'Receipts'} on this tab</Text>
            {legs.length === 0 ? (
              <Text style={s.emptyLegs}>None yet — pick transactions or add an amount below.</Text>
            ) : (
              <View style={s.legList}>
                {legs.map(l => {
                  const share = legShare(l);
                  const remainder = l.fullAmount && share > 0 && share < l.fullAmount - 0.005 ? l.fullAmount - share : 0;
                  return (
                    <View key={l.key} style={s.legRowWrap}>
                      <View style={s.legRow}>
                        <Text style={s.legLabel} numberOfLines={1}>
                          {l.transactionId ? '🔗 ' : '✏️ '}{l.label}
                        </Text>
                        <TextInput
                          style={s.legAmtInput}
                          keyboardType="decimal-pad"
                          value={l.amountStr}
                          onChangeText={t => setLegAmount(l.key, t)}
                        />
                        <TouchableOpacity onPress={() => removeLeg(l.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={s.legRemove}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      {remainder > 0 && (
                        <Text style={s.legSplit}>
                          ✂️ of {formatINR(l.fullAmount!)} · {formatINR(remainder)} stays your {direction === 'SENT' ? 'expense' : 'income'}
                        </Text>
                      )}
                    </View>
                  );
                })}
                <View style={s.legTotalRow}>
                  <Text style={s.legTotalLabel}>On the tab</Text>
                  <Text style={s.legTotalAmt}>{formatINR(total)}</Text>
                </View>
              </View>
            )}

            {/* Add from recent transactions */}
            <TouchableOpacity style={s.linkBtn} onPress={() => setShowPicker(v => !v)}>
              <Text style={s.linkBtnText}>{showPicker ? '▲ Hide transactions' : '＋ Add from recent transactions'}</Text>
            </TouchableOpacity>
            {showPicker && (
              <View style={s.pickerWrap}>
                {relevantTxs.length === 0 ? (
                  <Text style={s.pickerEmpty}>No {wanted.toLowerCase()} transactions available.</Text>
                ) : (
                  relevantTxs.slice(0, 15).map(tx => (
                    <TouchableOpacity key={tx.id} style={s.pickerItem} onPress={() => addTxLeg(tx)}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.pickerMerchant} numberOfLines={1}>{tx.merchant}</Text>
                        <Text style={s.pickerDate}>{new Date(tx.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
                      </View>
                      <Text style={s.pickerAmt}>+ {formatINR(tx.amount)}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            {/* Or add a manual amount */}
            <View style={s.manualRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="Or type an amount (₹)"
                placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad"
                value={manualAmount}
                onChangeText={setManualAmount}
              />
              <TouchableOpacity style={s.manualAddBtn} onPress={addManualLeg}>
                <Text style={s.manualAddText}>Add</Text>
              </TouchableOpacity>
            </View>

            {/* Note */}
            <Text style={s.label}>Note (optional)</Text>
            <TextInput
              style={[s.input, { height: 60, textAlignVertical: 'top' }]}
              placeholder="e.g. Shared dinner, lent for petrol…"
              placeholderTextColor={c.textMuted}
              multiline
              value={note}
              onChangeText={setNote}
            />

            {error ? <Text style={s.error}>{error}</Text> : null}
          </ScrollView>

          <View style={s.footer}>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.saveBtn} onPress={handleSubmit} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Create tab{legs.length ? ` · ${formatINR(total)}` : ''}</Text>}
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
    sheet: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
    title: { color: c.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
    label: { color: c.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.text, fontSize: 15 },
    helperText: { color: '#6366f1', fontSize: 12, lineHeight: 17, marginTop: 6, paddingHorizontal: 2 },
    chips: { flexDirection: 'row', gap: 10 },
    chip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, alignItems: 'center' },
    chipActive: { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: '#6366f1' },
    chipText: { color: c.textMuted, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#6366f1' },

    emptyLegs: { color: c.textMuted, fontSize: 12, fontStyle: 'italic', paddingVertical: 6 },
    legList: { borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
    legRowWrap: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.bg },
    legRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
    legLabel: { flex: 1, color: c.text, fontSize: 13, fontWeight: '600' },
    legAmtInput: {
      minWidth: 74, textAlign: 'right', color: c.text, fontSize: 13, fontWeight: '700',
      paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.card,
    },
    legRemove: { color: '#ef4444', fontSize: 15, fontWeight: '700', paddingLeft: 2 },
    legSplit: { color: '#6366f1', fontSize: 11, fontWeight: '600', paddingHorizontal: 12, paddingBottom: 8 },
    legTotalRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, backgroundColor: 'rgba(99,102,241,0.06)' },
    legTotalLabel: { color: c.textMuted, fontSize: 13, fontWeight: '700' },
    legTotalAmt: { color: '#6366f1', fontSize: 14, fontWeight: '800' },

    linkBtn: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, alignItems: 'center', marginTop: 10 },
    linkBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '600' },
    pickerWrap: { marginTop: 6, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.bg, gap: 10 },
    pickerMerchant: { color: c.text, fontSize: 14, fontWeight: '600' },
    pickerDate: { color: c.textMuted, fontSize: 11, marginTop: 2 },
    pickerAmt: { color: '#22c55e', fontSize: 14, fontWeight: '700' },
    pickerEmpty: { color: c.textMuted, fontSize: 13, padding: 14, textAlign: 'center' },

    manualRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10 },
    manualAddBtn: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, backgroundColor: 'rgba(99,102,241,0.12)', borderWidth: 1, borderColor: '#6366f1' },
    manualAddText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },

    error: { color: '#ef4444', fontSize: 13, marginTop: 10 },
    footer: { flexDirection: 'row', gap: 10, marginTop: 16 },
    cancelBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
    cancelText: { color: c.textMuted, fontSize: 15, fontWeight: '700' },
    saveBtn: { flex: 2, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#6366f1' },
    saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
}
