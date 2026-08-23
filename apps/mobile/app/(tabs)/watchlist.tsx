import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useWatchlist, syncWatchlistToServer, type WatchItem } from '@/lib/watchlist';

export default function WatchlistScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const router = useRouter();
  const { items, add, remove } = useWatchlist();
  const [term, setTerm] = useState('');

  // Mirror to the server so the news + jobs crons can alert even when closed.
  useEffect(() => {
    getToken().then(t => { if (t) syncWatchlistToServer(items, t); });
  }, [items, getToken]);

  async function onAdd() {
    const ok = await add(term);
    if (ok) setTerm('');
    Keyboard.dismiss();
  }

  function renderItem({ item }: { item: WatchItem }) {
    return (
      <View style={styles.card}>
        <Text style={styles.term} numberOfLines={1}>👀 {item.term}</Text>
        <View style={styles.rowActions}>
          <TouchableOpacity onPress={() => router.push('/(tabs)/jobs')} style={styles.miniBtn} activeOpacity={0.7}>
            <Text style={styles.miniBtnText}>💼 Jobs</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(tabs)/news')} style={styles.miniBtn} activeOpacity={0.7}>
            <Text style={styles.miniBtnText}>📰 News</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => remove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.removeBtn}>
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.addBar}>
        <TextInput
          style={styles.input}
          placeholder="Watch a company or topic — e.g. Google, EV stocks"
          placeholderTextColor={c.textFaint}
          value={term}
          onChangeText={setTerm}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={onAdd}
        />
        <TouchableOpacity style={styles.addBtn} onPress={onAdd} activeOpacity={0.85}>
          <Text style={styles.addBtnText}>Watch</Text>
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>👀</Text>
          <Text style={styles.centerTitle}>Follow what matters</Text>
          <Text style={styles.centerText}>
            Add a company or topic and Velora will alert you when there's fresh news about it — and when new
            jobs matching it are posted. One list, both channels.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={w => w.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            <Text style={styles.note}>
              News is checked morning &amp; evening; jobs hourly. Alerts arrive even when the app is closed —
              turn on notifications in More → System → 🔔 Alerts and keep Velora exempt from battery
              optimization. Requires the latest app build.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },

  addBar: { flexDirection: 'row', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
  input: {
    flex: 1, backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: c.text,
  },
  addBtn: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 20, justifyContent: 'center' },
  addBtnText: { color: c.onColor, fontSize: 14, fontWeight: '800' },

  list: { padding: 12, gap: 10, paddingBottom: 32 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.cardBorder,
  },
  term: { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniBtn: { backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  miniBtnText: { fontSize: 11.5, fontWeight: '700', color: c.primary },
  removeBtn: { paddingHorizontal: 4 },
  removeText: { fontSize: 14, fontWeight: '700', color: c.textFaint },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  bigEmoji: { fontSize: 40 },
  centerTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  centerText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
  note: { fontSize: 11.5, color: c.textFaint, lineHeight: 16, fontStyle: 'italic', marginTop: 8, paddingHorizontal: 4 },
});
