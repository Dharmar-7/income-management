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
    date: '2026-10-05',
    title: '🧠 Velora Brain & 🧭 Investment Coach',
    points: [
      'Velora Brain (More → Money): a private money expert that works on your phone, free, with no AI and nothing sent anywhere.',
      'Ask: type questions like "How much did I spend on food last month?", "Can I afford 50k?" or "What are my subscriptions?" and get answers from your own data.',
      'Insights: this month\'s pace and month-end forecast, what changed vs usual, unusual spends, repeating charges (with price rises), and your savings rate.',
      'Planners: "Can I afford it?", a goal planner with expected returns, and a loan payoff comparison (avalanche vs snowball) showing the interest you\'d save.',
      'Tax: old vs new regime side by side for your income and deductions, with the break-even point.',
      'Investment Coach: rules and maths about investing from your own data, never stock tips or market predictions.',
      'Readiness check: emergency fund, high-interest debt, insurance, then regular investing. It shows which step you\'re on.',
      'Your investment mix vs a target for your age and risk comfort, with rebalancing and too-much-in-one-stock warnings.',
      'Each goal matched to the right kind of investment for its timeline, plus how much to set aside per month.',
      'A money calendar: PPF before the 5th, 80C by 31 March, tax-free gain harvesting, ITR in July, and more, adapted to your tax regime.',
    ],
  },
  {
    date: '2026-10-03',
    title: '🔄 Fresh imports, more job types & countries',
    points: [
      'After you import a statement, Google Pay file, or bank SMS, the Transactions list and dashboard now refresh automatically — no more stale list.',
      'Jobs: two new types to filter by — Freelance and Temporary — for flexible, as-needed work alongside full-time, part-time, contract and internship.',
'Jobs: pick from 80+ countries worldwide (incl. 🇯🇵 Japan, 🇰🇷 Korea, 🇦🇪 UAE) in a new searchable location picker — and select up to 5 at once. Powered by extra job sources beyond the original provider.',
    ],
  },
  {
    date: '2026-09-03',
    title: '✨ Little touches everywhere',
    points: [
      'The app now gives a gentle buzz when you tick a habit, save something, or delete — actions feel confirmed.',
      'A small pop-up (with an Undo) appears when you save, remove or delete, so nothing vanishes silently.',
      'Swipe a saved job, article or application left to remove it — with an Undo if you change your mind.',
      'Lists show soft placeholder cards while loading instead of a blank screen, and re-tapping a tab jumps back to the top.',
      'Jobs remembers your last filters, and a fuller Home greeting greets you by the time of day.',
    ],
  },
  {
    date: '2026-09-02',
    title: '💰 Money alerts, calmer news & a job tracker',
    points: [
      'New alerts: a heads-up before bills & EMIs are due, and a nudge when a budget hits 80% then 100%. Toggle them in More → System → 🔔 Alerts.',
      'Quiet hours: hold job & watchlist pings overnight (10pm–7am) — they arrive in the morning.',
      'News briefing now shows the top headlines (balanced across topics) instead of raw counts.',
      'Job tracker: mark a job Applied, then move it through Interviewing → Offer/Rejected under More → Vault → Saved → Applied.',
    ],
  },
  {
    date: '2026-09-01',
    title: '🔔 Tap-through alerts & job alert setup',
    points: [
      'Tapping a news or job notification now opens the right screen — the matching search or story — instead of just the home page.',
      'Jobs: a new “🌐 All” location that sweeps the major markets worldwide at once.',
      'Set a job alert for any exact filter set (role · company · location · salary · type · experience) — tap “🔔 Alert me” on a search and you’ll be notified when new matches are posted.',
    ],
  },
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
      { icon: '🧭', title: 'Investment Coach', what: 'Investing guidance from rules and maths: are you ready to invest, how your mix compares to a target for your age, which kind of investment suits each goal, and a month-by-month money calendar. Educational, with no predictions or stock tips.', how: 'Set up your money profile (age, risk comfort, tax regime) once. It stays on your phone.' },
      { icon: '📈', title: 'Stock Check', what: 'Enter a stock’s numbers for a Strong/Mixed/Weak read on its fundamentals, plus growth & value meters. Sector-aware, and educational only — not buy/sell advice.', how: 'Grab the figures from a site like Screener.in.' },
    ],
  },
  {
    title: 'Plan & protect',
    items: [
      { icon: '🧠', title: 'Velora Brain', what: 'Your private money expert: ask questions about your money, see insights (pace, unusual spends, repeating charges, savings rate), use planners (afford it? goals, loan payoff) and compare tax regimes. All worked out on your phone from your own data.', how: 'More → Money → Brain. Try "Where did my money go last month?" in the Ask tab.' },
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
      { icon: '🔖', title: 'Saved', what: 'Bookmarked jobs and articles, plus an Applied tab that tracks your job applications through Applied → Interviewing → Offer/Rejected.', how: 'Tap ☆ to save; tap “Mark applied” on a job to track it.' },
      { icon: '📝', title: 'Notes', what: 'Quick notes for anything you want to remember.' },
      { icon: '🗂️', title: 'Documents', what: 'A private vault for receipts, statements and important files.' },
    ],
  },
  {
    title: 'Career (opt-in)',
    items: [
      { icon: '💼', title: 'Job Finder', what: 'Search jobs worldwide by role and/or company, filter by location (remote, or pick up to 5 of 80+ countries including Japan, Korea & the UAE), job type (full-time, part-time, contract, freelance, temporary, internship), experience and salary, save searches and get alerts for new matches.', how: 'Turn on in Settings → Features. Remote covers the whole world; on-site pulls from multiple job sources per country.' },
      { icon: '🎯', title: 'ATS Check', what: 'Score your resume against a job description, offline — see matched/missing keywords and concrete fixes.' },
    ],
  },
  {
    title: 'Your account',
    items: [
      { icon: '👀', title: 'Watchlist', what: 'Follow a company or topic and get alerted on both fronts — fresh news about it and new jobs matching it.', how: 'Add terms in More → System → Watchlist, or tap “Watch” from a Jobs/News search.' },
      { icon: '🔔', title: 'Notifications', what: 'Server-sent alerts that arrive even when the app is closed — job matches, a news briefing, bill/EMI reminders, budget warnings, and quiet hours.', how: 'Pick what you get in More → System → Alerts.' },
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
