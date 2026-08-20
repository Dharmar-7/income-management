import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useSafetyNet, formatMonths } from '@/lib/safetyNet';

// Compact "Safety Net" card for the Home Money section: the single number that
// matters if income stops — how many months you can cover essentials — with a
// tap through to the full plan.
export default function RunwayCard() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const sn = useSafetyNet();

  if (sn.loading) return <View style={[styles.card, styles.skeleton]} />;

  const months = sn.survivalMonths;

  // Nothing to compute yet (no fund + no spending history) → a gentle setup nudge.
  if (months == null) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push('/(tabs)/safety-net')}
        activeOpacity={0.7}
      >
        <View style={styles.header}>
          <Text style={styles.title}>🛟  Safety Net</Text>
          <Text style={styles.link}>Set up ›</Text>
        </View>
        <Text style={styles.nudge}>
          See how long you could go without income — set your emergency fund to start.
        </Text>
      </TouchableOpacity>
    );
  }

  // Emergency-fund rule of thumb: 3–6 months of essentials. Scale the bar so 6
  // months reads as "full", and colour by the same ramp used for budgets.
  const color = months >= 6 ? c.success : months >= 3 ? c.warning : c.danger;
  const pct = Math.min(100, (months / 6) * 100);
  const verdict =
    months >= 6 ? 'Well cushioned' : months >= 3 ? 'A decent buffer' : 'Thin — build this up';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push('/(tabs)/safety-net')}
      activeOpacity={0.85}
    >
      <View style={styles.header}>
        <Text style={styles.title}>🛟  Safety Net</Text>
        <Text style={styles.link}>View plan ›</Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.months, { color }]}>{formatMonths(months)}</Text>
        <Text style={styles.sub}>of essentials if your income stops today</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>

      <Text style={[styles.verdict, { color }]}>{verdict}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  skeleton: { height: 120, opacity: 0.5 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: c.text },
  link: { fontSize: 12.5, fontWeight: '700', color: c.primary },

  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  months: { fontSize: 28, fontWeight: '800' },
  sub: { fontSize: 12.5, color: c.textMuted, flexShrink: 1 },

  track: { height: 8, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },

  verdict: { fontSize: 12.5, fontWeight: '700' },
  nudge: { fontSize: 13, color: c.textMuted, lineHeight: 19 },
});
