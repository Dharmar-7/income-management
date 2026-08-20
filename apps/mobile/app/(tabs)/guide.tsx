import { useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { CHANGELOG, GUIDE, useGuideSeen } from '@/lib/appGuide';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export default function GuideScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { isNew, markSeen } = useGuideSeen();

  // Badges reflect what's new for the whole visit; we only advance the "seen"
  // baseline on blur (empty-dep focus effect + a ref so it never fires early).
  const markRef = useRef(markSeen);
  markRef.current = markSeen;
  useFocusEffect(useCallback(() => () => { markRef.current(); }, []));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Everything Velora can do — and what’s changed recently. New here since your last visit is marked
          {'  '}<Text style={styles.inlineNew}>NEW</Text>.
        </Text>

        {/* ── What's new ── */}
        <Text style={styles.h1}>What’s new</Text>
        {CHANGELOG.map(rel => (
          <View key={rel.date + rel.title} style={styles.card}>
            <View style={styles.relHead}>
              <Text style={styles.relTitle}>{rel.title}</Text>
              {isNew(rel.date) && (
                <View style={styles.newPill}><Text style={styles.newPillText}>NEW</Text></View>
              )}
            </View>
            <Text style={styles.relDate}>{fmtDate(rel.date)}</Text>
            {rel.points.map((p, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{p}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* ── The manual ── */}
        <Text style={styles.h1}>What everything does</Text>
        {GUIDE.map(section => (
          <View key={section.title} style={styles.card}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item, i) => (
              <View key={item.title} style={[styles.item, i > 0 && styles.itemDivider]}>
                <Text style={styles.itemIcon}>{item.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemWhat}>{item.what}</Text>
                  {item.how ? <Text style={styles.itemHow}>💡 {item.how}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer}>
          Tap the centre gem in the tab bar to open any of these. This guide updates as new features arrive.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 13, color: c.textMuted, lineHeight: 19 },
  inlineNew: {
    fontSize: 10, fontWeight: '900', color: c.successDeep, letterSpacing: 0.5,
  },

  h1: { fontSize: 18, fontWeight: '800', color: c.text, marginTop: 8 },

  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 6 },

  // What's new
  relHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  relTitle: { fontSize: 15.5, fontWeight: '800', color: c.text, flexShrink: 1 },
  newPill: { backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  newPillText: { fontSize: 10, fontWeight: '900', color: c.successDeep, letterSpacing: 0.5 },
  relDate: { fontSize: 11.5, color: c.textFaint, marginBottom: 4 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { fontSize: 14, color: c.primary, lineHeight: 20 },
  bulletText: { flex: 1, fontSize: 13, color: c.textMuted, lineHeight: 19 },

  // Manual
  sectionTitle: { fontSize: 12, fontWeight: '800', color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 },
  itemDivider: { borderTopWidth: 1, borderTopColor: c.cardBorder },
  itemIcon: { fontSize: 20, marginTop: 1 },
  itemTitle: { fontSize: 14.5, fontWeight: '700', color: c.text },
  itemWhat: { fontSize: 13, color: c.textMuted, lineHeight: 19, marginTop: 2 },
  itemHow: { fontSize: 12.5, color: c.textFaint, lineHeight: 18, marginTop: 4 },

  footer: { fontSize: 12, color: c.textFaint, lineHeight: 18, fontStyle: 'italic', marginTop: 4, textAlign: 'center' },
});
