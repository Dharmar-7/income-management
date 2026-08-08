import { useMemo, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { HABIT_COLORS, type HabitColorKey, habitColor } from '@/lib/habitColors';

export interface Bank {
  id: string;
  name: string;
  color: string;
  transactionCount?: number;
  lastTransactionAt?: string | null;
}

interface Props {
  label?: string;
  value: string | null; // bankId, or null/'' for none
  onChange: (bankId: string | null) => void;
  // When true, auto-select the most recently used bank if nothing is chosen yet.
  autoDefaultLastUsed?: boolean;
}

// A bank chooser with colour swatches. Lists the user's banks (each shown in its
// colour) and lets them create a new one inline (name + colour). Used on the
// manual add-transaction form and the statement-import review.
export default function BankPickerField({ label, value, onChange, autoDefaultLastUsed }: Props) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<HabitColorKey>('indigo');
  const [saving, setSaving] = useState(false);
  const [defaulted, setDefaulted] = useState(false);

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Bank[]>('/banks', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  // One-time default to the most recently used bank.
  useEffect(() => {
    if (!autoDefaultLastUsed || defaulted || value || !banks?.length) return;
    const sorted = [...banks].sort((a, b) =>
      (b.lastTransactionAt ?? '').localeCompare(a.lastTransactionAt ?? ''));
    if (sorted[0]) onChange(sorted[0].id);
    setDefaulted(true);
  }, [autoDefaultLastUsed, defaulted, value, banks, onChange]);

  async function createBank() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const token = await getToken();
      const bank = await apiFetch<Bank>('/banks', token!, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      await queryClient.invalidateQueries({ queryKey: ['banks'] });
      onChange(bank.id);
      setCreating(false);
      setNewName('');
    } catch {
      // Surface silently — duplicate name etc.; keep the form open.
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
        <View style={styles.row}>
          <TouchableOpacity
            onPress={() => onChange(null)}
            style={[styles.chip, !value && styles.chipActive]}
          >
            <Text style={[styles.chipText, !value && styles.chipTextActive]}>None</Text>
          </TouchableOpacity>

          {(banks ?? []).map(b => {
            const col = habitColor(b.color);
            const on = value === b.id;
            return (
              <TouchableOpacity
                key={b.id}
                onPress={() => onChange(b.id)}
                style={[styles.chip, on && { borderColor: col.base, backgroundColor: col.soft }]}
              >
                <View style={[styles.dot, { backgroundColor: col.base }]} />
                <Text style={[styles.chipText, on && { color: c.text, fontWeight: '700' }]}>{b.name}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity onPress={() => setCreating(v => !v)} style={[styles.chip, styles.newChip]}>
            <Text style={styles.newChipText}>＋ New</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {creating && (
        <View style={styles.createBox}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Bank name (e.g. IOB, TMB)"
            placeholderTextColor={c.textFaint}
            style={styles.input}
            maxLength={60}
          />
          <View style={styles.swatchRow}>
            {(Object.keys(HABIT_COLORS) as HabitColorKey[]).map(key => (
              <TouchableOpacity
                key={key}
                onPress={() => setNewColor(key)}
                style={[
                  styles.swatch,
                  { backgroundColor: HABIT_COLORS[key].base },
                  newColor === key && styles.swatchOn,
                ]}
              />
            ))}
          </View>
          <TouchableOpacity style={[styles.addBtn, saving && { opacity: 0.6 }]} onPress={createBank} disabled={saving}>
            {saving ? <ActivityIndicator color={c.onColor} /> : <Text style={styles.addBtnText}>Add bank</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99,
    borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.card,
  },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  chipTextActive: { color: c.onColor },
  dot: { width: 10, height: 10, borderRadius: 5 },
  newChip: { borderStyle: 'dashed' },
  newChipText: { fontSize: 12, color: c.primary, fontWeight: '700' },

  createBox: {
    marginTop: 10, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.chipBg, gap: 10,
  },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.inputBg,
  },
  swatchRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: 'transparent' },
  swatchOn: { borderColor: c.text },
  addBtn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  addBtnText: { color: c.onColor, fontSize: 14, fontWeight: '700' },
});
