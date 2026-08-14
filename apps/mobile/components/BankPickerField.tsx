import { useMemo, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { BANK_PALETTE, bankColor } from '@/lib/bankColors';
import AppAlert from '@/components/AppAlert';

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

// A bank chooser with colour swatches. Lists the user's banks (each in its
// colour), lets them create one inline (name + colour picker), and — in "Edit"
// mode — rename, recolour, or delete an existing bank. Used on the manual
// add-transaction form and the statement-import review.
export default function BankPickerField({ label, value, onChange, autoDefaultLastUsed }: Props) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Bank | null>(null);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(BANK_PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [defaulted, setDefaulted] = useState(false);

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Bank[]>('/banks', token!);
    },
    staleTime: 2 * 60 * 1000,
  });

  const formOpen = creating || !!editing;

  // One-time default to the most recently used bank.
  useEffect(() => {
    if (!autoDefaultLastUsed || defaulted || value || !banks?.length) return;
    const sorted = [...banks].sort((a, b) =>
      (b.lastTransactionAt ?? '').localeCompare(a.lastTransactionAt ?? ''));
    if (sorted[0]) onChange(sorted[0].id);
    setDefaulted(true);
  }, [autoDefaultLastUsed, defaulted, value, banks, onChange]);

  function openNew() {
    setEditing(null);
    setName('');
    setColor(BANK_PALETTE[0]);
    setManaging(false);
    setCreating(true);
  }

  function openEdit(b: Bank) {
    setCreating(false);
    setEditing(b);
    setName(b.name);
    setColor(bankColor(b.color).base);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setName('');
  }

  function refreshBankViews() {
    queryClient.invalidateQueries({ queryKey: ['banks'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] }); // stripe colours/names
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const token = await getToken();
      if (editing) {
        await apiFetch(`/banks/${editing.id}`, token!, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), color }),
        });
        refreshBankViews();
      } else {
        const bank = await apiFetch<Bank>('/banks', token!, {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), color }),
        });
        await queryClient.invalidateQueries({ queryKey: ['banks'] });
        onChange(bank.id);
      }
      closeForm();
    } catch {
      // Surface silently — duplicate name etc.; keep the form open to retry.
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      const token = await getToken();
      await apiFetch(`/banks/${editing.id}`, token!, { method: 'DELETE' });
      if (value === editing.id) onChange(null); // deselect if it was chosen
      refreshBankViews();
      closeForm();
      setManaging(false);
    } catch {
      // ignore — bank may already be gone
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
        <View style={styles.row}>
          {!managing && (
            <TouchableOpacity
              onPress={() => onChange(null)}
              style={[styles.chip, !value && styles.chipActive]}
            >
              <Text style={[styles.chipText, !value && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
          )}

          {(banks ?? []).map(b => {
            const col = bankColor(b.color);
            const on = value === b.id;
            return (
              <TouchableOpacity
                key={b.id}
                onPress={() => (managing ? openEdit(b) : onChange(b.id))}
                style={[
                  styles.chip,
                  on && !managing && { borderColor: col.base, backgroundColor: col.soft },
                  managing && styles.chipManaging,
                ]}
              >
                <View style={[styles.dot, { backgroundColor: col.base }]} />
                <Text style={[styles.chipText, on && !managing && { color: c.text, fontWeight: '700' }]}>
                  {b.name}
                </Text>
                {managing && <Text style={styles.pencil}>✎</Text>}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity onPress={openNew} style={[styles.chip, styles.newChip]}>
            <Text style={styles.newChipText}>＋ New</Text>
          </TouchableOpacity>

          {(banks?.length ?? 0) > 0 && (
            <TouchableOpacity
              onPress={() => { setManaging(m => !m); closeForm(); }}
              style={[styles.chip, styles.editChip, managing && styles.editChipOn]}
            >
              <Text style={[styles.editChipText, managing && { color: c.onColor }]}>
                {managing ? 'Done' : '✎ Edit'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {managing && !formOpen && (
        <Text style={styles.hint}>Tap a bank to rename, recolour, or delete it.</Text>
      )}

      {formOpen && (
        <View style={styles.createBox}>
          <Text style={styles.boxTitle}>{editing ? 'Edit bank' : 'New bank'}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Bank name (e.g. IOB, TMB)"
            placeholderTextColor={c.textFaint}
            style={styles.input}
            maxLength={60}
          />

          <Text style={styles.pickerLabel}>Colour</Text>
          <View style={styles.swatchRow}>
            {BANK_PALETTE.map(hex => {
              const on = color.toLowerCase() === hex.toLowerCase();
              return (
                <TouchableOpacity
                  key={hex}
                  onPress={() => setColor(hex)}
                  style={[styles.swatch, { backgroundColor: hex }, on && styles.swatchOn]}
                >
                  {on && <Text style={styles.swatchTick}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeForm} disabled={saving}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addBtn, saving && { opacity: 0.6 }]}
              onPress={save}
              disabled={saving || !name.trim()}
            >
              {saving ? <ActivityIndicator color={c.onColor} /> : (
                <Text style={styles.addBtnText}>{editing ? 'Save changes' : 'Add bank'}</Text>
              )}
            </TouchableOpacity>
          </View>

          {editing && (
            <TouchableOpacity onPress={() => setConfirmDelete(true)} disabled={saving} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>Delete this bank</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <AppAlert
        visible={confirmDelete}
        icon="🏦"
        title={`Delete ${editing?.name ?? 'bank'}?`}
        message="Your transactions stay — they just won't be tagged with this bank anymore."
        confirmLabel="Delete"
        confirmDestructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={del}
      />
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
  chipManaging: { borderStyle: 'dashed', borderColor: c.primary },
  chipText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  chipTextActive: { color: c.onColor },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pencil: { fontSize: 11, color: c.primary, marginLeft: 2 },
  newChip: { borderStyle: 'dashed' },
  newChipText: { fontSize: 12, color: c.primary, fontWeight: '700' },
  editChip: { backgroundColor: c.chipBg },
  editChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  editChipText: { fontSize: 12, color: c.textMuted, fontWeight: '700' },

  hint: { fontSize: 12, color: c.textFaint, marginTop: 8, marginLeft: 2 },

  createBox: {
    marginTop: 10, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.chipBg, gap: 10,
  },
  boxTitle: { fontSize: 13, fontWeight: '700', color: c.text },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.inputBg,
  },
  pickerLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  swatchRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  swatch: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn: { borderColor: c.text },
  swatchTick: { color: '#ffffff', fontSize: 14, fontWeight: '900' },

  actionRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
    paddingVertical: 11, alignItems: 'center',
  },
  cancelBtnText: { color: c.text, fontSize: 14, fontWeight: '600' },
  addBtn: { flex: 1, backgroundColor: c.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  addBtnText: { color: c.onColor, fontSize: 14, fontWeight: '700' },
  deleteBtn: { paddingVertical: 6, alignItems: 'center' },
  deleteBtnText: { color: c.danger, fontSize: 13, fontWeight: '600' },
});
