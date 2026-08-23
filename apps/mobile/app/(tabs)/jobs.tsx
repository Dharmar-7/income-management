import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Keyboard, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { useJobSearches, signatureOf, syncSearchesToServer, type SavedSearch } from '@/lib/jobSearches';
import { useSavedJobs } from '@/lib/bookmarks';
import { useJobStatus } from '@/lib/jobStatus';
import { useWatchlist, syncWatchlistToServer } from '@/lib/watchlist';

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

// Remote (worldwide, via the remote boards) plus every country Adzuna serves for
// on-site listings. Adzuna is country-by-country — there's no single "all
// countries" endpoint — so this list IS the full worldwide on-site coverage.
const WHERE_OPTIONS = [
  { key: 'remote', label: '🌍 Remote' },
  { key: 'in', label: '🇮🇳 India' },
  { key: 'us', label: '🇺🇸 US' },
  { key: 'gb', label: '🇬🇧 UK' },
  { key: 'ca', label: '🇨🇦 Canada' },
  { key: 'au', label: '🇦🇺 Australia' },
  { key: 'sg', label: '🇸🇬 Singapore' },
  { key: 'de', label: '🇩🇪 Germany' },
  { key: 'nl', label: '🇳🇱 Netherlands' },
  { key: 'fr', label: '🇫🇷 France' },
  { key: 'ch', label: '🇨🇭 Switzerland' },
  { key: 'at', label: '🇦🇹 Austria' },
  { key: 'be', label: '🇧🇪 Belgium' },
  { key: 'it', label: '🇮🇹 Italy' },
  { key: 'es', label: '🇪🇸 Spain' },
  { key: 'pl', label: '🇵🇱 Poland' },
  { key: 'nz', label: '🇳🇿 New Zealand' },
  { key: 'br', label: '🇧🇷 Brazil' },
  { key: 'mx', label: '🇲🇽 Mexico' },
  { key: 'za', label: '🇿🇦 South Africa' },
] as const;
type WhereKey = (typeof WHERE_OPTIONS)[number]['key'];

const LEVELS = [
  { key: 'any', label: 'Any' },
  { key: 'junior', label: 'Junior' },
  { key: 'mid', label: 'Mid' },
  { key: 'senior', label: 'Senior' },
] as const;
type LevelKey = (typeof LEVELS)[number]['key'];

const TYPES = [
  { key: 'any', label: 'Any type' },
  { key: 'full_time', label: 'Full-time' },
  { key: 'part_time', label: 'Part-time' },
  { key: 'contract', label: 'Contract' },
  { key: 'internship', label: 'Internship' },
] as const;
type TypeKey = (typeof TYPES)[number]['key'];

const POSTED = [
  { key: 'any', label: 'Any time' },
  { key: '1', label: 'Past 24 hours' },
  { key: '3', label: 'Past 3 days' },
  { key: '7', label: 'Past week' },
] as const;
type PostedKey = (typeof POSTED)[number]['key'];
const POSTED_DAYS: Record<Exclude<PostedKey, 'any'>, number> = { '1': 1, '3': 3, '7': 7 };

