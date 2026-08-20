import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { habitColor } from '@/lib/habitColors';

// A habit NOT ticked today comes back from the API as null — matching the Habits
// tab (CheckStatus = 'DONE' | 'PARTIAL' | null). The old card compared against the
// string 'NONE', and since null !== 'NONE' every habit rendered as already-done.
type CheckStatus = 'DONE' | 'PARTIAL' | null;

interface HabitRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  scheduleDays: number[]; // 0=Sun … 6=Sat
  today: CheckStatus;
}

interface Board {
  todayIso: string;
  habits: HabitRow[];
}

// Local calendar day as YYYY-MM-DD, built exactly like the Habits tab so the two
// share one React Query cache entry — a tick here instantly shows there too.
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MAX_ROWS = 6; // keep the card compact; the rest lives on the Habits tab

// A compact daily-habits checklist for the Home "Today" section: tick today's
// habits off without leaving the dashboard.
export default function HabitsTodayCard() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const today = localToday();
  const dow = new Date().getDay();
  const key = ['habits', today, today];

  const { data: board, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Board>(`/habits?today=${today}&anchor=${today}`, token!);
    },
    staleTime: 60 * 1000,
  });

  const allHabits = board?.habits ?? [];
  const dueToday = allHabits.filter(h => h.scheduleDays.includes(dow));
  const doneCount = dueToday.filter(h => h.today === 'DONE').length;
  const pct = dueToday.length > 0 ? (doneCount / dueToday.length) * 100 : 0;

  // Simple two-state toggle from Home: not-done → DONE, anything marked → clear.
  // (The three-state DONE → PARTIAL cycle stays on the Habits tab.) Send an
  // explicit status rather than TOGGLE so the outcome is predictable here.
  async function toggle(habit: HabitRow) {
    const marked = habit.today !== null;
    const nextToday: CheckStatus = marked ? null : 'DONE';
    const nextStatus = marked ? 'NONE' : 'DONE';

    qc.setQueryData<Board>(key, prev => prev && ({
      ...prev,
      habits: prev.habits.map(h => (h.id === habit.id ? { ...h, today: nextToday } : h)),
    }));

    try {
      const token = await getToken();
      await apiFetch(`/habits/${habit.id}/checkin`, token!, {
        method: 'POST',
        body: JSON.stringify({ day: today, status: nextStatus }),
      });
    } catch {
      // the invalidate below restores server truth if the write failed
    } finally {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] }); // ticks feed the streak
    }
  }

  if (isLoading) return <View style={[styles.card, styles.skeleton]} />;

  // No habits at all → a slim nudge to set some up.
  if (allHabits.length === 0) {
    return (
      <TouchableOpacity style={styles.emptyCard} onPress={() => router.push('/(tabs)/habits')} activeOpacity={0.7}>
        <Text style={styles.emptyIcon}>🌱</Text>
        <Text style={styles.emptyText}>Build a daily habit</Text>
        <Text style={styles.emptyArrow}>›</Text>
      </TouchableOpacity>
    );
  }

  const visible = dueToday.slice(0, MAX_ROWS);
  const hidden = dueToday.length - visible.length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>🎯  Today’s Habits</Text>
        {dueToday.length > 0 && (
          <Text style={[styles.count, { color: doneCount > 0 ? c.success : c.textFaint }]}>
            {doneCount}<Text style={styles.countTotal}> / {dueToday.length}</Text>
          </Text>
        )}
      </View>

      {dueToday.length === 0 ? (
        <Text style={styles.noneToday}>Nothing scheduled today — enjoy the rest 🎉</Text>
      ) : (
        <>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>

          <View style={styles.rows}>
            {visible.map(h => {
              const col = habitColor(h.color);
              const done = h.today === 'DONE';
              const partial = h.today === 'PARTIAL';
              return (
                <TouchableOpacity
                  key={h.id}
                  style={styles.row}
                  activeOpacity={0.6}
                  onPress={() => toggle(h)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={`${done ? 'Mark not done' : 'Mark done'}: ${h.name}`}
                >
                  <View
                    style={[
                      styles.checkbox,
                      done && { backgroundColor: col.base, borderColor: col.base },
                      partial && { borderColor: col.base },
                    ]}
                  >
                    {done && <Text style={styles.tick}>✓</Text>}
                    {partial && <View style={[styles.partialDot, { backgroundColor: col.base }]} />}
                  </View>
                  <Text style={styles.rowIcon}>{h.icon}</Text>
                  <Text style={[styles.rowName, done && styles.rowNameDone]} numberOfLines={1}>
                    {h.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <TouchableOpacity style={styles.footer} onPress={() => router.push('/(tabs)/habits')} activeOpacity={0.7}>
        <Text style={styles.footerText}>
          {hidden > 0 ? `+${hidden} more · View all habits` : 'View all habits'}
        </Text>
        <Text style={styles.footerArrow}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  skeleton: { height: 130, opacity: 0.5 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: c.text },
  count: { fontSize: 15, fontWeight: '800' },
  countTotal: { fontSize: 13, fontWeight: '700', color: c.textFaint },

  track: { height: 6, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99, backgroundColor: c.success },

  noneToday: { fontSize: 13, color: c.textFaint },

  rows: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.inputBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  tick: { color: c.onColor, fontSize: 13, fontWeight: '900', lineHeight: 15 },
  partialDot: { width: 10, height: 10, borderRadius: 5 },
  rowIcon: { fontSize: 15 },
  rowName: { flex: 1, fontSize: 14, color: c.text, fontWeight: '500' },
  rowNameDone: { color: c.textMuted, textDecorationLine: 'line-through' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 9,
  },
  footerText: { fontSize: 12.5, fontWeight: '700', color: c.primary },
  footerArrow: { fontSize: 16, fontWeight: '700', color: c.primary, marginTop: -1 },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  emptyIcon: { fontSize: 20 },
  emptyText: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
  emptyArrow: { fontSize: 22, color: c.textFaint },
});
