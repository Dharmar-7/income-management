import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { habitColor } from '@/lib/habitColors';

type CheckStatus = 'NONE' | 'PARTIAL' | 'DONE';

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
  dailyDone: number;
  dailyDue: number;
}

// Local calendar day (en-CA formats as YYYY-MM-DD) so it matches the Habits tab.
function localToday() {
  return new Date().toLocaleDateString('en-CA');
}

// A compact daily-habits card for the Home "Today" section: shows the habits
// due today as tappable chips you can tick off without leaving the dashboard.
export default function HabitsTodayCard() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const today = localToday();
  const dow = new Date().getDay();
  // Same query key the Habits tab uses for the current week → shared cache.
  const key = ['habits', today, today];

  const { data: board, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Board>(`/habits?today=${today}&anchor=${today}`, token!);
    },
    staleTime: 60 * 1000,
  });

  const dueToday = (board?.habits ?? []).filter(h => h.scheduleDays.includes(dow));
  const doneCount = dueToday.filter(h => h.today !== 'NONE').length;

  async function toggle(habit: HabitRow) {
    // Optimistic flip on the shared cache.
    qc.setQueryData<Board>(key, prev => prev && ({
      ...prev,
      habits: prev.habits.map(h =>
        h.id === habit.id ? { ...h, today: h.today === 'NONE' ? 'DONE' : 'NONE' } : h),
    }));
    try {
      const token = await getToken();
      await apiFetch(`/habits/${habit.id}/checkin`, token!, {
        method: 'POST',
        body: JSON.stringify({ day: today, status: 'TOGGLE' }),
      });
    } catch {
      // fall through — invalidate restores the truth
    } finally {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] }); // ticks feed the streak
    }
  }

  if (isLoading) return <View style={[styles.card, styles.skeleton]} />;

  // No habits yet → a slim nudge to set some up.
  if ((board?.habits ?? []).length === 0) {
    return (
      <TouchableOpacity style={styles.emptyCard} onPress={() => router.push('/(tabs)/habits')}>
        <Text style={styles.emptyIcon}>🌱</Text>
        <Text style={styles.emptyText}>Build a daily habit</Text>
        <Text style={styles.emptyArrow}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>✅ Today’s Habits</Text>
        <Text style={styles.count}>{doneCount}/{dueToday.length || 0}</Text>
      </View>

      {dueToday.length === 0 ? (
        <Text style={styles.noneToday}>Nothing scheduled today — enjoy the rest 🎉</Text>
      ) : (
        <View style={styles.chips}>
          {dueToday.map(h => {
            const col = habitColor(h.color);
            const done = h.today !== 'NONE';
            return (
              <TouchableOpacity
                key={h.id}
                onPress={() => toggle(h)}
                style={[
                  styles.chip,
                  done
                    ? { backgroundColor: col.base, borderColor: col.base }
                    : { borderColor: c.inputBorder, backgroundColor: c.card },
                ]}
                activeOpacity={0.7}
              >
                <Text style={styles.chipIcon}>{done ? '✓' : h.icon}</Text>
                <Text style={[styles.chipText, { color: done ? c.onColor : c.textMuted }]} numberOfLines={1}>
                  {h.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  skeleton: { height: 84, opacity: 0.5 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: c.text },
  count: { fontSize: 13, fontWeight: '800', color: c.primary },
  noneToday: { fontSize: 13, color: c.textFaint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1,
  },
  chipIcon: { fontSize: 13 },
  chipText: { fontSize: 12.5, fontWeight: '600', maxWidth: 130 },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  emptyIcon: { fontSize: 20 },
  emptyText: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
  emptyArrow: { fontSize: 22, color: c.textFaint },
});
