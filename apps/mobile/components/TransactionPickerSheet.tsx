import { useMemo, useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// Debounce a rapidly-changing value (search box), so we don't refetch on every keystroke.
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export interface PickerTx {
  id: string;
  merchant: string;
  description: string | null;
  amount: number;
  date: string;
  type: string;
}

interface TxListResponse {
  data: PickerTx[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (tx: PickerTx | null) => void; // null = "record without linking"
  // Optional context to surface likely matches at the top.
  suggestAmount?: number;
  // Restrict the list to a type (e.g. 'DEBIT' for expenses/investments).
  type?: string;
  title?: string;
  subtitle?: string;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

// A searchable, sortable list of the user's bank transactions to link one to a
// section entry (investment, EMI, bill). Likely matches (same amount) are
// pinned to the top; everything is browsable via search + sort. Fully optional.
export default function TransactionPickerSheet({
  visible, onClose, onPick, suggestAmount, type, title, subtitle,
}: Props) {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');

  const params = new URLSearchParams({
    page: '1', limit: '40', sortBy, sortOrder: 'desc',
    ...(search && { search }),
    ...(type && { type }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tx-picker', search, sortBy, type],
    enabled: visible,
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<TxListResponse>(`/transactions?${params}`, token!);
    },
    staleTime: 60 * 1000,
  });

  const all = data?.data ?? [];
  // Likely matches: same rupee amount (±1). Only meaningful when not searching.
  const suggestions = (!search && suggestAmount)
    ? all.filter(t => Math.abs(t.amount - suggestAmount) <= 1)
    : [];
  const suggestionIds = new Set(suggestions.map(s => s.id));
  const rest = all.filter(t => !suggestionIds.has(t.id));

  const renderRow = (t: PickerTx, suggested = false) => (
    <TouchableOpacity key={t.id} style={[styles.row, suggested && styles.rowSuggested]} activeOpacity={0.7} onPress={() => onPick(t)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.merchant} numberOfLines={1}>{t.merchant}</Text>
        <Text style={styles.meta}>{shortDate(t.date)} · {t.type}</Text>
      </View>
      <Text style={styles.amount}>{formatINR(t.amount)}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title ?? 'Link a transaction'}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose}><Text style={styles.closeBtn}>✕</Text></TouchableOpacity>
          </View>

          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search merchant or note…"
            placeholderTextColor={c.textFaint}
            style={styles.search}
          />

          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort:</Text>
            {(['date', 'amount'] as const).map(k => (
              <TouchableOpacity key={k} onPress={() => setSortBy(k)} style={[styles.sortChip, sortBy === k && styles.sortChipOn]}>
                <Text style={[styles.sortChipText, sortBy === k && styles.sortChipTextOn]}>
                  {k === 'date' ? 'Date' : 'Amount'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {isLoading ? (
              <View style={styles.loading}><ActivityIndicator color={c.primary} /></View>
            ) : all.length === 0 ? (
              <Text style={styles.empty}>No transactions found.</Text>
            ) : (
              <>
                {suggestions.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>⭐ Likely matches</Text>
                    {suggestions.map(t => renderRow(t, true))}
                    <Text style={styles.sectionLabel}>All transactions</Text>
                  </>
                )}
                {rest.map(t => renderRow(t))}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.noneBtn} onPress={() => onPick(null)}>
            <Text style={styles.noneText}>Skip — don't link a transaction</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
  },
  handle: { width: 40, height: 4, backgroundColor: c.inputBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },

  search: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.inputBg,
  },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 6 },
  sortLabel: { fontSize: 12, color: c.textMuted },
  sortChip: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: c.inputBorder },
  sortChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  sortChipText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  sortChipTextOn: { color: c.onColor },

  loading: { paddingVertical: 30, alignItems: 'center' },
  empty: { paddingVertical: 24, textAlign: 'center', color: c.textFaint, fontSize: 13 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: c.textMuted, marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.chipBg, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  rowSuggested: { borderColor: c.primary },
  merchant: { fontSize: 14, fontWeight: '600', color: c.text },
  meta: { fontSize: 11, color: c.textFaint, marginTop: 1 },
  amount: { fontSize: 14, fontWeight: '700', color: c.text },

  noneBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: c.inputBorder },
  noneText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
});
