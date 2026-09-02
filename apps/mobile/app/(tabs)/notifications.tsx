import { useMemo } from 'react';
import { View, Text, Switch, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useNotificationPrefs } from '@/lib/notificationsPrefs';

const NEWS_CATS: { key: string; label: string; icon: string }[] = [
  { key: 'markets', label: 'Markets & Business', icon: '📈' },
  { key: 'tech', label: 'Tech', icon: '💻' },
  { key: 'science', label: 'Science', icon: '🔬' },
];

export default function NotificationsScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { prefs, loading, update } = useNotificationPrefs();

  // Empty newsCategories means "all", so show all selected in that case.
  const selected = new Set(prefs?.newsCategories?.length ? prefs.newsCategories : NEWS_CATS.map(x => x.key));

  function toggleCat(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Keep at least one; if they clear all, treat as "all" (store []).
    const arr = [...next];
    update({ newsCategories: arr.length === NEWS_CATS.length || arr.length === 0 ? [] : arr });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Choose what Velora pings you about. Alerts are sent from the server, so they arrive even when the
          app is closed.
        </Text>

        {loading && !prefs ? (
          <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* Job alerts */}
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>💼 Job alerts</Text>
                  <Text style={styles.sub}>A push whenever new jobs match one of your saved searches. Checked hourly.</Text>
                </View>
                <Switch
                  value={prefs?.notifyJobs ?? true}
                  onValueChange={v => update({ notifyJobs: v })}
                  trackColor={{ true: c.primary, false: c.inputBorder }}
                  thumbColor={c.onColor}
                />
              </View>
            </View>

            {/* News digest */}
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>🗞️ News briefing</Text>
                  <Text style={styles.sub}>A morning &amp; evening digest — the top headlines, not a buzz per story.</Text>
                </View>
                <Switch
                  value={prefs?.notifyNews ?? false}
                  onValueChange={v => update({ notifyNews: v })}
                  trackColor={{ true: c.primary, false: c.inputBorder }}
                  thumbColor={c.onColor}
                />
              </View>

              {prefs?.notifyNews && (
                <>
                  <Text style={styles.pickLabel}>Include</Text>
                  <View style={styles.chips}>
                    {NEWS_CATS.map(cat => {
                      const on = selected.has(cat.key);
                      return (
                        <TouchableOpacity
                          key={cat.key}
                          style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
                          onPress={() => toggleCat(cat.key)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.chipText, { color: on ? c.onColor : c.textMuted }]}>
                            {cat.icon} {cat.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* Bill & EMI reminders */}
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>🔔 Bill &amp; EMI reminders</Text>
                  <Text style={styles.sub}>A heads-up when a recurring bill or loan EMI is due in the next couple of days.</Text>
                </View>
                <Switch
                  value={prefs?.notifyBills ?? true}
                  onValueChange={v => update({ notifyBills: v })}
                  trackColor={{ true: c.primary, false: c.inputBorder }}
                  thumbColor={c.onColor}
                />
              </View>
            </View>

            {/* Budget warnings */}
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>🎯 Budget warnings</Text>
                  <Text style={styles.sub}>A nudge when a category hits 80% and again at 100% of its monthly budget.</Text>
                </View>
                <Switch
                  value={prefs?.notifyBudgets ?? true}
                  onValueChange={v => update({ notifyBudgets: v })}
                  trackColor={{ true: c.primary, false: c.inputBorder }}
                  thumbColor={c.onColor}
                />
              </View>
            </View>

            {/* Quiet hours */}
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>🌙 Quiet hours</Text>
                  <Text style={styles.sub}>Hold job &amp; watchlist alerts overnight (10pm–7am). Held alerts arrive in the morning.</Text>
                </View>
                <Switch
                  value={prefs?.quietOvernight ?? false}
                  onValueChange={v => update({ quietOvernight: v })}
                  trackColor={{ true: c.primary, false: c.inputBorder }}
                  thumbColor={c.onColor}
                />
              </View>
            </View>

            <Text style={styles.note}>
              You'll be asked for notification permission the first time. On Android, keep Velora exempt from
              battery optimization so pushes arrive promptly. Requires the latest app build.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 13, color: c.textMuted, lineHeight: 19 },

  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 15, fontWeight: '700', color: c.text },
  sub: { fontSize: 12, color: c.textMuted, marginTop: 4, lineHeight: 17 },

  pickLabel: { fontSize: 12, fontWeight: '700', color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipOff: { backgroundColor: c.chipBg, borderColor: c.chipBorder },
  chipText: { fontSize: 13, fontWeight: '700' },

  note: { fontSize: 11.5, color: c.textFaint, lineHeight: 16, fontStyle: 'italic', marginTop: 4 },
});
