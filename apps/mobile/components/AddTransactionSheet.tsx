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
import BankPickerField from '@/components/BankPickerField';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

interface Category {
  id: string;
  name: string;
  icon: string;
}

type TxType = 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT' | 'TRANSFER';

// The subset of a transaction the sheet needs to pre-fill the edit form.
export interface EditingTransaction {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: TxType;
  description: string | null;
  category: { id: string } | null;
  bank?: { id: string } | null;
}

interface Props {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
  // When set, the sheet edits this transaction instead of creating a new one.
  editing?: EditingTransaction | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AddTransactionSheet({ visible, categories, onClose, onSuccess, editing }: Props) {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  const isEdit = !!editing;

  const [txType, setTxType] = useState<TxType>('DEBIT');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [bankId, setBankId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO);
  const [description, setDescription] = useState('');
  const [showCategories, setShowCategories] = useState(false);
  const [loading, setLoading] = useState(false);

  // When the sheet opens, seed the form: from the transaction being edited,
  // or back to blank defaults for a new one.
  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setTxType(editing.type);
      setAmount(String(editing.amount));
      setMerchant(editing.merchant);
      setCategoryId(editing.category?.id ?? '');
      setBankId(editing.bank?.id ?? null);
      setDate(editing.date.slice(0, 10));
      setDescription(editing.description ?? '');
    } else {
      reset();
    }
    setShowCategories(false);
  }, [visible, editing]);

  function reset() {
    setTxType('DEBIT');
    setAmount('');
    setMerchant('');
    setCategoryId('');
    setBankId(null);
    setDate(todayISO());
    setDescription('');
    setShowCategories(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!amount || !merchant || !date) {
      setAlertInfo({ title: 'Missing fields', message: 'Amount, merchant, and date are required.' });
      return;
    }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setAlertInfo({ title: 'Invalid amount', message: 'Please enter a valid amount.' });
      return;
    }
    // Basic date validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setAlertInfo({ title: 'Invalid date', message: 'Enter date as YYYY-MM-DD.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      if (isEdit && editing) {
        // PATCH only the editable fields. Empty category/note are sent as ''
        // so the backend can clear them.
        await apiFetch(`/transactions/${editing.id}`, token!, {
          method: 'PATCH',
          body: JSON.stringify({
            amount: parsed,
            merchant: merchant.trim(),
            type: txType,
            date,
            categoryId,
            bankId: bankId ?? '',
            description: description.trim(),
          }),
        });
      } else {
        await apiFetch('/transactions', token!, {
          method: 'POST',
          body: JSON.stringify({
            amount: parsed,
            merchant: merchant.trim(),
            type: txType,
            date,
            categoryId: categoryId || undefined,
            bankId: bankId || undefined,
            description: description.trim() || undefined,
          }),
        });
      }
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      setAlertInfo({
        title: 'Error',
        message: err.message ?? (isEdit ? 'Failed to save changes.' : 'Failed to add transaction.'),
      });
    } finally {
      setLoading(false);
    }
  }

  const selectedCategory = categories.find(c => c.id === categoryId);

  return (
    <>
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
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
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{isEdit ? 'Edit Transaction' : 'Add Transaction'}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >

            {/* Type toggle */}
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[styles.typeBtn, txType === 'DEBIT' && styles.typeBtnDebit]}
                onPress={() => setTxType('DEBIT')}
              >
                <Text style={[styles.typeBtnText, txType === 'DEBIT' && styles.typeBtnTextActive]}>
                  💸 Expense
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, txType === 'CREDIT' && styles.typeBtnCredit]}
                onPress={() => setTxType('CREDIT')}
              >
                <Text style={[styles.typeBtnText, txType === 'CREDIT' && styles.typeBtnTextActive]}>
                  💰 Income
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, txType === 'REFUND' && styles.typeBtnRefund]}
                onPress={() => setTxType('REFUND')}
              >
                <Text style={[styles.typeBtnText, txType === 'REFUND' && styles.typeBtnTextActive]}>
                  ↩️ Refund
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, txType === 'INVESTMENT' && styles.typeBtnInvestment]}
                onPress={() => setTxType('INVESTMENT')}
              >
                <Text style={[styles.typeBtnText, txType === 'INVESTMENT' && styles.typeBtnTextActive]}>
                  📊 Investment
                </Text>
              </TouchableOpacity>
            </View>

            {/* Amount */}
            <View style={styles.field}>
              <Text style={styles.label}>Amount (₹)</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={c.textFaint}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>

            {/* Merchant */}
            <View style={styles.field}>
              <Text style={styles.label}>
                {txType === 'DEBIT' ? 'Merchant / Paid to'
                  : txType === 'REFUND' ? 'Refunded by'
                  : txType === 'INVESTMENT' ? 'Platform / App'
                  : 'Received from'}
              </Text>
              <TextInput
                value={merchant}
                onChangeText={setMerchant}
                placeholder={txType === 'DEBIT' ? 'e.g. Electricity Board'
                  : txType === 'REFUND' ? 'e.g. IRCTC'
                  : txType === 'INVESTMENT' ? 'e.g. Groww, Zerodha'
                  : 'e.g. Salary'}
                placeholderTextColor={c.textFaint}
                style={styles.input}
                maxLength={200}
              />
            </View>

            {/* Category */}
            <View style={styles.field}>
              <Text style={styles.label}>Category</Text>
              <TouchableOpacity
                style={styles.input}
                onPress={() => setShowCategories(v => !v)}
              >
                <Text style={selectedCategory ? styles.inputText : styles.inputPlaceholder}>
                  {selectedCategory ? `${selectedCategory.icon} ${selectedCategory.name}` : 'Uncategorized (tap to select)'}
                </Text>
              </TouchableOpacity>

              {showCategories && (
                <View style={styles.categoryList}>
                  <TouchableOpacity
                    style={[styles.categoryItem, !categoryId && styles.categoryItemActive]}
                    onPress={() => { setCategoryId(''); setShowCategories(false); }}
                  >
                    <Text style={styles.categoryItemText}>📦 Uncategorized</Text>
                  </TouchableOpacity>
                  {categories.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.categoryItem, categoryId === c.id && styles.categoryItemActive]}
                      onPress={() => { setCategoryId(c.id); setShowCategories(false); }}
                    >
                      <Text style={styles.categoryItemText}>{c.icon} {c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Bank */}
            <BankPickerField
              label="Bank"
              value={bankId}
              onChange={setBankId}
              autoDefaultLastUsed={!isEdit}
            />

            {/* Date */}
            <View style={styles.field}>
              <DatePickerField label="Date" value={date} onChange={setDate} placeholder="Tap to pick a date" />
            </View>

            {/* Note */}
            <View style={styles.field}>
              <Text style={styles.label}>Note <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Q1 electricity bill"
                placeholderTextColor={c.textFaint}
                style={styles.input}
                maxLength={500}
              />
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={c.onColor} />
                : <Text style={styles.submitText}>{isEdit ? 'Save Changes' : 'Add Transaction'}</Text>
              }
            </TouchableOpacity>

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
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
  },
  sheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '90%',
  },
  handle: {
    width: 40, height: 4, backgroundColor: c.inputBorder,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },

  typeToggle: {
    flexDirection: 'row', borderRadius: 12, overflow: 'hidden',
    backgroundColor: c.chipBg, marginBottom: 16,
  },
  typeBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12,
  },
  typeBtnDebit: { backgroundColor: c.danger },
  typeBtnCredit: { backgroundColor: c.success },
  typeBtnRefund: { backgroundColor: c.teal },
  typeBtnInvestment: { backgroundColor: c.primary },
  typeBtnText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  typeBtnTextActive: { color: c.onColor },

  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: c.text, backgroundColor: c.inputBg,
    justifyContent: 'center',
  },
  inputText: { fontSize: 14, color: c.text },
  inputPlaceholder: { fontSize: 14, color: c.textFaint },

  categoryList: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    marginTop: 6, overflow: 'hidden',
  },
  categoryItem: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.cardBorder,
  },
  categoryItemActive: { backgroundColor: c.chipBg },
  categoryItemText: { fontSize: 14, color: c.text },

  submitBtn: {
    backgroundColor: c.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  submitText: { color: c.onColor, fontSize: 16, fontWeight: '700' },
});
