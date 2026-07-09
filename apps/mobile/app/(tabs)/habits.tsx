import { useState, useMemo, useRef } from 'react';
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
  PanResponder,
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

// Shift an ISO day (YYYY-MM-DD) by n days.
function isoAddDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Label for the visible week: named for near weeks, date range further away.
function weekLabel(offset: number, days?: string[]): string {
  if (offset === 0) return 'This Week';
  if (offset === -1) return 'Last Week';
  if (offset === 1) return 'Next Week';
  if (!days || days.length < 7) return '…';
  const f = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${f(days[0])} – ${f(days[6])}`;
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
  // 0 = current week, -1 = last week, +1 = next week…
  const [weekOffset, setWeekOffset] = useState(0);
  const [alertData, setAlertData] = useState<{
    title: string; message: string;
    confirmLabel?: string; confirmDestructive?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const anchor = useMemo(() => isoAddDays(today, weekOffset * 7), [today, weekOffset]);

  const boardQuery = useQuery({
    queryKey: ['habits', today, anchor],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Board>(`/habits?today=${today}&anchor=${anchor}`, token!);
    },
    // Ticks update the cache optimistically, so a short staleTime only causes
    // redundant refetches — 2 min matches the rest of the app.
    staleTime: 2 * 60 * 1000,
  });

  // Swipe left/right on the board to move between weeks. Claims the gesture
  // only for clearly-horizontal drags so cell taps and vertical scroll keep working.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => {
        if (g.dx <= -48) setWeekOffset(o => o + 1);      // swipe left → next week
        else if (g.dx >= 48) setWeekOffset(o => o - 1);  // swipe right → last week
      },
    }),
  ).current;

  const board = boardQuery.data;
  const habits = board?.habits ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['habits'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }); // habit ticks feed the dashboard streak
  }

  // Optimistically flip a cell, then persist. Server recomputes score on refetch.
  async function toggleCell(habit: HabitRow, day: string, cur: CheckStatus) {
    if (day > today) return; // can't do a habit in the future
    const next = nextStatus(cur);
    queryClient.setQueryData<Board>(['habits', today, anchor], prev => {
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
          onDelete={editing ? () => {
            const h = editing;
            setSheetOpen(false);
            setEditing(null);
            deleteHabit(h); // opens the confirm dialog
          } : undefined}
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
                  <View style={styles.weekNav}>
                    <TouchableOpacity style={styles.weekNavBtn} onPress={() => setWeekOffset(o => o - 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.weekNavArrow}>‹</Text>
                    </TouchableOpacity>
                    {/* Tap the label to jump back to the current week */}
                    <TouchableOpacity onPress={() => setWeekOffset(0)}>
                      <Text style={styles.sectionTitle}>{weekLabel(weekOffset, board?.days)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.weekNavBtn} onPress={() => setWeekOffset(o => o + 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.weekNavArrow}>›</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.addBtn} onPress={() => { setEditing(null); setSheetOpen(true); }}>
                    <Text style={styles.addBtnText}>+ Add</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.boardCard} {...panResponder.panHandlers}>
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
                          const isFuture = w.day > today;
                          return (
                            <TouchableOpacity
                              key={w.day}
                              style={[
                                styles.checkCell,
                                isToday && styles.checkCellToday,
                                w.status && { backgroundColor: col.soft },
                                isFuture && styles.checkCellFuture,
                              ]}
                              activeOpacity={isFuture ? 1 : 0.6}
                              disabled={isFuture}
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

                {/* ── Per-habit stats (tap a card to edit that habit) ──────── */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Streaks & Progress</Text>
                  <Text style={styles.sectionHint}>tap a habit to edit</Text>
                </View>

                {habits.map(h => {
                  const col = habitColor(h.color);
                  const targetPct = Math.min(100, (h.weeklyDone / h.weeklyTarget) * 100);
                  return (
                    <TouchableOpacity
                      key={h.id}
                      style={styles.statCard}
                      activeOpacity={0.7}
                      onPress={() => { setEditing(h); setSheetOpen(true); }}
                    >
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
                        <Text style={styles.editHint}>✎</Text>
                      </View>
                      <View style={styles.statTrack}>
                        <View style={[styles.statFill, { width: `${targetPct}%`, backgroundColor: col.base }]} />
                      </View>
                    </TouchableOpacity>
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
  sectionHint: { fontSize: 11, color: c.textFaint },
  editHint: { fontSize: 14, color: c.textFaint, marginLeft: 8 },
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekNavBtn: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.cardBorder,
  },
  weekNavArrow: { fontSize: 16, lineHeight: 18, color: c.textMuted, fontWeight: '700' },
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
  checkCellFuture: { opacity: 0.35 },
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
