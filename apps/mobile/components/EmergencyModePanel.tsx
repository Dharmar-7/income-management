import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useSafetyNet, useFirstWeekPlan, formatINR, formatMonths } from '@/lib/safetyNet';
import { useJobFinder } from '@/lib/useJobFinder';
import { FIRST_WEEK_TASK_COUNT } from '@/components/FirstWeekChecklist';

// The survival view that leads the Home dashboard while Emergency Mode is on:
// the runway, the monthly essentials to cover, first-week plan progress, and a
// nudge to keep applying. Rendered only when the Settings toggle is enabled.
export default function EmergencyModePanel() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();

  const sn = useSafetyNet();
  const { done } = useFirstWeekPlan();
  const { enabled: jobsEnabled } = useJobFinder();

  const months = sn.survivalMonths;
  const color = months == null ? c.textFaint : months >= 6 ? c.success : months >= 3 ? c.warning : c.danger;
  const pct = months == null ? 0 : Math.min(100, (months / 6) * 100);

  return (
    <View style={styles.panel}>
      <View style={styles.badgeRow}>
        <Text style={styles.badge}>🛟  EMERGENCY MODE</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/safety-net')}>
          <Text style={styles.link}>Full plan ›</Text>
        </TouchableOpacity>
      </View>

      {months == null ? (
        <TouchableOpacity onPress={() => router.push('/(tabs)/safety-net')} activeOpacity={0.7}>
          <Text style={styles.setup}>Set your emergency fund to see how long you could go without income ›</Text>
        </TouchableOpacity>
      ) : (
        <>
          <View style={styles.runwayRow}>
            <Text style={[styles.months, { color }]}>{formatMonths(months)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.runwayLabel}>of runway on essentials</Text>
              <Text style={styles.essentials}>≈ {formatINR(sn.essentialMonthly)} / month to cover</Text>
            </View>
          </View>
          <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} /></View>
        </>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={() => router.push('/(tabs)/safety-net')} activeOpacity={0.7}>
          <Text style={styles.actionText}>📋  First-week plan</Text>
          <Text style={styles.actionMeta}>{done.length}/{FIRST_WEEK_TASK_COUNT} ›</Text>
        </TouchableOpacity>

        {jobsEnabled && (
          <TouchableOpacity style={styles.action} onPress={() => router.push('/(tabs)/jobs')} activeOpacity={0.7}>
            <Text style={styles.actionText}>💼  Keep applying</Text>
            <Text style={styles.actionMeta}>›</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  panel: {
    backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1.5, borderColor: c.primary,
  },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontSize: 11.5, fontWeight: '800', color: c.primary, letterSpacing: 0.6 },
  link: { fontSize: 12.5, fontWeight: '700', color: c.primary },

  setup: { fontSize: 13, color: c.textMuted, lineHeight: 19 },

  runwayRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  months: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  runwayLabel: { fontSize: 13, color: c.text, fontWeight: '600' },
  essentials: { fontSize: 12, color: c.textMuted, marginTop: 2 },

  track: { height: 8, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },

  actions: { gap: 8 },
  action: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.chipBg, borderRadius: 12, borderWidth: 1, borderColor: c.chipBorder,
    paddingVertical: 11, paddingHorizontal: 13,
  },
  actionText: { fontSize: 13.5, fontWeight: '700', color: c.text },
  actionMeta: { fontSize: 13, fontWeight: '700', color: c.primary },
});
