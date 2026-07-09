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
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { HABIT_COLORS, type HabitColorKey } from '@/lib/habitColors';

// The fields the form needs to pre-fill when editing a habit.
export interface EditingHabit {
  id: string;
  name: string;
  icon: string;
  color: string;
  weeklyTarget: number;
  scheduleDays: number[];
  note: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editing?: EditingHabit | null;
  onDelete?: () => void; // shown only when editing — parent confirms + deletes
}

const ICON_CHOICES = ['✅', '💪', '📖', '🤖', '🗣️', '📈', '🎬', '😴', '🧘', '💧', '🏃', '🎯', '🎨', '🎸'];
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // index 0=Sun … 6=Sat

export default function AddHabitSheet({ visible, onClose, onSuccess, editing, onDelete }: Props) {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const isEdit = !!editing;

  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? '✅');
  const [color, setColor] = useState<string>(editing?.color ?? 'indigo');
  const [weeklyTarget, setWeeklyTarget] = useState(editing?.weeklyTarget ?? 7);
  const [scheduleDays, setScheduleDays] = useState<number[]>(editing?.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6]);
  const [note, setNote] = useState(editing?.note ?? '');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  function toggleDay(d: number) {
    setScheduleDays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setAlertInfo({ title: 'Missing name', message: 'Give your habit a name.' });
      return;
    }
    if (scheduleDays.length === 0) {
      setAlertInfo({ title: 'Pick days', message: 'Select at least one day for this habit.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const body = {
        name: name.trim(),
        icon: icon.trim() || '✅',
        color,
        weeklyTarget,
        scheduleDays,
        note: note.trim() || (isEdit ? null : undefined),
      };
      if (isEdit && editing) {
        await apiFetch(`/habits/${editing.id}`, token!, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/habits', token!, { method: 'POST', body: JSON.stringify(body) });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setAlertInfo({
        title: 'Error',
        message: err.message ?? (isEdit ? 'Failed to save habit.' : 'Failed to add habit.'),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
              <Text style={styles.title}>{isEdit ? 'Edit Habit' : '+ New Habit'}</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {/* Icon picker */}
              <View style={styles.field}>
                <Text style={styles.label}>Icon</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
                    {ICON_CHOICES.map(em => (
                      <TouchableOpacity
                        key={em}
                        onPress={() => setIcon(em)}
                        style={[styles.iconChip, icon === em && styles.iconChipActive]}
                      >
                        <Text style={{ fontSize: 20 }}>{em}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Name */}
              <View style={styles.field}>
                <Text style={styles.label}>Habit Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Workout, AI Learning"
                  placeholderTextColor={c.textFaint}
                  style={styles.input}
                  maxLength={120}
                />
              </View>

              {/* Color picker */}
              <View style={styles.field}>
                <Text style={styles.label}>Color</Text>
                <View style={styles.colorRow}>
                  {(Object.keys(HABIT_COLORS) as HabitColorKey[]).map(key => (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setColor(key)}
                      style={[
                        styles.colorDot,
                        { backgroundColor: HABIT_COLORS[key].base },
                        color === key && styles.colorDotActive,
                      ]}
                    />
                  ))}
                </View>
              </View>

              {/* Weekly target */}
              <View style={styles.field}>
                <Text style={styles.label}>Weekly target — {weeklyTarget} {weeklyTarget === 1 ? 'day' : 'days'}/week</Text>
                <View style={styles.chipRow}>
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setWeeklyTarget(n)}
                      style={[styles.targetChip, weeklyTarget === n && styles.targetChipActive]}
                    >
                      <Text style={[styles.targetChipText, weeklyTarget === n && styles.targetChipTextActive]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Schedule days */}
              <View style={styles.field}>
                <Text style={styles.label}>Days</Text>
                <View style={styles.chipRow}>
                  {DAY_LABELS.map((lbl, d) => {
                    const on = scheduleDays.includes(d);
                    return (
                      <TouchableOpacity
                        key={d}
                        onPress={() => toggleDay(d)}
                        style={[styles.dayChip, on && styles.dayChipActive]}
                      >
                        <Text style={[styles.dayChipText, on && styles.dayChipTextActive]}>{lbl}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Note */}
              <View style={styles.field}>
                <Text style={styles.label}>Note <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="e.g. 45 min deep work before office"
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
                  : <Text style={styles.submitText}>{isEdit ? 'Save Changes' : 'Create Habit'}</Text>
                }
              </TouchableOpacity>

              {isEdit && onDelete && (
                <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} disabled={loading}>
                  <Text style={styles.deleteText}>🗑️ Delete Habit</Text>
                </TouchableOpacity>
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
    alignItems: 'center', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },

  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: c.text, backgroundColor: c.inputBg,
  },

  iconChip: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.card,
  },
  iconChipActive: { backgroundColor: c.chipBg, borderColor: c.primary },

  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  colorDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: 'transparent' },
  colorDotActive: { borderColor: c.text },

  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  targetChip: {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.card,
  },
  targetChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  targetChipText: { fontSize: 14, fontWeight: '700', color: c.textMuted },
  targetChipTextActive: { color: c.onColor },

  dayChip: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.card,
  },
  dayChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  dayChipText: { fontSize: 13, fontWeight: '700', color: c.textMuted },
  dayChipTextActive: { color: c.onColor },

  submitBtn: {
    backgroundColor: c.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  submitText: { color: c.onColor, fontSize: 16, fontWeight: '700' },

  deleteBtn: {
    borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 10,
    borderWidth: 1, borderColor: c.danger,
  },
  deleteText: { color: c.danger, fontSize: 14, fontWeight: '700' },
});
