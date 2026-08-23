import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// ─────────────────────────────────────────────────────────────────────────────
// In-app documentation. Two data sets feed the Guide screen:
//   • CHANGELOG  — "What's New", newest first. Add an entry when a feature ships.
//   • GUIDE      — the living manual: what every feature does, grouped by area.
// Both are plain data so keeping the docs current is just editing this file.
// Dates are ISO 'YYYY-MM-DD' so string comparison = chronological comparison.
// ─────────────────────────────────────────────────────────────────────────────

export interface Release { date: string; title: string; points: string[] }

export const CHANGELOG: Release[] = [
  {
    date: '2026-08-23',
    title: '👀 Watchlist',
    points: [
      'Follow a company or topic once and get alerted on both fronts — fresh news about it and new jobs matching it.',
      'Add terms in More → System → 👀 Watchlist, or tap “Watch” from a Jobs or News search.',
    ],
  },
  {
    date: '2026-08-23',
    title: '🔖 Bookmarks & a sharper job hunt',
    points: [
      'Save any job or news article with the ☆ — find them all under More → Vault → Saved. Share articles straight from the card.',
      'Jobs: mark listings “Applied”, hide ones you’re not interested in, and load more results as you scroll.',
      'Jobs: sort by Newest or Relevance, and a “Posted within” freshness filter.',
    ],
  },
  {
    date: '2026-08-23',
    title: '🔎 Search & filter News & Jobs',
    points: [
      'Jobs: a new Company field — hunt for roles at a specific employer (e.g. Google, TCS), on its own or alongside a role. Saved company searches get alerts too.',
      'Jobs: a Filters sheet with 20 locations worldwide (remote + every Adzuna country), job type (full-time/part-time/contract/internship), experience and minimum salary.',
      'Jobs: role suggestions as you type — tap one to search instantly.',
      'News: a search box that sweeps every feed — look up a company, ticker or topic and see just the matching stories.',
    ],
  },
  {
    date: '2026-08-23',
    title: '🔔 Reliable notifications',
    points: [
      'Job alerts and a news briefing now come from the server, so they arrive even when the app is fully closed.',
      'New job matches are checked hourly; news is a morning & evening digest — a count, not a buzz per headline.',
      'Choose exactly what you get in More → System → 🔔 Alerts.',
    ],
  },
  {
    date: '2026-08-20',
    title: '📈 Stock Check',
    points: [
      'A new tool: type in a stock’s numbers (P/E, ROE, debt…) and get a Strong / Mixed / Weak read on its fundamentals — with a plain-English reason for every metric.',
      'Sector-aware, so a bank’s heavy debt or an IT firm’s high P/E is judged fairly.',
      'Growth Profile + “Priced for growth?” meters — is it growing, and is that growth already in the price? (Describes the company today — never a price forecast.)',
    ],
  },
  {
    date: '2026-08-20',
    title: '🛟 Safety Net & Emergency Mode',
    points: [
      'See your runway — how many months you could cover essentials if your income stopped today.',
      'Editable emergency fund, an essential-vs-optional spending split, a “trim to extend” what-if, and a first-week action plan.',
      'Flip on Emergency Mode in Settings to lead your Home screen with the survival view.',
      'Retired the old Safe-to-Spend card in favour of this.',
    ],
  },
  {
    date: '2026-08-19',
    title: '💼 Job Finder & 🎯 ATS Check',
    points: [
      'Search jobs worldwide — remote or on-site — save searches, and get alerts when new matches are posted.',
      'ATS Check scores your resume against a job description and flags matched/missing keywords — all on your device.',
      'Both are opt-in: turn them on in Settings → Features.',
    ],
  },
  {
    date: '2026-08-19',
    title: '📰 News',
    points: [
      'A News screen with finance, tech and science headlines in plain language, each with a link to the source.',
    ],
  },
  {
    date: '2026-08-18',
    title: '🔥 Habits, refreshed',
    points: [
      'The Home habits card is now an interactive checklist you can tick off directly, with a cleaner design and an accurate daily count.',
    ],
  },
];

export interface GuideItem { icon: string; title: string; what: string; how?: string }
export interface GuideSection { title: string; items: GuideItem[] }

