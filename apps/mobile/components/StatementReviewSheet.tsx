import { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import BankPickerField from '@/components/BankPickerField';

export interface ParsedRow {
  date: string;
  merchant: string;
  amount: number;
  type: 'DEBIT' | 'CREDIT';
  categoryId?: string;
  description?: string;
  upiRef?: string;
  balance?: number;
}

export interface CommitRow {
  amount: number;
  merchant: string;
  type: 'DEBIT' | 'CREDIT';
  date: string;
  categoryId?: string;
  description?: string;
  upiRef?: string;
}

interface Category { id: string; name: string; icon: string }

interface Props {
  visible: boolean;
  rows: ParsedRow[];
  categories: Category[];
  committing: boolean;
  onClose: () => void;
  onConfirm: (rows: CommitRow[], bankId: string | null) => void;
}

interface EditRow extends ParsedRow {
  include: boolean;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}

export default function StatementReviewSheet({ visible, rows, categories, committing, onClose, onConfirm }: Props) {
  const { theme: c } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(c);

  const [items, setItems] = useState<EditRow[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [bankId, setBankId] = useState<string | null>(null);

  // Seed the editable list each time a fresh set of parsed rows arrives.
  useEffect(() => {
    setItems(rows.map((r) => ({ ...r, include: true })));
    setExpanded(null);
  }, [rows]);

  const catById = (id?: string) => categories.find((x) => x.id === id);
  const selectedCount = items.filter((i) => i.include).length;
  const allSelected = items.length > 0 && selectedCount === items.length;

  function patch(idx: number, p: Partial<EditRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  }

  function commit() {
    const chosen: CommitRow[] = items
      .filter((i) => i.include)
      .map(({ include, balance, ...r }) => r);
    if (chosen.length > 0) onConfirm(chosen, bankId);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.root}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={committing ? undefined : onClose} />

        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.handle} />

          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Review {items.length} transaction{items.length === 1 ? '' : 's'}</Text>
              <Text style={s.subtitle}>Deselect wrong rows and fix categories, then import.</Text>
            </View>
            <TouchableOpacity onPress={committing ? undefined : onClose}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* select all */}
          <TouchableOpacity
            style={s.selectAll}
            onPress={() => setItems((prev) => prev.map((it) => ({ ...it, include: !allSelected })))}
          >
            <View style={[s.checkbox, allSelected && s.checkboxOn]}>
              {allSelected && <Text style={s.checkmark}>✓</Text>}
            </View>
            <Text style={s.selectAllText}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
          </TouchableOpacity>

          {/* One bank for the whole imported batch (colour-coded in the list). */}
          <BankPickerField label="Bank for this import" value={bankId} onChange={setBankId} />

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {items.map((it, idx) => {
              const cat = catById(it.categoryId);
              const isCredit = it.type === 'CREDIT';
              return (
                <View key={idx} style={[s.row, !it.include && s.rowOff]}>
                  <View style={s.rowTop}>
                    {/* include toggle */}
                    <TouchableOpacity onPress={() => patch(idx, { include: !it.include })} style={{ paddingRight: 10 }}>
                      <View style={[s.checkbox, it.include && s.checkboxOn]}>
                        {it.include && <Text style={s.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>

                    <View style={{ flex: 1 }}>
                      <Text style={s.merchant} numberOfLines={1}>{it.merchant}</Text>
                      <Text style={s.date}>{it.date}</Text>
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.amount, { color: isCredit ? c.success : c.danger }]}>
                        {isCredit ? '+' : '−'}{formatINR(it.amount)}
                      </Text>
                      {/* type toggle */}
                      <TouchableOpacity
                        onPress={() => patch(idx, { type: isCredit ? 'DEBIT' : 'CREDIT' })}
                        style={[s.typePill, { borderColor: isCredit ? c.success : c.danger }]}
                      >
                        <Text style={[s.typePillText, { color: isCredit ? c.success : c.danger }]}>
                          {isCredit ? 'Income ⇄' : 'Expense ⇄'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* category */}
                  <TouchableOpacity
                    style={s.catChip}
                    onPress={() => setExpanded(expanded === idx ? null : idx)}
                  >
                    <Text style={s.catChipText}>
                      {cat ? `${cat.icon} ${cat.name}` : '📦 Uncategorized'} ▾
                    </Text>
                  </TouchableOpacity>

                  {expanded === idx && (
                    <View style={s.catGrid}>
                      {categories.map((ct) => (
                        <TouchableOpacity
                          key={ct.id}
                          onPress={() => { patch(idx, { categoryId: ct.id }); setExpanded(null); }}
                          style={[s.catOpt, it.categoryId === ct.id && s.catOptOn]}
                        >
                          <Text style={[s.catOptText, it.categoryId === ct.id && s.catOptTextOn]}>
                            {ct.icon} {ct.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[s.importBtn, (committing || selectedCount === 0) && { opacity: 0.6 }]}
            onPress={commit}
            disabled={committing || selectedCount === 0}
          >
            {committing
              ? <ActivityIndicator color={c.onColor} />
              : <Text style={s.importText}>Import {selectedCount} transaction{selectedCount === 1 ? '' : 's'}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 12, maxHeight: '92%',
  },
  handle: { width: 40, height: 4, backgroundColor: c.inputBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: c.text },
  subtitle: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  close: { fontSize: 18, color: c.textFaint, padding: 4 },

  selectAll: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 4 },
  selectAllText: { color: c.textMuted, fontSize: 13, fontWeight: '600' },

  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.inputBorder,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
  checkmark: { color: c.onColor, fontSize: 13, fontWeight: '900' },

  row: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 12, marginBottom: 8 },
  rowOff: { opacity: 0.45 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  merchant: { fontSize: 14, fontWeight: '700', color: c.text },
  date: { fontSize: 11, color: c.textFaint, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '800' },
  typePill: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  typePillText: { fontSize: 10, fontWeight: '700' },

  catChip: {
    alignSelf: 'flex-start', marginTop: 10, marginLeft: 32,
    backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder,
    borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5,
  },
  catChipText: { fontSize: 12, color: c.textMuted, fontWeight: '600' },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginLeft: 32 },
  catOpt: { backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  catOptOn: { backgroundColor: c.primary, borderColor: c.primary },
  catOptText: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  catOptTextOn: { color: c.onColor },

  importBtn: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  importText: { color: c.onColor, fontSize: 15, fontWeight: '800' },
});
