import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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

          {/* Horizontal chip strip — every habit fits at a fixed height; swipe
              sideways for the rest. Tapping a chip completes it (fills with the
              habit's colour). Avoids fighting the Home screen's vertical scroll. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {dueToday.map(h => {
              const col = habitColor(h.color);
              const done = h.today === 'DONE';
              const partial = h.today === 'PARTIAL';
              return (
                <TouchableOpacity
                  key={h.id}
                  style={[
                    styles.chip,
                    done && { backgroundColor: col.base, borderColor: col.base },
                    partial && { borderColor: col.base },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => toggle(h)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={`${done ? 'Mark not done' : 'Mark done'}: ${h.name}`}
                >
                  {done ? (
                    <Text style={styles.chipTick}>✓</Text>
                  ) : (
                    <View style={[styles.chipRing, partial && { borderColor: col.base }]}>
                      {partial && <View style={[styles.chipDot, { backgroundColor: col.base }]} />}
                    </View>
                  )}
                  <Text style={styles.chipIcon}>{h.icon}</Text>
                  <Text
                    style={[styles.chipName, done && styles.chipNameDone]}
                    numberOfLines={1}
                  >
                    {h.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      <TouchableOpacity style={styles.footer} onPress={() => router.push('/(tabs)/habits')} activeOpacity={0.7}>
        <Text style={styles.footerText}>View all habits</Text>
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

  strip: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingLeft: 8, paddingRight: 13, paddingVertical: 8,
    borderRadius: 99, borderWidth: 1,
    backgroundColor: c.chipBg, borderColor: c.chipBorder,
    maxWidth: 180,
  },
  chipRing: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.inputBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipTick: {
    width: 18, height: 18, textAlign: 'center', lineHeight: 18,
    color: c.onColor, fontSize: 12, fontWeight: '900',
  },
  chipIcon: { fontSize: 14 },
  chipName: { fontSize: 13, color: c.text, fontWeight: '600' },
  chipNameDone: { color: c.onColor },

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
