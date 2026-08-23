import { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useSavedJobs, useSavedArticles, type SavedJob, type SavedArticle } from '@/lib/bookmarks';

type Tab = 'jobs' | 'articles';

export default function SavedScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<Tab>('jobs');

  const savedJobs = useSavedJobs();
  const savedArticles = useSavedArticles();

  async function openUrl(url: string) {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url, {
        toolbarColor: c.card,
        controlsColor: c.primary,
        enableBarCollapsing: true,
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch {
      /* ignore malformed links */
    }
  }

  async function shareArticle(a: SavedArticle) {
    try {
      await Share.share({ message: a.link ? `${a.title}\n${a.link}` : a.title });
    } catch {
      /* dismissed */
    }
  }

  function renderJob({ item }: { item: SavedJob }) {
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => openUrl(item.url)}>
        <View style={styles.metaRow}>
          <Text style={styles.source} numberOfLines={1}>{item.source}</Text>
          <TouchableOpacity onPress={() => savedJobs.remove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.starBtn}>
            <Text style={styles.star}>★</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {item.company}{item.location ? ` · ${item.location}` : ''}
        </Text>
        <View style={styles.footer}>
          <Text style={[styles.link, { color: c.primary }]}>Apply on {item.source} ↗</Text>
          {item.salary ? <Text style={styles.badge}>💰 {item.salary}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  }

  function renderArticle({ item }: { item: SavedArticle }) {
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => openUrl(item.link)}>
        <View style={styles.metaRow}>
          <Text style={styles.source} numberOfLines={1}>{item.source}</Text>
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => shareArticle(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.actionIcon}>↗</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => savedArticles.remove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.star}>★</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={3}>{item.title}</Text>
        {item.summary ? <Text style={styles.sub} numberOfLines={2}>{item.summary}</Text> : null}
        <Text style={[styles.link, { color: c.primary }]}>Read on {item.source} ↗</Text>
      </TouchableOpacity>
    );
  }

  const isJobs = tab === 'jobs';
  const empty = isJobs ? savedJobs.items.length === 0 : savedArticles.items.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.tabs}>
        {(['jobs', 'articles'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'jobs' ? `💼 Jobs (${savedJobs.items.length})` : `📰 Articles (${savedArticles.items.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {empty ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>🔖</Text>
          <Text style={styles.centerText}>
            {isJobs
              ? 'No saved jobs yet. Tap the ☆ on any job to keep it here.'
              : 'No saved articles yet. Tap the ☆ on any story to keep it here.'}
          </Text>
        </View>
      ) : isJobs ? (
        <FlatList
          data={savedJobs.items}
          keyExtractor={j => j.id}
          renderItem={renderJob}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={savedArticles.items}
          keyExtractor={a => a.id}
          renderItem={renderArticle}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },

  tabs: { flexDirection: 'row', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder },
  tabActive: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: c.textMuted },
  tabTextActive: { color: c.onColor },

  list: { padding: 12, gap: 10, paddingBottom: 32 },
  card: {
    backgroundColor: c.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  source: { fontSize: 12, fontWeight: '700', color: c.textMuted, flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  actionIcon: { fontSize: 17, fontWeight: '700', color: c.textMuted },
  starBtn: { paddingHorizontal: 2 },
  star: { fontSize: 18, color: c.warning },
  title: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 20 },
  sub: { fontSize: 13, color: c.textMuted, marginTop: 3, lineHeight: 18 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  link: { fontSize: 12, fontWeight: '700', marginTop: 10 },
  badge: { fontSize: 11, fontWeight: '600', color: c.textMuted },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  bigEmoji: { fontSize: 40 },
  centerText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
});
