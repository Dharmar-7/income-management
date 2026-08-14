import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import AppAlert from '@/components/AppAlert';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// ─── Types (mirror the /safe-to-spend response) ────────────────────────────────

interface SafeToSpend {
  cycle: {
    label: string; year: number;
    start: string; end: string;
    totalDays: number; dayIndex: number; daysLeft: number;
  };
  dailyTarget: number;
  safeToday: number;
  spentToday: number;
  savedPot: number;
  leftThisCycle: number;
  income: number;
  buffer: number;
  manualDailyTarget: number | null;
  reservedBills: number;
  bills: { name: string; amount: number; date: string; kind: 'EMI' | 'RECURRING' }[];
  upcomingEvents: {
    title: string; icon: string; personName: string | null;
    date: string; daysUntil: number; isToday: boolean;
  }[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

function inDays(n: number) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n}d`;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function SafeToSpendCard() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const [editing, setEditing] = useState(false);

  const q = useQuery({
    queryKey: ['safe-to-spend'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<SafeToSpend>('/safe-to-spend', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const d = q.data;

  if (q.isLoading) {
    return <View style={[styles.card, styles.skeleton]} />;
  }
  if (!d) return null;

  const over = d.safeToday < 0;
  const notSetUp = d.dailyTarget <= 0;

  return (
    <>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.label}>💰 Safe to Spend today</Text>
          <TouchableOpacity
            onPress={() => setEditing(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Edit safe-to-spend settings"
          >
            <Text style={styles.editBtn}>✏️</Text>
          </TouchableOpacity>
        </View>

        {notSetUp ? (
          <>
            <Text style={styles.setupText}>
              Add this cycle's income, or set a daily budget, to see your number.
            </Text>
            <TouchableOpacity style={styles.setupBtn} onPress={() => setEditing(true)}>
              <Text style={styles.setupBtnText}>Set a daily budget</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.amount, over && styles.amountOver]}>
              {formatINR(Math.max(d.safeToday, 0))}
            </Text>
            <Text style={styles.sub}>
              {d.cycle.label} cycle · {d.cycle.daysLeft} {d.cycle.daysLeft === 1 ? 'day' : 'days'} to payday
              {d.spentToday > 0 ? ` · spent ${formatINR(d.spentToday)} today` : ''}
            </Text>

            {over && (
              <Text style={styles.overNote}>
                Over today's ₹{Math.round(d.dailyTarget).toLocaleString('en-IN')} — ease up or dip into your saved pot.
              </Text>
            )}

            {/* Stat pills */}
            <View style={styles.pillRow}>
              <Stat c={c} icon="💚" title="Saved pot" value={formatINR(d.savedPot)} good={d.savedPot >= 0} />
              <Stat c={c} icon="🏦" title="Left this cycle" value={formatINR(Math.max(d.leftThisCycle, 0))} />
            </View>
            {d.reservedBills > 0 && (
              <View style={styles.pillRow}>
                <Stat c={c} icon="📌" title="Reserved for bills" value={formatINR(d.reservedBills)} wide />
              </View>
            )}
          </>
        )}

        {/* Upcoming occasions — reminders only */}
        {d.upcomingEvents.length > 0 && (
          <View style={styles.eventsWrap}>
            <Text style={styles.eventsLabel}>Coming up</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.eventsRow}>
                {d.upcomingEvents.map((e, i) => (
                  <View key={i} style={styles.eventChip}>
                    <Text style={styles.eventChipText}>
                      {e.icon} {e.personName || e.title} · {inDays(e.daysUntil)}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {editing && (
        <SafeToSpendSettingsSheet
          buffer={d.buffer}
          dailyTarget={d.manualDailyTarget}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function Stat({
  c, icon, title, value, good, wide,
}: {
  c: Theme; icon: string; title: string; value: string; good?: boolean; wide?: boolean;
}) {
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={[styles.stat, wide && { flex: 1 }]}>
      <Text style={styles.statTitle}>{icon} {title}</Text>
      <Text style={[styles.statValue, good === false && { color: '#fecaca' }]}>{value}</Text>
    </View>
  );
}

// ─── Settings sheet ─────────────────────────────────────────────────────────

function SafeToSpendSettingsSheet({
  buffer, dailyTarget, onClose,
}: {
  buffer: number; dailyTarget: number | null; onClose: () => void;
}) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [bufferStr, setBufferStr] = useState(buffer ? String(buffer) : '');
  const [targetStr, setTargetStr] = useState(dailyTarget ? String(dailyTarget) : '');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  async function handleSave() {
    const bufferVal = bufferStr.trim() === '' ? 0 : parseFloat(bufferStr);
    const targetVal = targetStr.trim() === '' ? 0 : parseFloat(targetStr);
    if (isNaN(bufferVal) || bufferVal < 0 || isNaN(targetVal) || targetVal < 0) {
      setAlertInfo({ title: 'Invalid amount', message: 'Please enter valid, non-negative amounts.' });
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      await apiFetch('/users/me', token!, {
        method: 'PATCH',
        body: JSON.stringify({ stsBuffer: bufferVal, stsDailyTarget: targetVal }),
      });
      queryClient.invalidateQueries({ queryKey: ['safe-to-spend'] });
      onClose();
    } catch (err: any) {
      setAlertInfo({ title: 'Error', message: err.message ?? 'Failed to save.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
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
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Tune Safe to Spend</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Safety buffer (₹)</Text>
            <Text style={styles.fieldHint}>Money held back each cycle before the daily budget is worked out.</Text>
            <TextInput
              value={bufferStr}
              onChangeText={setBufferStr}
              placeholder="0"
              placeholderTextColor={c.textFaint}
              keyboardType="decimal-pad"
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Daily budget cap (₹) <Text style={{ color: c.textFaint }}>— optional</Text></Text>
            <Text style={styles.fieldHint}>Leave blank to auto-calculate from your income. Set a number to cap each day.</Text>
            <TextInput
              value={targetStr}
              onChangeText={setTargetStr}
              placeholder="Auto"
              placeholderTextColor={c.textFaint}
              keyboardType="decimal-pad"
              style={styles.input}
            />

            <TouchableOpacity style={[styles.saveBtn, loading && { opacity: 0.6 }]} onPress={handleSave} disabled={loading}>
              {loading ? <ActivityIndicator color={c.onColor} /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
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

// ─── Styles ─────────────────────────────────────────────────────────────────

const makeStyles = (c: Theme) => StyleSheet.create({
  card: {
    borderRadius: 16, padding: 18,
    backgroundColor: c.primaryDeep,
    shadowColor: c.primaryDeep, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    gap: 6,
  },
  skeleton: { height: 150, opacity: 0.4 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  editBtn: { fontSize: 15 },

  amount: { fontSize: 34, fontWeight: '800', color: c.onColor, marginTop: 2 },
  amountOver: { color: '#fecaca' },
  sub: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  overNote: { fontSize: 12, color: '#fecaca', marginTop: 4, fontWeight: '500' },

  setupText: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4, marginBottom: 8, lineHeight: 18 },
  setupBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 99, paddingVertical: 9, alignItems: 'center' },
  setupBtnText: { color: c.onColor, fontWeight: '700', fontSize: 13 },

  pillRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  stat: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 12,
    paddingVertical: 8, paddingHorizontal: 10, gap: 2,
  },
  statTitle: { fontSize: 10.5, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  statValue: { fontSize: 15, color: c.onColor, fontWeight: '700' },

  eventsWrap: { marginTop: 10, gap: 6 },
  eventsLabel: { fontSize: 10.5, color: 'rgba(255,255,255,0.7)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  eventsRow: { flexDirection: 'row', gap: 6 },
  eventChip: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  eventChipText: { fontSize: 11.5, color: c.onColor, fontWeight: '500' },

  // Settings sheet
  modalRoot: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, maxHeight: '90%',
  },
  handle: { width: 40, height: 4, backgroundColor: c.inputBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 2, marginTop: 6 },
  fieldHint: { fontSize: 11.5, color: c.textFaint, marginBottom: 8, lineHeight: 16 },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 6,
  },
  saveBtn: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  saveText: { color: c.onColor, fontSize: 16, fontWeight: '700' },
});
