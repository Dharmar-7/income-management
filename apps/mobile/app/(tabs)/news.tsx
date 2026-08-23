import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import {
  CATEGORIES,
  SOURCE_CATEGORY,
  fetchNews,
  fetchNewsPool,
  matchesNewsQuery,
  type CategoryKey,
  type NewsItem,
} from '@/lib/newsFeeds';
import { useSavedArticles } from '@/lib/bookmarks';
import { useWatchlist, syncWatchlistToServer } from '@/lib/watchlist';
import { useAuth } from '@clerk/clerk-expo';

// Each world gets a colour so a source's dot hints where it came from — handy in
// the mixed "Top" tab.
const ACCENT: Record<CategoryKey, (c: Theme) => string> = {
  top: c => c.orange,
  markets: c => c.teal,
  tech: c => c.primary,
  science: c => c.violet,
};

function accentFor(source: string, selected: CategoryKey, c: Theme): string {
  const cat = SOURCE_CATEGORY[source] ?? selected;
  return ACCENT[cat](c);
}

// "5m ago" / "3h ago" / "2d ago", then a short date. new Date() is fine here —
// this is app code, and IST-local formatting is what the user expects.
function relativeTime(ms: number | null): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NewsScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const { isSaved, toggle: toggleSaved } = useSavedArticles();
  const { has: isWatched, add: addWatch, items: watchItems } = useWatchlist();
  const [category, setCategory] = useState<CategoryKey>('top');
  const [search, setSearch] = useState('');
  const searchTerm = search.trim();
  const searching = searchTerm.length > 0;

  const query = useQuery({
    queryKey: ['news', category],
    queryFn: () => fetchNews(category),
    // Headlines don't need to be second-fresh; 5 min matches the app default and
    // keeps needless refetches (and mobile data use) down. Cached data is shown
    // instantly meanwhile.
    staleTime: 5 * 60_000,
    enabled: !searching,
  });

  // A broad cross-feed pool, fetched only once the user searches, then filtered
  // instantly on-device as they type (no refetch per keystroke).
  const poolQuery = useQuery({
    queryKey: ['news', 'pool'],
    queryFn: fetchNewsPool,
    staleTime: 5 * 60_000,
    enabled: searching,
  });

  const active = searching ? poolQuery : query;
  const items = useMemo(() => {
    if (!searching) return query.data ?? [];
    return (poolQuery.data ?? []).filter(i => matchesNewsQuery(i, searchTerm));
  }, [searching, searchTerm, query.data, poolQuery.data]);

  // Mirror the watchlist to the server when it changes here (adds from this screen).
  useEffect(() => {
    getToken().then(t => { if (t) syncWatchlistToServer(watchItems, t); });
  }, [watchItems, getToken]);

  async function openArticle(item: NewsItem) {
    if (!item.link) return;
    try {
      await WebBrowser.openBrowserAsync(item.link, {
        toolbarColor: c.card,
        controlsColor: c.primary,
        enableBarCollapsing: true,
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch {
      // A malformed link shouldn't crash the screen.
    }
  }

  async function shareArticle(item: NewsItem) {
    try {
      await Share.share({ message: item.link ? `${item.title}\n${item.link}` : item.title });
    } catch {
      // User dismissed the share sheet, or it's unavailable — nothing to do.
    }
  }

  function renderCard({ item }: { item: NewsItem }) {
    const dot = accentFor(item.source, category, c);
    const when = relativeTime(item.published);
    const saved = isSaved(item.id);
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => openArticle(item)}>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={styles.source} numberOfLines={1}>{item.source}</Text>
          {when ? <Text style={styles.time}>· {when}</Text> : null}
        </View>
        <Text style={styles.title} numberOfLines={3}>{item.title}</Text>
        {item.summary ? (
          <Text style={styles.summary} numberOfLines={3}>{item.summary}</Text>
        ) : null}
        <View style={styles.cardFooter}>
          <Text style={[styles.readMore, { color: dot }]} numberOfLines={1}>Read on {item.source} ↗</Text>
          <View style={styles.cardActions}>
            <TouchableOpacity
              onPress={() => toggleSaved({ id: item.id, title: item.title, summary: item.summary, link: item.link, source: item.source, published: item.published })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.actionIcon, saved && styles.actionIconOn]}>{saved ? '★' : '☆'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => shareArticle(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.actionIcon}>↗</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Search + category pills — fixed above the list so they stay reachable
          while scrolling. Searching sweeps every feed; the pills browse by world. */}
      <View style={styles.chipsBar}>
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search news — a company, ticker, topic…"
            placeholderTextColor={c.textFaint}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searching && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {!searching && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {CATEGORIES.map(cat => {
              const on = cat.key === category;
              const accent = ACCENT[cat.key](c);
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[
                    styles.chip,
                    on
                      ? { backgroundColor: accent, borderColor: accent }
                      : { backgroundColor: c.chipBg, borderColor: c.chipBorder },
                  ]}
                  onPress={() => setCategory(cat.key)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.chipEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.chipText, { color: on ? c.onColor : c.textMuted }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        <View style={styles.hintRow}>
          <Text style={styles.hint} numberOfLines={1}>
            {searching
              ? `Searching all feeds for “${searchTerm}”`
              : 'Live headlines · tap any story to read the full article'}
          </Text>
          {searching && (
            <TouchableOpacity
              onPress={() => addWatch(searchTerm)}
              activeOpacity={0.8}
              style={[styles.watchBtn, isWatched(searchTerm) && styles.watchBtnOn]}
            >
              <Text style={[styles.watchBtnText, isWatched(searchTerm) && styles.watchBtnTextOn]}>
                {isWatched(searchTerm) ? '👀 Watching' : '👀 Watch'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {active.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
          <Text style={styles.centerText}>{searching ? 'Searching the news…' : 'Fetching the latest…'}</Text>
        </View>
      ) : items.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={active.isFetching} onRefresh={() => active.refetch()} tintColor={c.primary} />}
        >
          <Text style={styles.emptyEmoji}>{searching ? '🔍' : '📰'}</Text>
          <Text style={styles.centerText}>
            {active.isError
              ? (active.error as Error)?.message ?? 'Couldn’t load the news.'
              : searching
                ? `No stories match “${searchTerm}”. Try a different word.`
                : 'No stories right now.'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => active.refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={active.isFetching} onRefresh={() => active.refetch()} tintColor={c.primary} />}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },

  chipsBar: {
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
    backgroundColor: c.bg,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.inputBorder,
    backgroundColor: c.inputBg,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: c.text },
  searchClear: { fontSize: 13, fontWeight: '700', color: c.textFaint, paddingHorizontal: 2 },

  chipsRow: { paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
  },
  chipEmoji: { fontSize: 13 },
  chipText: { fontSize: 13, fontWeight: '700' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 8 },
  hint: { fontSize: 11, color: c.textFaint, flex: 1 },
  watchBtn: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  watchBtnOn: { backgroundColor: c.primary, borderColor: c.primary },
  watchBtnText: { fontSize: 11.5, fontWeight: '700', color: c.textMuted },
  watchBtnTextOn: { color: c.onColor },

  list: { padding: 16, gap: 10, paddingBottom: 32 },

  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: c.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  source: { fontSize: 12, fontWeight: '700', color: c.textMuted, maxWidth: '60%' },
  time: { fontSize: 12, color: c.textFaint },
  title: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 21 },
  summary: { fontSize: 13, color: c.textMuted, lineHeight: 19, marginTop: 5 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  readMore: { fontSize: 12, fontWeight: '700', flex: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  actionIcon: { fontSize: 17, fontWeight: '700', color: c.textMuted },
  actionIconOn: { color: c.warning },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerText: { fontSize: 14, color: c.textMuted, textAlign: 'center' },
  emptyEmoji: { fontSize: 40 },
  retryBtn: {
    backgroundColor: c.primary,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 11,
    marginTop: 4,
  },
  retryText: { color: c.onColor, fontSize: 14, fontWeight: '700' },
});
