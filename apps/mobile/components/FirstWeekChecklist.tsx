import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useFirstWeekPlan } from '@/lib/safetyNet';

interface Task { id: string; icon: string; title: string; subtitle: string; route?: string }

// The first moves that actually matter if the income stops — ordered by
// urgency. India-aware: PF/EPF is a genuine backup, and group health cover
// ends with the job. Some tasks deep-link to the tools that do them.
const TASKS: Task[] = [
  { id: 'runway', icon: '🛟', title: 'Know your runway', subtitle: 'Set your emergency fund above so you know how many months you’ve got.' },
  { id: 'cutspend', icon: '✂️', title: 'Cut optional spending', subtitle: 'Pause subscriptions and non-essentials — every cut buys you more time.' },
  { id: 'sip', icon: '📈', title: 'Pause SIPs & auto-invests', subtitle: 'Free up monthly cash now; you can restart the moment you’re back on your feet.' },
  { id: 'pf', icon: '🏦', title: 'Check your PF / EPF', subtitle: 'When unemployed you can withdraw part of it — treat it as a backup fund.' },
  { id: 'health', icon: '🩺', title: 'Sort personal health cover', subtitle: 'Group cover from your job ends — don’t leave yourself uninsured.' },
  { id: 'resume', icon: '📄', title: 'Refresh resume & check ATS', subtitle: 'Score it against a real job before you apply.', route: '/(tabs)/ats' },
  { id: 'apply', icon: '💼', title: 'Start applying', subtitle: 'Line up roles and set alerts for new matches.', route: '/(tabs)/jobs' },
];

// Total number of first-week tasks — surfaced in the Emergency Mode panel's
// progress readout so it stays in sync with this list.
export const FIRST_WEEK_TASK_COUNT = TASKS.length;

// A checkable action plan for a job loss — lives on the Safety Net screen and is
// summarised in the Emergency Mode panel. Progress is stored on-device.
export default function FirstWeekChecklist() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { done, toggleTask } = useFirstWeekPlan();

  const doneSet = new Set(done);
  const doneCount = TASKS.filter(t => doneSet.has(t.id)).length;
  const pct = (doneCount / TASKS.length) * 100;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>📋  Your first-week plan</Text>
        <Text style={styles.count}>{doneCount}<Text style={styles.countTotal}> / {TASKS.length}</Text></Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>

      {TASKS.map(task => {
        const isDone = doneSet.has(task.id);
        return (
          <View key={task.id} style={styles.row}>
            <TouchableOpacity
              onPress={() => toggleTask(task.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isDone }}
              accessibilityLabel={`${isDone ? 'Mark not done' : 'Mark done'}: ${task.title}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.checkbox, isDone && { backgroundColor: c.success, borderColor: c.success }]}>
                {isDone && <Text style={styles.tick}>✓</Text>}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.body}
              activeOpacity={task.route ? 0.6 : 1}
              onPress={() => (task.route ? router.push(task.route as never) : toggleTask(task.id))}
            >
              <View style={styles.titleRow}>
                <Text style={styles.taskIcon}>{task.icon}</Text>
                <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={1}>{task.title}</Text>
                {task.route && <Text style={styles.open}>Open ›</Text>}
              </View>
              <Text style={styles.taskSub}>{task.subtitle}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14.5, fontWeight: '700', color: c.text },
  count: { fontSize: 15, fontWeight: '800', color: c.success },
  countTotal: { fontSize: 13, fontWeight: '700', color: c.textFaint },

  track: { height: 6, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99, backgroundColor: c.success },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 6 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.inputBorder,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  tick: { color: c.onColor, fontSize: 13, fontWeight: '900', lineHeight: 15 },

  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  taskIcon: { fontSize: 14 },
  taskTitle: { flex: 1, fontSize: 14, color: c.text, fontWeight: '600' },
  taskTitleDone: { color: c.textMuted, textDecorationLine: 'line-through' },
  open: { fontSize: 12, fontWeight: '700', color: c.primary },
  taskSub: { fontSize: 12, color: c.textMuted, lineHeight: 17 },
});