const SORTS = [
  { key: 'newest', label: '🕒 Newest' },
  { key: 'relevant', label: '🎯 Relevant' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const MAX_PAGES = 5; // load-more ceiling (Adzuna pages) — keeps requests bounded

const whereLabel = (k: string) => WHERE_OPTIONS.find(o => o.key === k)?.label ?? k;
const levelLabel = (k: string) => LEVELS.find(l => l.key === k)?.label ?? k;
const typeLabel = (k: string) => TYPES.find(t => t.key === k)?.label ?? k;

// A curated catalogue of common roles used to suggest completions as the user
// types. Broad on purpose (software + data + design + product + business +
// finance) so most searches get a helpful hint. Not exhaustive — free text
// still works for anything not listed.
const ROLE_SUGGESTIONS = [
  'Software Engineer', 'Frontend Developer', 'Backend Developer', 'Full Stack Developer',
  'React Developer', 'React Native Developer', 'Node.js Developer', 'Java Developer',
  'Python Developer', '.NET Developer', 'Android Developer', 'iOS Developer',
  'Mobile Developer', 'DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer',
  'Data Engineer', 'Data Scientist', 'Data Analyst', 'Machine Learning Engineer',
  'AI Engineer', 'QA Engineer', 'Automation Test Engineer', 'Software Architect',
  'Engineering Manager', 'Product Manager', 'Project Manager', 'Program Manager',
  'Business Analyst', 'UI/UX Designer', 'Product Designer', 'Graphic Designer',
  'Cybersecurity Analyst', 'Security Engineer', 'Database Administrator', 'Systems Administrator',
  'Network Engineer', 'Technical Writer', 'Scrum Master', 'Solutions Architect',
  'Accountant', 'Financial Analyst', 'Investment Analyst', 'Auditor',
  'Sales Executive', 'Business Development Manager', 'Marketing Manager', 'Digital Marketing Specialist',
  'Content Writer', 'Customer Support', 'HR Manager', 'Recruiter', 'Operations Manager',
] as const;

function suggestRoles(input: string): string[] {
  const q = input.trim().toLowerCase();
  if (q.length < 1) return [];
  // Prefix matches first (more relevant), then any substring hit; drop an exact match.
  const starts = ROLE_SUGGESTIONS.filter(r => r.toLowerCase().startsWith(q));
  const contains = ROLE_SUGGESTIONS.filter(r => !r.toLowerCase().startsWith(q) && r.toLowerCase().includes(q));
  return [...starts, ...contains].filter(r => r.toLowerCase() !== q).slice(0, 6);
}

const SOURCE_COLOR: Record<Job['source'], (c: Theme) => string> = {
  Adzuna: c => c.primary,
  Remotive: c => c.teal,
  RemoteOK: c => c.violet,
  Arbeitnow: c => c.orange,
};

interface SearchParams { what: string; company?: string; where: WhereKey; level: LevelKey; type: TypeKey; salaryMin?: number }

function buildLabel(p: SearchParams): string {
  const company = p.company?.trim();
  const parts = [p.what.trim() || (company ? `@ ${company}` : 'Any role')];
  if (company && p.what.trim()) parts.push(`@ ${company}`);
  parts.push(whereLabel(p.where));
  if (p.level !== 'any') parts.push(levelLabel(p.level));
  if (p.type !== 'any') parts.push(typeLabel(p.type));
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
  const { isSaved: isJobSaved, toggle: toggleJobSaved } = useSavedJobs();
  const { statusOf, setStatus, map: statusMap } = useJobStatus();
  const { has: isWatched, add: addWatch, items: watchItems } = useWatchlist();
  const router = useRouter();
  const qc = useQueryClient();

  const [role, setRole] = useState('');
  const [showRoleSug, setShowRoleSug] = useState(false);
  const [company, setCompany] = useState('');
  const [where, setWhere] = useState<WhereKey>('remote');
  const [level, setLevel] = useState<LevelKey>('any');
  const [type, setType] = useState<TypeKey>('any');
  const [salary, setSalary] = useState('');
  const [postedWithin, setPostedWithin] = useState<PostedKey>('any');
  const [sort, setSort] = useState<SortKey>('newest');
  const [showHidden, setShowHidden] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [submitted, setSubmitted] = useState<SearchParams | null>(null);

  const activeFilterCount =
    (where !== 'remote' ? 1 : 0) + (level !== 'any' ? 1 : 0) + (type !== 'any' ? 1 : 0) +
    (postedWithin !== 'any' ? 1 : 0) + (salary.trim() ? 1 : 0);

  const roleSuggestions = useMemo(() => suggestRoles(role), [role]);

  // "New since last visit" is computed against a snapshot taken WHEN a search is
  // run (not when data arrives), so the NEW markers don't vanish on re-render
  // once we persist the updated "seen" set.
  const prevSeenRef = useRef<Set<string>>(new Set());
  const trackedIdRef = useRef<string | null>(null); // non-null only for saved (tracked) searches
  const markedRef = useRef<string | null>(null);     // guards persisting "seen" once per run

  const query = useInfiniteQuery({
    queryKey: ['jobs', submitted],
    enabled: !!submitted,
    staleTime: 5 * 60_000,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const p = submitted!;
      const qs = new URLSearchParams();
      if (p.what) qs.set('what', p.what);
      if (p.company) qs.set('company', p.company);
      if (p.where === 'remote') qs.set('remote', 'true');
      else qs.set('country', p.where);
      if (p.level !== 'any') qs.set('level', p.level);
      if (p.type !== 'any') qs.set('type', p.type);
      if (p.salaryMin) qs.set('salaryMin', String(p.salaryMin));
      qs.set('sortByDate', 'true');
      if (pageParam > 1) qs.set('page', String(pageParam));
      const token = await getToken();
      return apiFetch<JobsResponse>(`/jobs?${qs.toString()}`, token!);
    },
    getNextPageParam: (lastPage, allPages) => {
      // The remote boards aren't paginated, so "load more" only applies to
      // country (Adzuna) searches. Stop at the cap or when a page comes back empty.
      if (submitted?.where === 'remote') return undefined;
      if (allPages.length >= MAX_PAGES) return undefined;
      return lastPage.jobs.length > 0 ? allPages.length + 1 : undefined;
    },
  });

  // Mirror saved searches to the server so the hourly alert cron can push new
  // matches even when the app is closed. Idempotent; the server keeps its own seen-set.
  useEffect(() => {
    getToken().then(t => { if (t) syncSearchesToServer(searches, t); });
  }, [searches, getToken]);

  // Mirror the watchlist to the server when it changes here (adds from this screen).
  useEffect(() => {
    getToken().then(t => { if (t) syncWatchlistToServer(watchItems, t); });
  }, [watchItems, getToken]);

  // All loaded pages, flattened and de-duped by id (a job can recur across pages).
  const rawJobs = useMemo(() => {
    const all = query.data?.pages.flatMap(p => p.jobs) ?? [];
    const seen = new Set<string>();
    return all.filter(j => (seen.has(j.id) ? false : (seen.add(j.id), true)));
  }, [query.data]);

  const submittedSig = submitted ? signatureOf(submitted) : null;
  const isSaved = !!submittedSig && searches.some(s => s.id === submittedSig);
  const tracked = !!submittedSig && trackedIdRef.current === submittedSig;
  const isNew = (job: Job) => tracked && !prevSeenRef.current.has(job.id);

  // Relevance = how well a listing's title/company matches the searched terms.
  const relScore = useMemo(() => {
    const terms = `${submitted?.what ?? ''} ${submitted?.company ?? ''}`
      .toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    return (j: Job) => {
      if (!terms.length) return 0;
      const title = j.title.toLowerCase();
      const co = j.company.toLowerCase();
      return terms.reduce((n, t) => n + (title.includes(t) ? 2 : 0) + (co.includes(t) ? 1 : 0), 0);
    };
  }, [submitted]);

  const hiddenInResults = rawJobs.filter(j => statusMap[j.id] === 'hidden').length;

  // Apply on-device view controls: hide dismissed, freshness window, and sort.
  const visibleJobs = useMemo(() => {
    let list = showHidden ? rawJobs : rawJobs.filter(j => statusMap[j.id] !== 'hidden');
    if (postedWithin !== 'any') {
      const cutoff = Date.now() - POSTED_DAYS[postedWithin] * 86_400_000;
      list = list.filter(j => {
        const t = j.postedAt ? Date.parse(j.postedAt) : NaN;
        return !Number.isNaN(t) && t >= cutoff;
      });
    }
    if (sort === 'relevant') list = [...list].sort((a, b) => relScore(b) - relScore(a));
    return list;
  }, [rawJobs, statusMap, showHidden, postedWithin, sort, relScore]);

  const newCount = tracked ? visibleJobs.filter(isNew).length : 0;
  const watchTerm = (submitted?.company || submitted?.what || '').trim();

  // Persist the current results as "seen" once per run, so the next visit only
  // flags genuinely new postings. Uses refs for the display snapshot, so this
  // write doesn't disturb the NEW markers on screen.
  useEffect(() => {
    if (!submitted || !rawJobs.length) return;
    const sig = signatureOf(submitted);
    if (trackedIdRef.current !== sig || markedRef.current === sig) return;
    markedRef.current = sig;
    markSeen(sig, rawJobs.map(j => j.id));
  }, [rawJobs, submitted]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setShowRoleSug(false);
    const digits = salary.replace(/[^0-9]/g, '');
    runWith({ what: role.trim(), company: company.trim() || undefined, where, level, type, salaryMin: digits ? Number(digits) : undefined });
  }

  // Tapping a suggestion fills the role and searches straight away.
  function pickRole(r: string) {
    setRole(r);
    setShowRoleSug(false);
    Keyboard.dismiss();
    const digits = salary.replace(/[^0-9]/g, '');
    runWith({ what: r, company: company.trim() || undefined, where, level, type, salaryMin: digits ? Number(digits) : undefined });
  }

  function loadSaved(s: SavedSearch) {
    setRole(s.what);
    setShowRoleSug(false);
    setCompany(s.company ?? '');
    setWhere(s.where as WhereKey);
    setLevel(s.level as LevelKey);
    setType((s.type as TypeKey) ?? 'any');
    setSalary(s.salaryMin ? String(s.salaryMin) : '');
    runWith({ what: s.what, company: s.company, where: s.where as WhereKey, level: s.level as LevelKey, type: (s.type as TypeKey) ?? 'any', salaryMin: s.salaryMin });
  }

  function resetFilters() {
    setWhere('remote');
    setLevel('any');
    setType('any');
    setSalary('');
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
    const resultIds = rawJobs.map(j => j.id);
    add({
      id: submittedSig,
      label: buildLabel(submitted),
      what: submitted.what, company: submitted.company, where: submitted.where, level: submitted.level, type: submitted.type, salaryMin: submitted.salaryMin,
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
    const saved = isJobSaved(item.id);
    const status = statusOf(item.id);
    return (
      <TouchableOpacity style={[styles.card, fresh && styles.cardNew, status === 'hidden' && styles.cardHidden]} activeOpacity={0.7} onPress={() => openJob(item)}>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={styles.source} numberOfLines={1}>{item.source}</Text>
          {when ? <Text style={styles.time}>· {when}</Text> : null}
          {fresh && <View style={styles.newPill}><Text style={styles.newPillText}>🆕 NEW</Text></View>}
          {status === 'applied' && <View style={styles.appliedPill}><Text style={styles.appliedPillText}>✓ APPLIED</Text></View>}
          <TouchableOpacity
            onPress={() => toggleJobSaved({ id: item.id, title: item.title, company: item.company, location: item.location, remote: item.remote, salary: item.salary, type: item.type, source: item.source, url: item.url, description: item.description, postedAt: item.postedAt })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.starBtn}
          >
            <Text style={[styles.star, saved && styles.starOn]}>{saved ? '★' : '☆'}</Text>
          </TouchableOpacity>
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
        <View style={styles.trackRow}>
          <TouchableOpacity onPress={() => setStatus(item.id, 'applied')} style={styles.trackBtn} activeOpacity={0.7}>
            <Text style={[styles.trackBtnText, status === 'applied' && styles.trackBtnTextOn]}>
              {status === 'applied' ? '✓ Applied' : 'Mark applied'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatus(item.id, 'hidden')} style={styles.trackBtn} activeOpacity={0.7}>
            <Text style={styles.trackBtnText}>{status === 'hidden' ? 'Unhide' : '🙈 Hide'}</Text>
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
          onChangeText={t => { setRole(t); setShowRoleSug(true); }}
          onFocus={() => setShowRoleSug(true)}
          returnKeyType="search"
          onSubmitEditing={runSearch}
        />

        {showRoleSug && roleSuggestions.length > 0 && (
          <View style={styles.suggestBox}>
            {roleSuggestions.map((r, i) => (
              <TouchableOpacity
                key={r}
                style={[styles.suggestItem, i < roleSuggestions.length - 1 && styles.suggestDivider]}
                onPress={() => pickRole(r)}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestIcon}>🔎</Text>
                <Text style={styles.suggestText} numberOfLines={1}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Company (optional) — e.g. Google, TCS"
          placeholderTextColor={c.textFaint}
          value={company}
          onChangeText={setCompany}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={runSearch}
        />

        <View style={styles.bottomRow}>
          <TouchableOpacity style={styles.filtersBtn} onPress={() => setFiltersOpen(true)} activeOpacity={0.8}>
            <Text style={styles.filtersBtnText} numberOfLines={1}>
              ⚙️ {whereLabel(where)}{activeFilterCount > 0 ? ` · +${activeFilterCount}` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.searchBtn} onPress={runSearch} activeOpacity={0.85}>
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FiltersModal
        visible={filtersOpen}
        c={c}
        styles={styles}
        where={where} setWhere={setWhere}
        level={level} setLevel={setLevel}
        type={type} setType={setType}
        postedWithin={postedWithin} setPostedWithin={setPostedWithin}
        salary={salary} setSalary={setSalary}
        onReset={resetFilters}
        onApply={() => { setFiltersOpen(false); runSearch(); }}
        onClose={() => setFiltersOpen(false)}
      />

      {/* Results */}
      {!submitted ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>🌍</Text>
          <Text style={styles.centerTitle}>Find your next role</Text>
          <Text style={styles.centerText}>Search by role, by company, or both — remote worldwide or on-site by country. Save a search to track what's new.</Text>
        </View>
      ) : query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
          <Text style={styles.centerText}>Searching across job boards…</Text>
        </View>
      ) : query.isError ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        >
          <Text style={styles.bigEmoji}>😕</Text>
          <Text style={styles.centerText}>Couldn't load jobs. Pull down to try again.</Text>
        </ScrollView>
      ) : visibleJobs.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        >
          <Text style={styles.bigEmoji}>🔍</Text>
          <Text style={styles.centerText}>
            {rawJobs.length > 0
              ? 'Everything here is filtered out. Try widening “Posted within” or unhiding jobs.'
              : 'No matches. Try a broader role, a different place, or clear the salary filter.'}
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={visibleJobs}
          keyExtractor={j => j.id}
          renderItem={renderJob}
          extraData={statusMap}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage(); }}
          ListHeaderComponent={
            <View style={styles.resultsHeaderWrap}>
              <View style={styles.resultsHeader}>
                <Text style={styles.resultCount}>
                  {visibleJobs.length} jobs · {tracked ? (newCount > 0 ? `🆕 ${newCount} new` : 'no new since last visit') : 'shown'}
                </Text>
                {watchTerm ? (
                  <TouchableOpacity onPress={() => addWatch(watchTerm)} activeOpacity={0.8} style={[styles.saveBtn, isWatched(watchTerm) && styles.saveBtnActive]}>
                    <Text style={[styles.saveBtnText, isWatched(watchTerm) && styles.saveBtnTextActive]}>{isWatched(watchTerm) ? '👀 Watching' : '👀 Watch'}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={toggleSave} activeOpacity={0.8} style={[styles.saveBtn, isSaved && styles.saveBtnActive]}>
                  <Text style={[styles.saveBtnText, isSaved && styles.saveBtnTextActive]}>{isSaved ? '★ Saved' : '☆ Save'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.controlsRow}>
                <View style={styles.sortToggle}>
                  {SORTS.map(s => (
                    <TouchableOpacity
                      key={s.key}
                      onPress={() => setSort(s.key)}
                      activeOpacity={0.8}
                      style={[styles.sortBtn, sort === s.key && styles.sortBtnActive]}
                    >
                      <Text style={[styles.sortBtnText, sort === s.key && styles.sortBtnTextActive]}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {hiddenInResults > 0 && (
                  <TouchableOpacity onPress={() => setShowHidden(h => !h)} activeOpacity={0.7}>
                    <Text style={styles.hiddenToggle}>{showHidden ? 'Hide dismissed' : `${hiddenInResults} hidden — show`}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={styles.footerLoad}><ActivityIndicator color={c.primary} /></View>
            ) : query.hasNextPage ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={() => query.fetchNextPage()} activeOpacity={0.85}>
                <Text style={styles.loadMoreText}>Load more</Text>
              </TouchableOpacity>
            ) : null
          }
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={c.primary} />}
        />
      )}
    </SafeAreaView>
  );
}

function FiltersModal({
  visible, c, styles, where, setWhere, level, setLevel, type, setType, postedWithin, setPostedWithin, salary, setSalary, onReset, onApply, onClose,
}: {
  visible: boolean;
  c: Theme;
  styles: ReturnType<typeof makeStyles>;
  where: WhereKey; setWhere: (w: WhereKey) => void;
  level: LevelKey; setLevel: (l: LevelKey) => void;
  type: TypeKey; setType: (t: TypeKey) => void;
  postedWithin: PostedKey; setPostedWithin: (p: PostedKey) => void;
  salary: string; setSalary: (s: string) => void;
  onReset: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        {/* Inner press swallows taps so touching the sheet doesn't dismiss it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={onReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.sheetReset}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
            <Text style={styles.filterLabel}>Location</Text>
            <View style={styles.wrapRow}>
              {WHERE_OPTIONS.map(o => (
                <Chip key={o.key} label={o.label} active={where === o.key} c={c} onPress={() => setWhere(o.key)} />
              ))}
            </View>

            <Text style={styles.filterLabel}>Job type</Text>
            <View style={styles.wrapRow}>
              {TYPES.map(t => (
                <Chip key={t.key} label={t.label} active={type === t.key} c={c} onPress={() => setType(t.key)} />
              ))}
            </View>

            <Text style={styles.filterLabel}>Experience</Text>
            <View style={styles.wrapRow}>
              {LEVELS.map(l => (
                <Chip key={l.key} label={l.label} active={level === l.key} c={c} onPress={() => setLevel(l.key)} />
              ))}
            </View>

            <Text style={styles.filterLabel}>Posted within</Text>
            <View style={styles.wrapRow}>
              {POSTED.map(p => (
                <Chip key={p.key} label={p.label} active={postedWithin === p.key} c={c} onPress={() => setPostedWithin(p.key)} />
              ))}
            </View>

            <Text style={styles.filterLabel}>Minimum salary</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 800000 (optional)"
              placeholderTextColor={c.textFaint}
              value={salary}
              onChangeText={setSalary}
              keyboardType="number-pad"
            />
            <Text style={styles.filterHint}>
              In the selected country's currency. Listings that don't state a salary are still shown.
            </Text>
          </ScrollView>

          <TouchableOpacity style={styles.applyBtn} onPress={onApply} activeOpacity={0.85}>
            <Text style={styles.applyBtnText}>Show results</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
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
  filtersBtn: {
    flex: 1, justifyContent: 'center',
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  filtersBtnText: { fontSize: 13.5, fontWeight: '700', color: c.text },

  suggestBox: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.inputBorder,
    borderRadius: 12, overflow: 'hidden', marginTop: -2,
  },
  suggestItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  suggestDivider: { borderBottomWidth: 1, borderBottomColor: c.cardBorder },
  suggestIcon: { fontSize: 13, opacity: 0.7 },
  suggestText: { fontSize: 13.5, color: c.text, flex: 1 },
  searchBtn: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12 },
  searchBtnText: { color: c.onColor, fontSize: 14, fontWeight: '800' },

  /* filters sheet */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, maxHeight: '85%',
    borderTopWidth: 1, borderColor: c.cardBorder,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.inputBorder, marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  sheetReset: { fontSize: 13, fontWeight: '700', color: c.primary },
  sheetBody: { paddingVertical: 8, gap: 8 },
  filterLabel: { fontSize: 12, fontWeight: '800', color: c.textFaint, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterHint: { fontSize: 11.5, color: c.textFaint, lineHeight: 16, marginTop: 2 },
  applyBtn: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  applyBtnText: { color: c.onColor, fontSize: 15, fontWeight: '800' },

  list: { padding: 12, gap: 10, paddingBottom: 32 },
  resultsHeaderWrap: { marginBottom: 6, gap: 8 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultCount: { fontSize: 11, color: c.textFaint, flex: 1 },
  saveBtn: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  saveBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  saveBtnText: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  saveBtnTextActive: { color: c.onColor },

  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sortToggle: { flexDirection: 'row', backgroundColor: c.chipBg, borderRadius: 99, borderWidth: 1, borderColor: c.chipBorder, padding: 2 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99 },
  sortBtnActive: { backgroundColor: c.primary },
  sortBtnText: { fontSize: 11.5, fontWeight: '700', color: c.textMuted },
  sortBtnTextActive: { color: c.onColor },
  hiddenToggle: { fontSize: 11.5, fontWeight: '700', color: c.primary },

  card: {
    backgroundColor: c.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  cardNew: { borderColor: c.primary },
  cardHidden: { opacity: 0.55 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  source: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  time: { fontSize: 12, color: c.textFaint },
  newPill: { backgroundColor: c.primary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 'auto' },
  newPillText: { fontSize: 10, fontWeight: '800', color: c.onColor },
  appliedPill: { backgroundColor: c.success, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  appliedPillText: { fontSize: 10, fontWeight: '800', color: c.onColor },
  starBtn: { marginLeft: 'auto', paddingHorizontal: 2 },
  star: { fontSize: 18, color: c.textFaint },
  starOn: { color: c.warning },
  title: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 20 },
  company: { fontSize: 13, color: c.textMuted, marginTop: 3 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  apply: { fontSize: 12, fontWeight: '700' },
  desc: { fontSize: 12.5, color: c.textFaint, marginTop: 7, lineHeight: 17 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  fitBtn: { backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5 },
  fitBtnText: { fontSize: 11.5, fontWeight: '700', color: c.primary },
  trackRow: { flexDirection: 'row', gap: 8, marginTop: 10, borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 10 },
  trackBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.chipBorder },
  trackBtnText: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  trackBtnTextOn: { color: c.success },

  footerLoad: { paddingVertical: 18, alignItems: 'center' },
  loadMoreBtn: { marginTop: 6, marginBottom: 8, alignSelf: 'center', borderWidth: 1, borderColor: c.inputBorder, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 9 },
  loadMoreText: { fontSize: 13, fontWeight: '700', color: c.primary },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  bigEmoji: { fontSize: 40 },
  centerTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  centerText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
});
