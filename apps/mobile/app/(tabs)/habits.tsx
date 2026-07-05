import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import AddHabitSheet, { type EditingHabit } from '@/components/AddHabitSheet';
import AppAlert from '@/components/AppAlert';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { habitColor } from '@/lib/habitColors';

// ─── Types ───────────────────────────────────────────────────────────────────
type CheckStatus = 'DONE' | 'PARTIAL' | null;

interface HabitRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  weeklyTarget: number;
  scheduleDays: number[];
  note: string | null;
  week: { day: string; status: CheckStatus }[];
  weekPercent: number;
  weeklyDone: number;
  currentStreak: number;
  longestStreak: number;
  today: CheckStatus;
}

interface Board {
  weekStart: string;
  days: string[];
  todayIso: string;
  habits: HabitRow[];
  dailyScore: number;
  dailyDone: number;
  dailyDue: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DAY_LETTERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Local calendar day as YYYY-MM-DD (NOT UTC — IST is +5:30, so toISOString would
// roll to the next day late evening). Built from local getters.
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Tap cycle: empty → ✅ → 🟡 → empty.
function nextStatus(cur: CheckStatus): CheckStatus {
  if (cur === null) return 'DONE';
  if (cur === 'DONE') return 'PARTIAL';
  return null;
}

const SYMBOL: Record<'DONE' | 'PARTIAL', string> = { DONE: '✅', PARTIAL: '🟡' };

function scoreVerdict(score: number): { label: string; color: (c: Theme) => string } {
  if (score >= 85) return { label: '🔥 Elite', color: c => c.orange };
  if (score >= 70) return { label: '✅ Strong', color: c => c.success };
  if (score >= 50) return { label: '🟡 Showed up', color: c => c.warning };
  return { label: '⚠️ Recover', color: c => c.danger };
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function HabitsScreen() {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const queryClient = useQueryClient();
  const today = useMemo(() => localToday(), []);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<HabitRow | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [alertData, setAlertData] = useState<{
    title: string; message: string;
    confirmLabel?: string; confirmDestructive?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const boardQuery = useQuery({
    queryKey: ['habits', today],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Board>(`/habits?today=${today}`, token!);
    },
    // Ticks update the cache optimistically, so a short staleTime only causes
    // redundant refetches — 2 min matches the rest of the app.
    staleTime: 2 * 60 * 1000,
  });

  const board = boardQuery.data;
  const habits = board?.habits ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['habits'] });
  }

  // Optimistically flip a cell, then persist. Server recomputes score on refetch.
  async function toggleCell(habit: HabitRow, day: string, cur: CheckStatus) {
    const next = nextStatus(cur);
    queryClient.setQueryData<Board>(['habits', today], prev => {
      if (!prev) return prev;
      return {
        ...prev,
        habits: prev.habits.map(h => {
          if (h.id !== habit.id) return h;
          return {
            ...h,
            week: h.week.map(w => (w.day === day ? { ...w, status: next } : w)),
            today: day === prev.todayIso ? next : h.today,
          };
        }),
      };
    });

    try {
      const token = await getToken();
      await apiFetch(`/habits/${habit.id}/checkin`, token!, {
        method: 'POST',
        body: JSON.stringify({ day, status: 'TOGGLE' }),
      });
    } catch {
      // Roll back by refetching the truth.
    } finally {
      invalidate();
    }
  }

  async function seedDefaults() {
    setSeeding(true);
    try {
      const token = await getToken();
      await apiFetch('/habits/seed-defaults', token!, { method: 'POST', body: JSON.stringify({}) });
      invalidate();
    } catch (err: any) {
      setAlertData({ title: 'Error', message: err?.message ?? 'Could not add starter habits.' });
    } finally {
      setSeeding(false);
    }
  }

