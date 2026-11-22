import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import AppAlert from '@/components/AppAlert';
import DatePickerField from '@/components/DatePickerField';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

type SheetMode = 'add' | 'spend';

const SOURCE_OPTIONS_IN = [
  { value: 'ATM',    label: 'ATM Withdrawal', icon: '🏧' },
  { value: 'PERSON', label: 'From Person',     icon: '🤝' },
  { value: 'OTHER',  label: 'Other',           icon: '💵' },
];

const SOURCE_OPTIONS_OUT = [
  { value: 'SPENT',     label: 'Cash Payment',  icon: '🛍️' },
  { value: 'DEPOSITED', label: 'Bank Deposit',  icon: '🏦' },
];

interface Props {
  visible: boolean;
  mode: SheetMode;
  currentBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

export default function CashSheet({ visible, mode, currentBalance, onClose, onSuccess }: Props) {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  const [amount, setAmount] = useState('');
  const [source, setSource] = useState(mode === 'add' ? 'ATM' : 'SPENT');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO);
  const [loading, setLoading] = useState(false);
  // After a few seconds of saving, explain the wait (the server may be waking up).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [loading]);

  const options = mode === 'add' ? SOURCE_OPTIONS_IN : SOURCE_OPTIONS_OUT;

  function reset() {
    setAmount('');
    setSource(mode === 'add' ? 'ATM' : 'SPENT');
    setNote('');
    setDate(todayISO());
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      setAlertInfo({ title: 'Invalid amount', message: 'Please enter a valid amount.' });
      return;
    }
    if (mode === 'spend' && parsed > currentBalance) {
      setAlertInfo({ title: 'Insufficient cash', message: `You only have ${formatINR(currentBalance)} in hand.` });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setAlertInfo({ title: 'Invalid date', message: 'Enter date as YYYY-MM-DD.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const endpoint = mode === 'add' ? '/cash/add' : '/cash/spend';
      await apiFetch(endpoint, token!, {
        method: 'POST',
        body: JSON.stringify({
          amount: parsed,
          source,
          note: note.trim() || undefined,
          date,
        }),
      });
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      setAlertInfo({ title: 'Error', message: err.message ?? 'Failed to save.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />

        <View
          style={[
            styles.sheet,
            {
              paddingBottom: keyboardHeight > 0 ? 16 : Math.max(insets.bottom, 24),
              marginBottom: keyboardHeight,
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>
              {mode === 'add' ? '💵 Add Cash' : '💸 Spend Cash'}
            </Text>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {mode === 'spend' && (
            <View style={styles.balanceBanner}>
              <Text style={styles.balanceBannerText}>
                Cash in hand: {formatINR(currentBalance)}
              </Text>
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {/* Source chips */}
            <Text style={styles.label}>Source</Text>
            <View style={styles.chipRow}>
              {options.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, source === opt.value && styles.chipActive]}
                  onPress={() => setSource(opt.value)}
                >
                  <Text style={[styles.chipText, source === opt.value && styles.chipTextActive]}>
                    {opt.icon} {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Amount */}
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={c.textFaint}
              keyboardType="decimal-pad"
              style={styles.input}
            />

            {/* Date */}
            <DatePickerField label="Date" value={date} onChange={setDate} placeholder="Tap to pick a date" style={{ marginBottom: 16 }} />

            {/* Note */}
            <Text style={styles.label}>Note <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Grocery run"
              placeholderTextColor={c.textFaint}
              style={styles.input}
              maxLength={300}
            />

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.6 },
                mode === 'spend' && styles.submitBtnSpend]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={c.onColor} />
                : <Text style={styles.submitText}>
                    {mode === 'add' ? 'Add Cash' : 'Record Spend'}
                  </Text>
              }
            </TouchableOpacity>
            {slow && (
              <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 }}>
                Waking up the server… the first save after a while can take up to a minute.
              </Text>
            )}

          </ScrollView>
        </View>
      </View>
    </Modal>

    <AppAlert
      visible={alertInfo !== null}
      title={alertInfo?.title ?? ''}
      message={alertInfo?.message ?? ''}
      onClose={() => setAlertInfo(null)}
    />
    </>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, maxHeight: '90%',
  },
  handle: { width: 40, height: 4, backgroundColor: c.inputBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },

  balanceBanner: { backgroundColor: '#fef3c7', borderRadius: 12, padding: 10, marginBottom: 16 },
  balanceBannerText: { fontSize: 13, color: '#92400e', fontWeight: '600', textAlign: 'center' },

  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: c.text, marginBottom: 12,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99,
    backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.inputBorder,
  },
  chipActive: { backgroundColor: c.warning, borderColor: c.warning },
  chipText: { fontSize: 13, color: c.textMuted, fontWeight: '500' },
  chipTextActive: { color: c.onColor },

  submitBtn: { backgroundColor: c.success, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnSpend: { backgroundColor: c.orange },
  submitText: { color: c.onColor, fontSize: 16, fontWeight: '700' },
});
