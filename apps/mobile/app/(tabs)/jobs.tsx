import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useJobSearches, signatureOf, type SavedSearch } from '@/lib/jobSearches';

// Mirror of the backend Job shape (see backend/api/src/jobs/jobs.util.ts).
interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salary: string | null;
  type: string | null;
  category: string | null;
  description: string | null;
  source: 'Adzuna' | 'Remotive' | 'RemoteOK' | 'Arbeitnow';
  url: string;
  postedAt: string | null;
}
interface JobsResponse { jobs: Job[]; count: number; sources: string[] }

const WHERE_OPTIONS = [
  { key: 'remote', label: '🌍 Remote' },
  { key: 'in', label: '🇮🇳 India' },
  { key: 'us', label: '🇺🇸 US' },
  { key: 'gb', label: '🇬🇧 UK' },
  { key: 'au', label: '🇦🇺 Australia' },
  { key: 'ca', label: '🇨🇦 Canada' },
  { key: 'de', label: '🇩🇪 Germany' },
] as const;
type WhereKey = (typeof WHERE_OPTIONS)[number]['key'];

const LEVELS = [
  { key: 'any', label: 'Any' },
  { key: 'junior', label: 'Junior' },
  { key: 'mid', label: 'Mid' },
  { key: 'senior', label: 'Senior' },
] as const;
type LevelKey = (typeof LEVELS)[number]['key'];

const whereLabel = (k: string) => WHERE_OPTIONS.find(o => o.key === k)?.label ?? k;
const levelLabel = (k: string) => LEVELS.find(l => l.key === k)?.label ?? k;

const SOURCE_COLOR: Record<Job['source'], (c: Theme) => string> = {
  Adzuna: c => c.primary,
  Remotive: c => c.teal,
  RemoteOK: c => c.violet,
  Arbeitnow: c => c.orange,
};

interface SearchParams { what: string; where: WhereKey; level: LevelKey; salaryMin?: number }