  function deleteHabit(h: HabitRow) {
    setAlertData({
      title: 'Delete Habit',
      message: `Delete "${h.name}" and all its check-ins? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmDestructive: true,
      onConfirm: async () => {
        try {
          const token = await getToken();
          await apiFetch(`/habits/${h.id}`, token!, { method: 'DELETE' });
          invalidate();
        } catch {
          setAlertData({ title: 'Error', message: 'Failed to delete habit.' });
        }
      },
    });
  }

  const editingPayload: EditingHabit | null = editing ? {
    id: editing.id,
    name: editing.name,
    icon: editing.icon,
    color: editing.color,
    weeklyTarget: editing.weeklyTarget,
    scheduleDays: editing.scheduleDays,
    note: editing.note,
  } : null;

  const verdict = scoreVerdict(board?.dailyScore ?? 0);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {sheetOpen && (
        <AddHabitSheet
          visible
          editing={editingPayload}
          onClose={() => { setSheetOpen(false); setEditing(null); }}
          onSuccess={() => { invalidate(); setSheetOpen(false); setEditing(null); }}
        />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={boardQuery.isFetching} onRefresh={() => boardQuery.refetch()} />}
      >
        {boardQuery.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color={c.primary} /></View>
        ) : (
          <>
            {/* ── Daily Scoreboard ─────────────────────────────────────── */}
            <View style={styles.scoreCard}>
              <View style={styles.scoreTop}>
                <View>
                  <Text style={styles.scoreLabel}>Today's Score</Text>
                  <Text style={styles.scoreValue}>{board?.dailyScore ?? 0}<Text style={styles.scoreOf}> / 100</Text></Text>
                </View>
                <View style={styles.verdictPill}>
                  <Text style={[styles.verdictText, { color: verdict.color(c) }]}>{verdict.label}</Text>
                </View>
              </View>
              <View style={styles.scoreTrack}>
                <View style={[styles.scoreFill, { width: `${board?.dailyScore ?? 0}%`, backgroundColor: verdict.color(c) }]} />
              </View>
              <Text style={styles.scoreHint}>
                {board ? `${board.dailyDone}/${board.dailyDue} habits done today` : ''}
              </Text>
            </View>

            {habits.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No habits yet.</Text>
                <Text style={styles.emptyHint}>Start with the 7 Life OS habits, or add your own.</Text>
                <TouchableOpacity style={styles.seedBtn} onPress={seedDefaults} disabled={seeding}>
                  {seeding
                    ? <ActivityIndicator color={c.onColor} />
                    : <Text style={styles.seedBtnText}>✨ Add starter habits</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* ── Weekly Board ───────────────────────────────────────── */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>This Week</Text>
                  <TouchableOpacity style={styles.addBtn} onPress={() => { setEditing(null); setSheetOpen(true); }}>
                    <Text style={styles.addBtnText}>+ Add</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.boardCard}>
                  {/* Header row: weekday letters, today highlighted */}
                  <View style={styles.boardRow}>
                    <View style={styles.labelCell} />
                    {(board?.days ?? []).map((day, i) => {
                      const isToday = day === board?.todayIso;
                      return (
                        <View key={day} style={styles.dayCell}>
                          <Text style={[styles.dayLetter, isToday && styles.dayLetterToday]}>{DAY_LETTERS[i]}</Text>
                          <Text style={[styles.dayNum, isToday && styles.dayLetterToday]}>{day.slice(8)}</Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* One row per habit */}
                  {habits.map(h => {
                    const col = habitColor(h.color);
                    return (
                      <View key={h.id} style={styles.boardRow}>
                        <TouchableOpacity
                          style={styles.labelCell}
                          onPress={() => { setEditing(h); setSheetOpen(true); }}
                          onLongPress={() => deleteHabit(h)}
                        >
                          <Text style={styles.habitIcon}>{h.icon}</Text>
                          <Text style={styles.habitName} numberOfLines={1}>{h.name}</Text>
                        </TouchableOpacity>
                        {h.week.map(w => {
                          const isToday = w.day === board?.todayIso;
                          return (
                            <TouchableOpacity
                              key={w.day}
                              style={[
                                styles.checkCell,
                                isToday && styles.checkCellToday,
                                w.status && { backgroundColor: col.soft },
                              ]}
                              activeOpacity={0.6}
                              onPress={() => toggleCell(h, w.day, w.status)}
                            >
                              <Text style={styles.checkMark}>{w.status ? SYMBOL[w.status] : ''}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>

                {/* ── Per-habit stats ─────────────────────────────────────── */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Streaks & Progress</Text>
                </View>

                {habits.map(h => {
                  const col = habitColor(h.color);
                  const targetPct = Math.min(100, (h.weeklyDone / h.weeklyTarget) * 100);
                  return (
                    <View key={h.id} style={styles.statCard}>
                      <View style={styles.statHeader}>
                        <View style={[styles.statIconBox, { backgroundColor: col.soft }]}>
                          <Text style={styles.statIcon}>{h.icon}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.statName}>{h.name}</Text>
                          <Text style={styles.statSub}>
                            {h.weeklyDone}/{h.weeklyTarget} this week · {h.weekPercent}%
                          </Text>
                        </View>
                        <View style={styles.streakBox}>
                          <Text style={styles.streakNum}>🔥 {h.currentStreak}</Text>
                          <Text style={styles.streakBest}>best {h.longestStreak}</Text>
                        </View>
                      </View>
                      <View style={styles.statTrack}>
                        <View style={[styles.statFill, { width: `${targetPct}%`, backgroundColor: col.base }]} />
                      </View>
                    </View>
                  );
                })}
              </>
            )}
            <View style={{ height: 24 }} />
          </>
        )}
      </ScrollView>

      <AppAlert
        visible={!!alertData}
        title={alertData?.title ?? ''}
        message={alertData?.message ?? ''}
        confirmLabel={alertData?.confirmLabel}
        confirmDestructive={alertData?.confirmDestructive}
        onClose={() => setAlertData(null)}
        onConfirm={alertData?.onConfirm}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  loading: { paddingVertical: 60, alignItems: 'center' },

  // score card
  scoreCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: c.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  scoreTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  scoreLabel: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  scoreValue: { fontSize: 32, fontWeight: '800', color: c.text, marginTop: 2 },
  scoreOf: { fontSize: 15, fontWeight: '600', color: c.textFaint },
  verdictPill: { backgroundColor: c.chipBg, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  verdictText: { fontSize: 13, fontWeight: '700' },
  scoreTrack: { height: 10, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden', marginTop: 12 },
  scoreFill: { height: '100%', borderRadius: 99 },
  scoreHint: { fontSize: 11, color: c.textFaint, marginTop: 6 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  addBtn: { backgroundColor: c.primary, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 },
  addBtnText: { color: c.onColor, fontSize: 13, fontWeight: '700' },

  emptyCard: { backgroundColor: c.card, borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, marginTop: 4 },
  emptyText: { fontSize: 15, color: c.text, fontWeight: '700' },
  emptyHint: { fontSize: 12, color: c.textFaint, marginTop: 4, textAlign: 'center' },
  seedBtn: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
  seedBtnText: { color: c.onColor, fontSize: 14, fontWeight: '700' },

  // weekly board
  boardCard: {
    backgroundColor: c.card, borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  boardRow: { flexDirection: 'row', alignItems: 'center' },
  labelCell: { width: 84, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingRight: 4 },
  habitIcon: { fontSize: 13 },
  habitName: { fontSize: 11, color: c.text, fontWeight: '600', flex: 1 },
  dayCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dayLetter: { fontSize: 9, color: c.textFaint, fontWeight: '700' },
  dayNum: { fontSize: 9, color: c.textFaint },
  dayLetterToday: { color: c.primary },
  checkCell: {
    flex: 1, aspectRatio: 1, maxHeight: 38, marginHorizontal: 2, marginVertical: 2,
    borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.chipBg,
  },
  checkCellToday: { borderColor: c.primary, borderWidth: 1.5 },
  checkMark: { fontSize: 14 },

  // stat cards
  statCard: {
    backgroundColor: c.card, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  statHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statIconBox: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  statIcon: { fontSize: 16 },
  statName: { fontSize: 14, fontWeight: '700', color: c.text },
  statSub: { fontSize: 11, color: c.textFaint, marginTop: 1 },
  streakBox: { alignItems: 'flex-end' },
  streakNum: { fontSize: 14, fontWeight: '800', color: c.text },
  streakBest: { fontSize: 10, color: c.textFaint },
  statTrack: { height: 6, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden', marginTop: 10 },
  statFill: { height: '100%', borderRadius: 99 },
});
