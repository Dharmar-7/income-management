import { Platform } from 'react-native';
import { getWidgetInfo, requestWidgetUpdate } from 'react-native-android-widget';
import { apiFetch } from '@/lib/api';
import { fetchNews } from '@/lib/newsFeeds';
import { computeSafetyNet, fetchSafetyData, readSafetyPrefs, type SafetyData as RawSafety } from '@/lib/safetyNet';
import { readSavedSearches } from '@/lib/jobSearches';
import { isJobFinderEnabled } from '@/lib/useJobFinder';
import {
  WIDGET_NAMES, SECTION_OF, readSnapshot, writeSnapshot, readHideAmounts,
  type WidgetName, type Section, type WidgetSnapshot,
  type TodayData, type HabitsData, type SafetyData, type BillItem, type JobsData, type NewsData,
} from './snapshot';
import { renderWidget } from './VeloraWidgets';

// ─────────────────────────────────────────────────────────────────────────────
// Keeps the widget snapshot fresh. Runs from the app (signed in), and only
// fetches data for widgets that are actually on the home screen, so having no
// widgets costs nothing. Each section has its own minimum refresh interval.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_AGE_MS: Record<Section, number> = {
  today: 5 * 60_000,
  habits: 5 * 60_000,
  safety: 30 * 60_000,
  bills: 30 * 60_000,
  jobs: 60 * 60_000, // /jobs fans out to several job boards — keep it light
  news: 30 * 60_000,
};

const isAndroid = Platform.OS === 'android';

function localIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function placedWidgets(): Promise<WidgetName[]> {
  const found = await Promise.all(
    WIDGET_NAMES.map(async n => ((await getWidgetInfo(n).catch(() => [])).length > 0 ? n : null)),
  );
  return found.filter((n): n is WidgetName => n !== null);
}

// ─── Section loaders ─────────────────────────────────────────────────────────

interface Overview {
  summary: { totalIncome: number; totalExpenses: number };
  budgets: { data: { amount: number; spent: number }[] };
}

async function loadToday(token: string): Promise<TodayData> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const qs = `type=DEBIT&dateFrom=${encodeURIComponent(start.toISOString())}&dateTo=${encodeURIComponent(end.toISOString())}&limit=100`;
  const [overview, today] = await Promise.all([
    apiFetch<Overview>('/dashboard/overview', token),
    apiFetch<{ data: { amount: number }[] }>(`/transactions?${qs}`, token),
  ]);
  const budgets = overview.budgets?.data ?? [];
  const budgetTotal = budgets.length ? budgets.reduce((s, b) => s + b.amount, 0) : null;
  const budgetSpent = budgets.reduce((s, b) => s + b.spent, 0);
  return {
    todaySpent: today.data.reduce((s, t) => s + t.amount, 0),
    monthSpent: overview.summary.totalExpenses,
    monthIncome: overview.summary.totalIncome,
    budgetTotal,
    budgetLeft: budgetTotal == null ? null : budgetTotal - budgetSpent,
  };
}

interface Board {
  dailyScore: number; dailyDone: number; dailyDue: number;
  habits: { name: string; icon: string; scheduleDays: number[]; today: 'DONE' | 'PARTIAL' | null }[];
}

async function loadHabits(token: string): Promise<HabitsData> {
  const today = localIso();
  const b = await apiFetch<Board>(`/habits?today=${today}`, token);
  const dow = new Date().getDay(); // 0=Sun, same convention as scheduleDays
  return {
    score: b.dailyScore,
    done: b.dailyDone,
    due: b.dailyDue,
    items: b.habits
      .filter(h => h.scheduleDays.includes(dow))
      .map(h => ({ icon: h.icon, name: h.name, status: h.today })),
  };
}

function safetyFrom(raw: RawSafety, prefs: Awaited<ReturnType<typeof readSafetyPrefs>>): SafetyData {
  const m = computeSafetyNet(raw, prefs.fund, prefs.overrides, prefs.trimmed);
  return { hasData: m.hasData, months: m.survivalMonths, fund: m.fund, essentialMonthly: m.essentialMonthly };
}

// Recurring bills + loan EMIs due within the next 7 days (local calendar days).
function billsFrom(raw: RawSafety): BillItem[] {
  const todayMs = Date.parse(localIso() + 'T00:00:00');
  const horizon = todayMs + 7 * 86_400_000;
  const items: BillItem[] = [];

  for (const r of raw.recurring ?? []) {
    if (!r.isActive || r.type === 'CREDIT') continue;
    const due = localIso(new Date(r.nextDueDate));
    const ms = Date.parse(due + 'T00:00:00');
    if (ms >= todayMs && ms <= horizon) items.push({ name: r.name, amount: r.amount, due, kind: 'bill' });
  }

  const now = new Date();
  for (const l of raw.loans ?? []) {
    if (!l.isActive || !l.emiDay) continue;
    let d = new Date(now.getFullYear(), now.getMonth(), l.emiDay);
    if (localIso(d) < localIso(now)) d = new Date(now.getFullYear(), now.getMonth() + 1, l.emiDay);
    const ms = Date.parse(localIso(d) + 'T00:00:00');
    if (ms <= horizon) items.push({ name: l.name, amount: l.emiAmount, due: localIso(d), kind: 'emi' });
  }

  return items.sort((a, b) => a.due.localeCompare(b.due));
}