function buildLabel(p: SearchParams): string {
  const parts = [p.what.trim() || 'Any role', whereLabel(p.where)];
  if (p.level !== 'any') parts.push(levelLabel(p.level));
  if (p.salaryMin) parts.push(`≥${p.salaryMin}`);
  return parts.join(' · ');
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function JobsScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();
  const { searches, add, remove, markSeen } = useJobSearches();
  const router = useRouter();
  const qc = useQueryClient();

  const [role, setRole] = useState('');
  const [where, setWhere] = useState<WhereKey>('remote');
  const [level, setLevel] = useState<LevelKey>('any');
  const [salary, setSalary] = useState('');
  const [submitted, setSubmitted] = useState<SearchParams | null>(null);

  // "New since last visit" is computed against a snapshot taken WHEN a search is
  // run (not when data arrives), so the NEW markers don't vanish on re-render
  // once we persist the updated "seen" set.
  const prevSeenRef = useRef<Set<string>>(new Set());
  const trackedIdRef = useRef<string | null>(null); // non-null only for saved (tracked) searches
  const markedRef = useRef<string | null>(null);     // guards persisting "seen" once per run

  const query = useQuery({
    queryKey: ['jobs', submitted],
    enabled: !!submitted,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const p = submitted!;
      const qs = new URLSearchParams();
      if (p.what) qs.set('what', p.what);
      if (p.where === 'remote') qs.set('remote', 'true');
      else qs.set('country', p.where);
      if (p.level !== 'any') qs.set('level', p.level);
      if (p.salaryMin) qs.set('salaryMin', String(p.salaryMin));
      qs.set('sortByDate', 'true');
      const token = await getToken();
      return apiFetch<JobsResponse>(`/jobs?${qs.toString()}`, token!);
    },
  });

  const jobs = query.data?.jobs ?? [];
  const submittedSig = submitted ? signatureOf(submitted) : null;
  const isSaved = !!submittedSig && searches.some(s => s.id === submittedSig);
  const tracked = !!submittedSig && trackedIdRef.current === submittedSig;
  const isNew = (job: Job) => tracked && !prevSeenRef.current.has(job.id);
  const newCount = tracked ? jobs.filter(isNew).length : 0;

  // Persist the current results as "seen" once per run, so the next visit only
  // flags genuinely new postings. Uses refs for the display snapshot, so this
  // write doesn't disturb the NEW markers on screen.
  useEffect(() => {
    if (!submitted || !query.data) return;
    const sig = signatureOf(submitted);
    if (trackedIdRef.current !== sig || markedRef.current === sig) return;
    markedRef.current = sig;
    markSeen(sig, query.data.jobs.map(j => j.id));
  }, [query.data, submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  function runWith(params: SearchParams) {
    Keyboard.dismiss();
    const sig = signatureOf(params);
    const saved = searches.find(s => s.id === sig) ?? null;
    trackedIdRef.current = saved ? sig : null;
    prevSeenRef.current = new Set(saved?.seenJobIds ?? []);
    markedRef.current = null;
    setSubmitted(params);
  }

  function runSearch() {
    const digits = salary.replace(/[^0-9]/g, '');
    runWith({ what: role.trim(), where, level, salaryMin: digits ? Number(digits) : undefined });
  }

  function loadSaved(s: SavedSearch) {
    setRole(s.what);
    setWhere(s.where as WhereKey);
    setLevel(s.level as LevelKey);
    setSalary(s.salaryMin ? String(s.salaryMin) : '');
    runWith({ what: s.what, where: s.where as WhereKey, level: s.level as LevelKey, salaryMin: s.salaryMin });
  }

  function toggleSave() {
    if (!submitted || !submittedSig) return;
    if (isSaved) {
      remove(submittedSig);
      if (trackedIdRef.current === submittedSig) trackedIdRef.current = null;
      return;
    }
    // Seed "seen" with the current results so tracking starts from now (nothing
    // shown right now counts as "new" the next time you open it).
    const resultIds = jobs.map(j => j.id);
    add({
      id: submittedSig,
      label: buildLabel(submitted),
      what: submitted.what, where: submitted.where, level: submitted.level, salaryMin: submitted.salaryMin,
      seenJobIds: resultIds,
      createdAt: Date.now(),
      lastRunAt: Date.now(),
    });
    trackedIdRef.current = submittedSig;
    prevSeenRef.current = new Set(resultIds);
    markedRef.current = submittedSig;
  }

  async function openJob(job: Job) {
    if (!job.url) return;
    try {
      await WebBrowser.openBrowserAsync(job.url, {
        toolbarColor: c.card,
        controlsColor: c.primary,
        enableBarCollapsing: true,
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch {
      /* ignore malformed links */
    }
  }

  // Hand this job's description to the ATS screen and jump there.
  function checkFit(job: Job) {
    qc.setQueryData(['atsPrefill'], { jobTitle: job.title, jobDescription: job.description ?? '' });
    router.push('/(tabs)/ats');
  }

  function renderJob({ item }: { item: Job }) {
    const dot = SOURCE_COLOR[item.source](c);
    const when = relativeTime(item.postedAt);
    const fresh = isNew(item);
    return (
      <TouchableOpacity style={[styles.card, fresh && styles.cardNew]} activeOpacity={0.7} onPress={() => openJob(item)}>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={styles.source} numberOfLines={1}>{item.source}</Text>
          {when ? <Text style={styles.time}>· {when}</Text> : null}
          {fresh && <View style={styles.newPill}><Text style={styles.newPillText}>🆕 NEW</Text></View>}
        </View>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.company} numberOfLines={1}>
          {item.company}{item.location ? ` · ${item.location}` : ''}
        </Text>
        {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
        <View style={styles.badges}>
          {item.remote && <Badge label="🌍 Remote" c={c} />}
          {item.salary && <Badge label={`💰 ${item.salary}`} c={c} />}
          {item.type && <Badge label={item.type.replace(/_/g, ' ')} c={c} />}
        </View>
        <View style={styles.cardFooter}>
          <Text style={[styles.apply, { color: dot }]}>Apply on {item.source} ↗</Text>
          <TouchableOpacity onPress={() => checkFit(item)} style={styles.fitBtn} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.fitBtnText}>🎯 Check my fit</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Saved searches — quick access to recurring hunts */}
      {searches.length > 0 && (
        <View style={styles.savedBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {searches.map(s => (
              <View key={s.id} style={[styles.savedChip, submittedSig === s.id && styles.savedChipActive]}>
                <TouchableOpacity onPress={() => loadSaved(s)} activeOpacity={0.7} style={styles.savedChipMain}>
                  <Text style={styles.savedChipText} numberOfLines={1}>⭐ {s.label}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(s.id)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }} style={styles.savedChipX}>
                  <Text style={styles.savedChipXText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filters */}
      <View style={styles.filters}>
        <TextInput
          style={styles.input}
          placeholder="Role or keyword — e.g. React Developer"
          placeholderTextColor={c.textFaint}
          value={role}
          onChangeText={setRole}
          returnKeyType="search"
          onSubmitEditing={runSearch}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {WHERE_OPTIONS.map(o => (
            <Chip key={o.key} label={o.label} active={where === o.key} c={c} onPress={() => setWhere(o.key)} />
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {LEVELS.map(l => (
            <Chip key={l.key} label={l.label} active={level === l.key} c={c} onPress={() => setLevel(l.key)} small />
          ))}
        </ScrollView>

        <View style={styles.bottomRow}>
          <TextInput
            style={[styles.input, styles.salaryInput]}
            placeholder="Min salary (optional)"
            placeholderTextColor={c.textFaint}
            value={salary}
            onChangeText={setSalary}
            keyboardType="number-pad"
            returnKeyType="search"
            onSubmitEditing={runSearch}
          />
          <TouchableOpacity style={styles.searchBtn} onPress={runSearch} activeOpacity={0.85}>
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Results */}
      {!submitted ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>🌍</Text>
          <Text style={styles.centerTitle}>Find your next role</Text>
          <Text style={styles.centerText}>Enter a role, pick where, and hit Search — remote worldwide or on-site by country. Save a search to track what's new.</Text>
        </View>
      ) : query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
          <Text style={styles.centerText}>Searching across job boards…</Text>
        </View>
      ) : query.isError ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        >
          <Text style={styles.bigEmoji}>😕</Text>
          <Text style={styles.centerText}>Couldn't load jobs. Pull down to try again.</Text>
        </ScrollView>
      ) : jobs.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        >
          <Text style={styles.bigEmoji}>🔍</Text>
          <Text style={styles.centerText}>No matches. Try a broader role, a different place, or clear the salary filter.</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={j => j.id}
          renderItem={renderJob}
          extraData={submitted}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <Text style={styles.resultCount}>
                {jobs.length} jobs · {tracked ? (newCount > 0 ? `🆕 ${newCount} new since last visit` : 'no new since last visit') : 'newest first'}
              </Text>
              <TouchableOpacity onPress={toggleSave} activeOpacity={0.8} style={[styles.saveBtn, isSaved && styles.saveBtnActive]}>
                <Text style={[styles.saveBtnText, isSaved && styles.saveBtnTextActive]}>{isSaved ? '★ Saved' : '☆ Save'}</Text>
              </TouchableOpacity>
            </View>
          }
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        />
      )}
    </SafeAreaView>
  );
}

function Chip({ label, active, c, onPress, small }: { label: string; active: boolean; c: Theme; onPress: () => void; small?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        paddingHorizontal: small ? 12 : 14,
        paddingVertical: small ? 6 : 8,
        borderRadius: 99,
        borderWidth: 1,
        backgroundColor: active ? c.primary : c.chipBg,
        borderColor: active ? c.primary : c.chipBorder,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: active ? c.onColor : c.textMuted }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Badge({ label, c }: { label: string; c: Theme }) {
  return (
    <View style={{ backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: c.textMuted }}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },

  savedBar: { paddingTop: 10, paddingBottom: 4, backgroundColor: c.bg },
  savedChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder,
    borderRadius: 99, paddingLeft: 12, paddingRight: 4, maxWidth: 260,
  },
  savedChipActive: { borderColor: c.primary },
  savedChipMain: { paddingVertical: 7, flexShrink: 1 },
  savedChipText: { fontSize: 12.5, fontWeight: '700', color: c.text },
  savedChipX: { paddingHorizontal: 6, paddingVertical: 6 },
  savedChipXText: { fontSize: 12, fontWeight: '700', color: c.textFaint },

  filters: {
    padding: 12, gap: 10,
    borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.bg,
  },
  input: {
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: c.text,
  },
  chipRow: { gap: 8, paddingRight: 8 },
  bottomRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  salaryInput: { flex: 1, paddingVertical: 10 },
  searchBtn: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12 },
  searchBtnText: { color: c.onColor, fontSize: 14, fontWeight: '800' },

  list: { padding: 12, gap: 10, paddingBottom: 32 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  resultCount: { fontSize: 11, color: c.textFaint, flex: 1 },
  saveBtn: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  saveBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  saveBtnText: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  saveBtnTextActive: { color: c.onColor },

  card: {
    backgroundColor: c.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  cardNew: { borderColor: c.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  source: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  time: { fontSize: 12, color: c.textFaint },
  newPill: { backgroundColor: c.primary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 'auto' },
  newPillText: { fontSize: 10, fontWeight: '800', color: c.onColor },
  title: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 20 },
  company: { fontSize: 13, color: c.textMuted, marginTop: 3 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  apply: { fontSize: 12, fontWeight: '700' },
  desc: { fontSize: 12.5, color: c.textFaint, marginTop: 7, lineHeight: 17 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  fitBtn: { backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5 },
  fitBtnText: { fontSize: 11.5, fontWeight: '700', color: c.primary },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  bigEmoji: { fontSize: 40 },
  centerTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  centerText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
});
