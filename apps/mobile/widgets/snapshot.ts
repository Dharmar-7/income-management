import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────────────────────────────────────
// Home-screen widget data.
//
// Widgets run outside the app (Android renders them from a headless JS task),
// where there is no signed-in Clerk session to call our API with. So the app
// writes a small snapshot of the numbers each widget shows whenever it's opened,
// and the widgets render from that snapshot. Only News refreshes itself in the
// background, because its RSS feeds need no login.
// ─────────────────────────────────────────────────────────────────────────────

export const WIDGET_NAMES = [
  'VeloraToday', 'VeloraQuickAdd', 'VeloraHabits', 'VeloraSafetyNet',
  'VeloraBills', 'VeloraJobs', 'VeloraNews',
] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

export type Section = 'today' | 'habits' | 'safety' | 'bills' | 'jobs' | 'news';

// Which data section each widget needs (QuickAdd needs none).
export const SECTION_OF: Record<WidgetName, Section | null> = {
  VeloraToday: 'today',
  VeloraQuickAdd: null,
  VeloraHabits: 'habits',
  VeloraSafetyNet: 'safety',
  VeloraBills: 'bills',
  VeloraJobs: 'jobs',
  VeloraNews: 'news',
};

export interface TodayData {
  todaySpent: number;
  monthSpent: number;
  monthIncome: number;
  budgetTotal: number | null; // null → no budgets set this month
  budgetLeft: number | null;
}

export type HabitStatus = 'DONE' | 'PARTIAL' | null;
export interface HabitItem {
  id: string;
  icon: string;
  name: string;
  scheduleDays: number[];   // 0=Sun..6=Sat; the widget filters to today's at draw time
  serverStatus: HabitStatus; // what the server had for `day` when loaded
  status: HabitStatus;       // what the widget shows (server + taps not yet synced)
  streak: number;            // server's current streak, counting serverStatus
}
// All habits in board order, for one local calendar day.
export interface HabitsData {
  day: string; // YYYY-MM-DD
  items: HabitItem[];
}

export interface SafetyData {
  hasData: boolean;
  months: number | null; // runway on essentials
  fund: number;
  essentialMonthly: number;
}

export interface BillItem {
  name: string;
  amount: number;
  due: string; // YYYY-MM-DD (local day)
  kind: 'bill' | 'emi';
}

export interface JobsData {
  state: 'off' | 'no-searches' | 'ok';
  newCount: number;
  focusId: string | null; // saved search to open
  label: string | null;
  items: { title: string; company: string }[];
}

export interface NewsData {
  items: { title: string; source: string; link: string }[];
}

interface Stamped<T> { at: number; data: T }

export interface WidgetSnapshot {
  signedIn: boolean;
  today?: Stamped<TodayData>;
  habits?: Stamped<HabitsData>;
  safety?: Stamped<SafetyData>;
  bills?: Stamped<BillItem[]>;
  jobs?: Stamped<JobsData>;
  news?: Stamped<NewsData>; // "Top"
  // Markets / Tech / Science, fetched only when a Headlines widget shows that tab.
  newsCats?: Partial<Record<NewsCategory, Stamped<NewsData>>>;
}

export type NewsCategory = 'top' | 'markets' | 'tech' | 'science';
export const NEWS_CATEGORIES: { key: NewsCategory; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'markets', label: 'Markets' },
  { key: 'tech', label: 'Tech' },
  { key: 'science', label: 'Science' },
];
export function isNewsCategory(v: unknown): v is NewsCategory {
  return typeof v === 'string' && NEWS_CATEGORIES.some(c => c.key === v);
}

export function newsFor(s: WidgetSnapshot, cat: NewsCategory): Stamped<NewsData> | undefined {
  return cat === 'top' ? s.news : s.newsCats?.[cat];
}

export function withNews(s: WidgetSnapshot, cat: NewsCategory, v: Stamped<NewsData>): WidgetSnapshot {
  return cat === 'top' ? { ...s, news: v } : { ...s, newsCats: { ...s.newsCats, [cat]: v } };
}

const SNAPSHOT_KEY = 'velora-widgets-snapshot';
const HIDE_AMOUNTS_KEY = 'velora-widgets-hide-amounts';
const NEWS_TAB_KEY = 'velora-widgets-news-tab'; // { [widgetId]: NewsCategory }

export async function readSnapshot(): Promise<WidgetSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (raw) return JSON.parse(raw) as WidgetSnapshot;
  } catch { /* corrupt → start fresh */ }
  return { signedIn: false };
}

export async function writeSnapshot(s: WidgetSnapshot): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
}

export async function readHideAmounts(): Promise<boolean> {
  return (await AsyncStorage.getItem(HIDE_AMOUNTS_KEY)) === '1';
}

export async function writeHideAmounts(hide: boolean): Promise<void> {
  await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, hide ? '1' : '0');
}

// Each Headlines widget remembers its own tab, so two widgets can show
// different categories.
export async function readNewsTabs(): Promise<Record<string, NewsCategory>> {
  try {
    const raw = await AsyncStorage.getItem(NEWS_TAB_KEY);
    if (raw) return JSON.parse(raw) as Record<string, NewsCategory>;
  } catch { /* corrupt → all Top */ }
  return {};
}

export async function writeNewsTab(widgetId: number, cat: NewsCategory | null): Promise<void> {
  const tabs = await readNewsTabs();
  if (cat === null || cat === 'top') delete tabs[widgetId];
  else tabs[widgetId] = cat;
  await AsyncStorage.setItem(NEWS_TAB_KEY, JSON.stringify(tabs));
}