interface JobsResponse { jobs: { id: string; title: string; company: string }[] }

async function loadJobs(token: string): Promise<JobsData> {
  if (!(await isJobFinderEnabled())) return { state: 'off', newCount: 0, focusId: null, label: null, items: [] };
  const searches = await readSavedSearches();
  if (searches.length === 0) return { state: 'no-searches', newCount: 0, focusId: null, label: null, items: [] };

  // The two most recently created searches, to keep this cheap.
  const picked = [...searches].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2);
  let newCount = 0;
  const items: JobsData['items'] = [];
  let focusId: string | null = null;
  let label: string | null = null;

  for (const s of picked) {
    const qs = new URLSearchParams();
    if (s.what) qs.set('what', s.what);
    if (s.company) qs.set('company', s.company);
    if (s.where === 'remote') qs.set('remote', 'true');
    else qs.set('country', s.where);
    if (s.level && s.level !== 'any') qs.set('level', s.level);
    if (s.type && s.type !== 'any') qs.set('type', s.type);
    if (s.salaryMin) qs.set('salaryMin', String(s.salaryMin));
    qs.set('sortByDate', 'true');
    const res = await apiFetch<JobsResponse>(`/jobs?${qs.toString()}`, token).catch(() => null);
    if (!res) continue;
    const seen = new Set(s.seenJobIds);
    const fresh = res.jobs.filter(j => !seen.has(j.id));
    newCount += fresh.length;
    if (fresh.length && !focusId) { focusId = s.id; label = s.label; }
    for (const j of fresh) if (items.length < 3) items.push({ title: j.title, company: j.company });
  }
  if (!focusId) { focusId = picked[0].id; label = picked[0].label; }
  return { state: 'ok', newCount, focusId, label, items };
}

export async function loadNews(): Promise<NewsData> {
  const items = await fetchNews('top');
  return { items: items.slice(0, 20).map(n => ({ title: n.title, source: n.source, link: n.link })) };
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Re-draw every placed widget from the stored snapshot (no network).
export async function redrawWidgets(names: readonly WidgetName[] = WIDGET_NAMES): Promise<void> {
  if (!isAndroid) return;
  const [snap, hide] = await Promise.all([readSnapshot(), readHideAmounts()]);
  await Promise.all(names.map(n =>
    requestWidgetUpdate({ widgetName: n, renderWidget: () => renderWidget(n, snap, hide) }).catch(() => undefined),
  ));
}

let running = false;

// Fetch fresh data for the widgets on the home screen, save it, and redraw.
// `force` skips the per-section age check for the listed sections.
export async function refreshWidgets(
  getToken: () => Promise<string | null>,
  opts: { force?: Section[] } = {},
): Promise<void> {
  if (!isAndroid || running) return;
  running = true;
  try {
    const placed = await placedWidgets();
    if (placed.length === 0) return;

    const snap: WidgetSnapshot = { ...(await readSnapshot()), signedIn: true };
    const wanted = new Set(placed.map(n => SECTION_OF[n]).filter((s): s is Section => s !== null));
    const now = Date.now();
    const stale = (s: Section) =>
      wanted.has(s) && (opts.force?.includes(s) || !snap[s] || now - snap[s]!.at >= MIN_AGE_MS[s]);

    const token = await getToken();
    if (!token) return;

    const tasks: Promise<void>[] = [];
    if (stale('today')) tasks.push(loadToday(token).then(d => { snap.today = { at: now, data: d }; }));
    if (stale('habits')) tasks.push(loadHabits(token).then(d => { snap.habits = { at: now, data: d }; }));
    if (stale('safety') || stale('bills')) {
      // Safety Net and Bills share the same /loans + /recurring fetch.
      tasks.push(Promise.all([fetchSafetyData(token), readSafetyPrefs()]).then(([raw, prefs]) => {
        if (wanted.has('safety')) snap.safety = { at: now, data: safetyFrom(raw, prefs) };
        if (wanted.has('bills')) snap.bills = { at: now, data: billsFrom(raw) };
      }));
    }
    if (stale('jobs')) tasks.push(loadJobs(token).then(d => { snap.jobs = { at: now, data: d }; }));
    if (stale('news')) tasks.push(loadNews().then(d => { snap.news = { at: now, data: d }; }));

    // One failing section (offline, slow job boards…) mustn't block the others.
    await Promise.allSettled(tasks);
    await writeSnapshot(snap);
    await redrawWidgets(placed);
  } catch {
    // Widgets are best-effort; never surface errors to the app.
  } finally {
    running = false;
  }
}

// On sign-out: drop personal data so widgets don't keep showing it.
export async function clearWidgets(): Promise<void> {
  if (!isAndroid) return;
  const snap = await readSnapshot();
  await writeSnapshot({ signedIn: false, news: snap.news });
  await redrawWidgets();
}