export const GUIDE: GuideSection[] = [
  {
    title: 'Getting around',
    items: [
      { icon: '🏠', title: 'Home', what: 'Your dashboard — this month’s money, today’s habits, net worth, and (when on) your Safety Net.' },
      { icon: '💎', title: 'The “More” menu', what: 'Tap the centre gem in the tab bar for everything else, grouped into Money, Life, Vault and System.' },
    ],
  },
  {
    title: 'Everyday money',
    items: [
      { icon: '💳', title: 'Transactions', what: 'Every debit and credit. Add them by hand or import a statement, then tag each with a category and bank.' },
      { icon: '💵', title: 'Cash in Hand', what: 'Tracks physical cash separately from bank money.', how: 'Use the Add / Spend buttons on the Home cash card.' },
      { icon: '🎯', title: 'Budgets', what: 'Set a monthly cap per category and watch how much is left.' },
      { icon: '🔄', title: 'Recurring', what: 'Log repeating bills, EMIs and subscriptions so they’re expected, not surprises.' },
      { icon: '🏦', title: 'Loans', what: 'Track each loan’s EMI, what you’ve paid and what’s left.' },
      { icon: '🤝', title: 'Settlements', what: 'Money you owe or are owed by other people — settle up without forgetting.' },
    ],
  },
  {
    title: 'Grow & invest',
    items: [
      { icon: '💰', title: 'Savings & Investments', what: 'Track SIPs, stocks, FDs, gold and goals, with current value and gain/loss.' },
      { icon: '📊', title: 'Net worth', what: 'Everything you own, trended over time.' },
      { icon: '📈', title: 'Stock Check', what: 'Enter a stock’s numbers for a Strong/Mixed/Weak read on its fundamentals, plus growth & value meters. Sector-aware, and educational only — not buy/sell advice.', how: 'Grab the figures from a site like Screener.in.' },
    ],
  },
  {
    title: 'Plan & protect',
    items: [
      { icon: '🛟', title: 'Safety Net', what: 'How many months you could cover essentials if income stopped — with ways to stretch it and a first-week plan.', how: 'Set your emergency fund on the screen for an accurate runway.' },
      { icon: '🆘', title: 'Emergency Mode', what: 'A Settings switch that leads your Home with the survival view. Turn it off when you’re back on your feet.' },
      { icon: '📄', title: 'Reports', what: 'Monthly and yearly summaries, your top categories, and a CSV export.' },
      { icon: '📥', title: 'Import', what: 'Turn a PDF or photo of a statement into transactions — parsed on your device, and reviewed before anything is saved.' },
    ],
  },
  {
    title: 'Life',
    items: [
      { icon: '🔥', title: 'Habits', what: 'Build daily habits and keep streaks; tick today’s off straight from Home.' },
      { icon: '📅', title: 'Calendar', what: 'Bills, occasions and reminders on a monthly view.' },
      { icon: '📰', title: 'News', what: 'Finance, tech and science headlines in plain language, with source links.', how: 'Use the search box to sweep every feed for a company, ticker or topic.' },
      { icon: '🔖', title: 'Saved', what: 'Your bookmarked jobs and news articles in one place.', how: 'Tap the ☆ on any job or story to save it here.' },
      { icon: '📝', title: 'Notes', what: 'Quick notes for anything you want to remember.' },
      { icon: '🗂️', title: 'Documents', what: 'A private vault for receipts, statements and important files.' },
    ],
  },
  {
    title: 'Career (opt-in)',
    items: [
      { icon: '💼', title: 'Job Finder', what: 'Search jobs worldwide by role and/or company, filter by location (remote + 19 countries), job type, experience and salary, save searches and get alerts for new matches.', how: 'Turn on in Settings → Features.' },
      { icon: '🎯', title: 'ATS Check', what: 'Score your resume against a job description, offline — see matched/missing keywords and concrete fixes.' },
    ],
  },
  {
    title: 'Your account',
    items: [
      { icon: '👀', title: 'Watchlist', what: 'Follow a company or topic and get alerted on both fronts — fresh news about it and new jobs matching it.', how: 'Add terms in More → System → Watchlist, or tap “Watch” from a Jobs/News search.' },
      { icon: '🔔', title: 'Notifications', what: 'Server-sent alerts that arrive even when the app is closed — hourly job-match alerts and a morning/evening news briefing.', how: 'Pick what you get in More → System → Alerts.' },
      { icon: '⚙️', title: 'Settings', what: 'Theme (light/dark), your money-month start day, and feature toggles for Job Finder and Emergency Mode.' },
      { icon: '🔒', title: 'Privacy', what: 'Your data stays in your account, and the extra tools — Stock Check, Safety Net, ATS — run entirely on your device.' },
    ],
  },
];

// ─── "What's new since I last looked" — on-device, zero-Neon ──────────────────
// Stores the newest changelog date the user has seen. Entries dated after it are
// badged NEW. First-ever open sets the baseline silently (no wall of badges).

const SEEN_KEY = 'velora-guide-seen';

export function useGuideSeen() {
  const qc = useQueryClient();

  const { data: lastSeen = null } = useQuery<string | null>({
    queryKey: ['pref', 'guideSeen'],
    queryFn: async () => (await AsyncStorage.getItem(SEEN_KEY)),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const latestDate = CHANGELOG[0]?.date ?? '';
  const isNew = (date: string) => lastSeen != null && date > lastSeen;
  const unseenCount = lastSeen == null ? 0 : CHANGELOG.filter(r => r.date > lastSeen).length;

  // Call when the Guide is viewed — advances the baseline to the latest release.
  async function markSeen() {
    if (lastSeen === latestDate) return;
    await AsyncStorage.setItem(SEEN_KEY, latestDate);
    qc.setQueryData(['pref', 'guideSeen'], latestDate);
  }

  return { lastSeen, isNew, unseenCount, markSeen };
}
