import { useMemo, useState } from 'react';
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type SavingType =
  | 'POST_OFFICE' | 'FIXED_DEPOSIT' | 'RECURRING_DEPOSIT'
  | 'STOCKS' | 'MUTUAL_FUNDS' | 'GOLD' | 'EPF' | 'NPS' | 'OTHER';

interface InvestmentPlatform {
  id: string;
  name: string;
  balance: number;
}

// The fields the form needs to pre-fill when editing an existing investment.
export interface EditingSaving {
  id: string;
  name: string;
  type: SavingType;
  investedAmount: number;
  charges: number;
  currentValue: number;
  sipAmount: number | null;
  startDate: string;
  maturityDate: string | null;
  platformId: string; // '' when standalone
  note: string | null;
}

type SheetMode = 'platform' | 'saving';

interface Props {
  visible: boolean;
  mode: SheetMode;
  platforms: InvestmentPlatform[];
  onClose: () => void;
  onSuccess: () => void;
  // When set (and mode is 'saving'), the sheet edits this investment.
  editing?: EditingSaving | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const SAVING_TYPES: { value: SavingType; label: string; icon: string }[] = [
  { value: 'POST_OFFICE',       label: 'Post Office',    icon: '📮' },
  { value: 'FIXED_DEPOSIT',     label: 'Fixed Deposit',  icon: '🏦' },
  { value: 'RECURRING_DEPOSIT', label: 'RD',             icon: '📅' },
  { value: 'MUTUAL_FUNDS',      label: 'Mutual Funds',   icon: '📈' },
  { value: 'STOCKS',            label: 'Stocks',          icon: '💹' },
  { value: 'GOLD',              label: 'Gold',            icon: '🥇' },
  { value: 'EPF',               label: 'EPF',             icon: '🏢' },
  { value: 'NPS',               label: 'NPS',             icon: '🛡️' },
  { value: 'OTHER',             label: 'Other',           icon: '📦' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

// ─── Add Platform Form ──────────────────────────────────────────────────────────

function AddPlatformForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  const [name, setName] = useState('');
  const [totalAdded, setTotalAdded] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !totalAdded) {
      setAlertInfo({ title: 'Missing fields', message: 'Platform name and amount are required.' });
      return;
    }
    const amount = parseFloat(totalAdded);
    if (isNaN(amount) || amount <= 0) {
      setAlertInfo({ title: 'Invalid amount', message: 'Enter a valid positive amount.' });
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      await apiFetch('/savings/platforms', token!, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          totalAdded: amount,
          note: note.trim() || undefined,
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setAlertInfo({ title: 'Error', message: err.message ?? 'Failed to add platform.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      <Text style={styles.hint}>
        A platform is your in-app wallet (e.g. Groww, Zerodha). Add the total amount you've transferred into it.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Platform Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Groww, Zerodha, Post Office"
          placeholderTextColor={c.textFaint}
          style={styles.input}
          maxLength={100}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Total Transferred In (₹)</Text>
        <TextInput
          value={totalAdded}
          onChangeText={setTotalAdded}
          placeholder="e.g. 5000"
          placeholderTextColor={c.textFaint}
          keyboardType="decimal-pad"
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Note <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Primary brokerage"
          placeholderTextColor={c.textFaint}
          style={styles.input}
          maxLength={300}
        />
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, loading && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color={c.onColor} />
          : <Text style={styles.submitText}>Add Platform</Text>
        }
      </TouchableOpacity>
    </ScrollView>

    <AppAlert
      visible={alertInfo !== null}
      title={alertInfo?.title ?? ''}
      message={alertInfo?.message ?? ''}
      onClose={() => setAlertInfo(null)}
    />
    </>
  );
}

// ─── Add Saving Form ────────────────────────────────────────────────────────────

function AddSavingForm({ platforms, editing, onClose, onSuccess }: { platforms: InvestmentPlatform[]; editing?: EditingSaving | null; onClose: () => void; onSuccess: () => void }) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const isEdit = !!editing;
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  // The form mounts fresh each time the sheet opens, so seeding state from the
  // `editing` prop here is enough — no effect needed.
  const [savingType, setSavingType] = useState<SavingType>(editing?.type ?? 'MUTUAL_FUNDS');
  const [name, setName] = useState(editing?.name ?? '');
  const [investedAmount, setInvestedAmount] = useState(editing ? String(editing.investedAmount) : '');
  const [charges, setCharges] = useState(editing ? String(editing.charges) : '0');
  const [currentValue, setCurrentValue] = useState(editing ? String(editing.currentValue) : '');
  const [sipAmount, setSipAmount] = useState(editing?.sipAmount ? String(editing.sipAmount) : '');
  const [startDate, setStartDate] = useState(editing ? editing.startDate.slice(0, 10) : todayISO());
  const [maturityDate, setMaturityDate] = useState(editing?.maturityDate ? editing.maturityDate.slice(0, 10) : '');
  const [platformId, setPlatformId] = useState(editing?.platformId ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !investedAmount || !startDate) {
      setAlertInfo({ title: 'Missing fields', message: 'Name, invested amount, and start date are required.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setAlertInfo({ title: 'Invalid date', message: 'Enter start date as YYYY-MM-DD.' });
      return;
    }
    if (maturityDate && !/^\d{4}-\d{2}-\d{2}$/.test(maturityDate)) {
      setAlertInfo({ title: 'Invalid date', message: 'Enter maturity date as YYYY-MM-DD.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const invested = parseFloat(investedAmount);
      if (isEdit && editing) {
        await apiFetch(`/savings/${editing.id}`, token!, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            type: savingType,
            investedAmount: invested,
            charges: parseFloat(charges) || 0,
            // Blank current value on edit → leave the existing value unchanged.
            currentValue: currentValue ? parseFloat(currentValue) : undefined,
            sipAmount: sipAmount ? parseFloat(sipAmount) : 0, // 0 clears the SIP
            startDate,
            maturityDate: maturityDate || null, // null clears it
            platformId: platformId || null, // null → standalone
            note: note.trim() || null,
          }),
        });
      } else {
        await apiFetch('/savings', token!, {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            type: savingType,
            investedAmount: invested,
            charges: parseFloat(charges) || 0,
            // Blank current value → backend defaults it to the invested amount.
            currentValue: currentValue ? parseFloat(currentValue) : undefined,
            sipAmount: sipAmount ? parseFloat(sipAmount) : undefined,
            startDate,
            maturityDate: maturityDate || undefined,
            platformId: platformId || undefined,
            note: note.trim() || undefined,
          }),
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setAlertInfo({
        title: 'Error',
        message: err.message ?? (isEdit ? 'Failed to save changes.' : 'Failed to add investment.'),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      {/* Type chips */}
      <View style={styles.field}>
        <Text style={styles.label}>Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
            {SAVING_TYPES.map(t => (
              <TouchableOpacity
                key={t.value}
                onPress={() => setSavingType(t.value)}
                style={[styles.typeChip, savingType === t.value && styles.typeChipActive]}
              >
                <Text style={[styles.typeChipText, savingType === t.value && styles.typeChipTextActive]}>
                  {t.icon} {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Investment Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Nifty 50 SIP, PPF, SGB 2025"
          placeholderTextColor={c.textFaint}
          style={styles.input}
          maxLength={200}
        />
      </View>

      <View style={styles.row3}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Invested (₹)</Text>
          <TextInput
            value={investedAmount}
            onChangeText={v => { setInvestedAmount(v); if (!currentValue) setCurrentValue(v); }}
            placeholder="0"
            placeholderTextColor={c.textFaint}
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Charges (₹)</Text>
          <TextInput
            value={charges}
            onChangeText={setCharges}
            placeholder="0"
            placeholderTextColor={c.textFaint}
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Curr. Value (₹)</Text>
          <TextInput
            value={currentValue}
            onChangeText={setCurrentValue}
            placeholder="optional"
            placeholderTextColor={c.textFaint}
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          {savingType === 'MUTUAL_FUNDS' ? 'Monthly SIP (₹)'
            : savingType === 'RECURRING_DEPOSIT' ? 'Monthly Deposit (₹)'
            : 'Monthly Contribution (₹)'}{' '}
          <Text style={{ color: c.textFaint }}>(optional)</Text>
        </Text>
        <TextInput
          value={sipAmount}
          onChangeText={setSipAmount}
          placeholder="e.g. 1000 — shows a + button to add each month"
          placeholderTextColor={c.textFaint}
          keyboardType="decimal-pad"
          style={styles.input}
        />
      </View>

      <DatePickerField
        label="Start Date"
        value={startDate}
        onChange={setStartDate}
        placeholder="Tap to pick the start date"
        style={{ marginBottom: 14 }}
      />
      <DatePickerField
        label="Maturity Date (optional)"
        value={maturityDate}
        onChange={setMaturityDate}
        placeholder="Tap to pick (optional)"
        optional
        style={{ marginBottom: 14 }}
      />

      {/* Platform picker */}
      {platforms.length > 0 && (
        <View style={styles.field}>
          <Text style={styles.label}>Platform <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
              <TouchableOpacity
                onPress={() => setPlatformId('')}
                style={[styles.typeChip, !platformId && styles.typeChipActive]}
              >
                <Text style={[styles.typeChipText, !platformId && styles.typeChipTextActive]}>None</Text>
              </TouchableOpacity>
              {platforms.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPlatformId(p.id)}
                  style={[styles.typeChip, platformId === p.id && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, platformId === p.id && styles.typeChipTextActive]}>
                    {p.name} ({formatINR(p.balance)})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Note <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Monthly ₹500 SIP"
          placeholderTextColor={c.textFaint}
          style={styles.input}
          maxLength={300}
        />
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, loading && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color={c.onColor} />
          : <Text style={styles.submitText}>{isEdit ? 'Save Changes' : 'Add Investment'}</Text>
        }
      </TouchableOpacity>
    </ScrollView>

    <AppAlert
      visible={alertInfo !== null}
      title={alertInfo?.title ?? ''}
      message={alertInfo?.message ?? ''}
      onClose={() => setAlertInfo(null)}
    />
    </>
  );
}

// ─── Sheet ──────────────────────────────────────────────────────────────────────

export default function AddSavingSheet({ visible, mode, platforms, onClose, onSuccess, editing }: Props) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

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
              {mode === 'platform' ? '+ Add Platform' : editing ? 'Edit Investment' : '+ Add Investment'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {mode === 'platform'
            ? <AddPlatformForm onClose={onClose} onSuccess={onSuccess} />
            : <AddSavingForm platforms={platforms} editing={editing} onClose={onClose} onSuccess={onSuccess} />
          }
        </View>
      </View>
    </Modal>
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
    maxHeight: '92%',
  },
  handle: {
    width: 40, height: 4, backgroundColor: c.inputBorder,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },

  hint: { fontSize: 13, color: c.textMuted, marginBottom: 16, lineHeight: 18 },

  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: c.text, backgroundColor: c.inputBg,
  },

  row3: { flexDirection: 'row', gap: 8, marginBottom: 14 },

  typeChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99,
    borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.card,
  },
  typeChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  typeChipText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  typeChipTextActive: { color: c.onColor },

  submitBtn: {
    backgroundColor: c.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  submitText: { color: c.onColor, fontSize: 16, fontWeight: '700' },
});
