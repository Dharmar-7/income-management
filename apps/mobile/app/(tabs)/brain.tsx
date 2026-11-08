import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScrollToTop } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useBrainData } from '@/lib/brain/useBrainData';
import { SkeletonList } from '@/components/Skeleton';
import { hSelect } from '@/lib/haptics';
import AskPanel, { type AskTurn } from '@/components/brain/AskPanel';
import InsightsPanel from '@/components/brain/InsightsPanel';
import PlannersPanel from '@/components/brain/PlannersPanel';
import TaxPanel from '@/components/brain/TaxPanel';

// 🧠 Velora Brain — a private, rules-and-maths money expert. Everything is
// computed on the phone from the user's own data; no AI model, no extra cost.

type Tab = 'ask' | 'insights' | 'planners' | 'tax';
const TABS: { key: Tab; label: string }[] = [
  { key: 'ask', label: '💬 Ask' },
  { key: 'insights', label: '💡 Insights' },
  { key: 'planners', label: '🧮 Planners' },
  { key: 'tax', label: '🧾 Tax' },
];

export default function BrainScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>('ask');
  const [thread, setThread] = useState<AskTurn[]>([]); // kept here so switching tabs doesn't lose it
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const data = useBrainData();

  // Deep link from an Ask answer, e.g. /(tabs)/brain?tab=planners
  useEffect(() => {
    const t = params.tab;
    if (t === 'ask' || t === 'insights' || t === 'planners' || t === 'tax') {
      setTab(t);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [params.tab]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.refetch} tintColor={c.primary} />}
      >
        <View>
          <Text style={styles.h1}>🧠 Velora Brain</Text>
          <Text style={styles.sub}>Your private money expert. Works it out on your phone from your own data, for free.</Text>
        </View>

        <View style={styles.tabs}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              onPress={() => { hSelect(); setTab(t.key); }}
              style={[styles.tab, tab === t.key && styles.tabOn]}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]} numberOfLines={1}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {data.loading ? (
          <SkeletonList count={3} />
        ) : data.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Couldn't load your history. Pull down to try again.</Text>
          </View>
        ) : (
          <>
            {tab === 'ask' && <AskPanel data={data} thread={thread} setThread={setThread} />}
            {tab === 'insights' && <InsightsPanel data={data} />}
            {tab === 'planners' && <PlannersPanel data={data} />}
            {tab === 'tax' && <TaxPanel data={data} />}
          </>
        )}

        <TouchableOpacity style={styles.coach} onPress={() => router.push('/(tabs)/coach')} activeOpacity={0.8}>
          <Text style={styles.coachIcon}>🧭</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.coachTitle}>Investment Coach</Text>
            <Text style={styles.coachSub}>Readiness, your investment mix, goals and the money calendar</Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '800', color: c.text },
  sub: { fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 18 },

  tabs: { flexDirection: 'row', gap: 6, backgroundColor: c.chipBg, borderRadius: 14, borderWidth: 1, borderColor: c.chipBorder, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  tabOn: { backgroundColor: c.primary },
  tabText: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  tabTextOn: { color: c.onColor },

  errorBox: { backgroundColor: c.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: c.cardBorder },
  errorText: { fontSize: 13.5, color: c.textMuted, textAlign: 'center' },

  coach: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6,
    backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.cardBorder,
  },
  coachIcon: { fontSize: 24 },
  coachTitle: { fontSize: 14.5, fontWeight: '700', color: c.text },
  coachSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  chev: { fontSize: 22, color: c.textFaint },
});
