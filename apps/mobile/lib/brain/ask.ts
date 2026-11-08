// Velora Brain — the ask box. A rule-based question answerer (no AI model):
// it parses a period ("last month", "in August", "last 3 months"), an amount
// ("50k", "1.5 lakh"), a category (incl. everyday words like "petrol") and a
// merchant (any name in your own history), picks an intent, and answers from
// your data with the same functions the Insights/Planners tabs use.
//
// Honest limits, surfaced in the UI: it understands common money questions,
// not open conversation. Unknown questions get suggestions, never a guess.

import {
  type Tx, type Category, type Period,
  MONTH_NAMES, DAY_MS, monthPeriod, monthsAgo, inRange, spendOf, incomeOf, normMerchant, inr, shortDate, hasData,
} from './core';
import { categoryTotals, topMerchants, unusualSpends, repeatCharges, monthPace, savingsRate } from './insights';
import { canAfford, cashflowBasics } from './planners';

export interface AskContext {
  now: Date;
  txs: Tx[];
  categories: Category[];
  historyFrom: Date | null;
  budgets: { name: string; icon: string; amount: number; spent: number; percentUsed: number }[];
  netWorth: number | null;
  survivalMonths: number | null;
  emergencyFund: number;
  essentialMonthly: number;
  loans: { name: string; outstandingBalance: number; emiAmount: number; interestRate: number; isActive: boolean }[];
}

export interface AskAnswer {
  intent: string;
  title: string;
  lines: string[];
  items?: { label: string; value: string }[];
  action?: { label: string; route: string };
  suggestions?: string[];
}

export const SAMPLE_QUESTIONS = [
  'How much did I spend this month?',
  'How much did I spend on food last month?',
  'Where did my money go last month?',
  'Can I afford 50k?',
  'What are my subscriptions?',
  'Any unusual spends?',
  'How much did I save last month?',
  'Will I overspend this month?',
  'How long can I survive without income?',
  'How much do I owe on loans?',
];

// ─── Parsing ─────────────────────────────────────────────────────────────────

const MONTH_ALIASES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

export function parsePeriod(q: string, now: Date): Period | null {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);

  if (/\btoday\b/.test(q)) return { from: today, to: tomorrow, label: 'today' };
  if (/\byesterday\b/.test(q)) return { from: new Date(today.getTime() - DAY_MS), to: today, label: 'yesterday' };

  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY_MS);
  if (/\bthis week\b/.test(q)) return { from: monday, to: tomorrow, label: 'this week' };
  if (/\blast week\b|\bprevious week\b/.test(q)) return { from: new Date(monday.getTime() - 7 * DAY_MS), to: monday, label: 'last week' };

  const lastN = q.match(/\b(?:last|past|previous)\s+(\d{1,2})\s+(day|days|week|weeks|month|months)\b/);
  if (lastN) {
    const n = Number(lastN[1]);
    const unit = lastN[2];
    if (unit.startsWith('day')) return { from: new Date(tomorrow.getTime() - n * DAY_MS), to: tomorrow, label: `the last ${n} days` };
    if (unit.startsWith('week')) return { from: new Date(tomorrow.getTime() - n * 7 * DAY_MS), to: tomorrow, label: `the last ${n} weeks` };
    // "last 3 months" = the 3 complete months before this one
    return { from: monthsAgo(now, n).from, to: monthsAgo(now, 0).from, label: `the last ${n} months` };
  }

  if (/\bthis month\b|\bso far\b/.test(q)) return { ...monthsAgo(now, 0), label: 'this month' };
  if (/\blast month\b|\bprevious month\b|\bprev month\b/.test(q)) return monthsAgo(now, 1);
  if (/\bthis year\b/.test(q)) return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1), label: `${now.getFullYear()}` };
  if (/\blast year\b/.test(q)) return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear(), 0, 1), label: `${now.getFullYear() - 1}` };

  // A named month, optionally with a year ("in august", "march 2026").
  const m = q.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/);
  // "may" is usually the verb ("may I…") — only treat it as May with a cue word or a year.
  const isVerbMay = m && m[1] === 'may' && !m[2] && !/\b(in|during|for|of|since|last|this)\s+may\b/.test(q);
  if (m && !isVerbMay) {
    const month0 = MONTH_ALIASES[m[1]];
    let year = m[2] ? Number(m[2]) : now.getFullYear();
    if (!m[2] && month0 > now.getMonth()) year -= 1; // "in november" asked in October → last November
    return monthPeriod(year, month0);
  }

  // A bare year ("in 2024") → that calendar year.
  const y = q.match(/\b((?:19|20)\d{2})\b/);
  if (y) {
    const year = Number(y[1]);
    return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1), label: `${year}` };
  }
  return null;
}

/** "50k", "₹40,000", "1.5 lakh", "2 cr" → rupees. Ignores years and "3 months". */
export function parseAmount(q: string): number | null {
  // The lookahead skips counts of time ("3 months") — with \b so "3k monthly" still counts.
  const re = /(₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|l|lakh|lakhs|lac|lacs|cr|crore|crores)?\b(?!\s*(?:day|days|week|weeks|month|months|year|years)\b)/gi;
  let best: number | null = null;
  for (const match of q.matchAll(re)) {
    const [, cur, numRaw, unitRaw] = match;
    const num = Number(numRaw.replace(/,/g, ''));
    if (!isFinite(num)) continue;
    const unit = (unitRaw || '').toLowerCase();
    if (!cur && !unit && /^(19|20)\d{2}$/.test(numRaw)) continue; // a year
    const mult = unit === 'k' || unit === 'thousand' ? 1e3
      : ['l', 'lakh', 'lakhs', 'lac', 'lacs'].includes(unit) ? 1e5
      : ['cr', 'crore', 'crores'].includes(unit) ? 1e7 : 1;
    const value = num * mult;
    if (!cur && !unit && value < 100) continue; // "top 5", "3" — not money
    if (best == null || value > best) best = value;
  }
  return best;
}

// Everyday words → the app's category names.
const SYNONYMS: Record<string, string[]> = {
  'Food & Dining': ['food', 'eating', 'eat out', 'eating out', 'restaurant', 'restaurants', 'dining', 'lunch', 'dinner', 'breakfast', 'takeaway', 'delivery'],
  'Snack': ['snack', 'snacks', 'coffee', 'tea', 'chai'],
  'Groceries': ['grocery', 'groceries', 'vegetables', 'supermarket', 'kirana'],
  'Cab & Auto': ['cab', 'cabs', 'taxi', 'auto', 'autos', 'rickshaw'],
  'Bus': ['bus', 'buses'],
  'Train': ['train', 'trains', 'railway', 'metro'],
  'Flight': ['flight', 'flights', 'airline', 'airfare', 'plane'],
  'Fuel': ['fuel', 'petrol', 'diesel', 'cng'],
  'Shopping': ['shopping', 'clothes', 'clothing', 'shoes', 'gadgets', 'electronics'],
  'Entertainment': ['entertainment', 'movie', 'movies', 'cinema', 'ott', 'streaming', 'games', 'gaming'],
  'Utilities': ['utilities', 'utility', 'bills', 'electricity', 'water bill', 'internet', 'wifi', 'broadband', 'recharge'],
  'Health': ['health', 'medical', 'medicine', 'medicines', 'doctor', 'pharmacy', 'hospital'],
  'Insurance': ['insurance', 'premium', 'premiums'],
  'Education': ['education', 'course', 'courses', 'tuition', 'school', 'college', 'books'],
};
const GROUPS: Record<string, string[]> = {
  travel: ['Cab & Auto', 'Bus', 'Train', 'Flight', 'Fuel'],
  transport: ['Cab & Auto', 'Bus', 'Train', 'Fuel'],
  commute: ['Cab & Auto', 'Bus', 'Train', 'Fuel'],
};

const SYNONYM_WORDS = new Set([...Object.values(SYNONYMS).flat(), ...Object.keys(GROUPS)].flatMap(s => s.split(' ')));

const STOPWORDS = new Set(`a an the i me my we our you your is are was were be been do did does done have has had
how much many what which who where when why can could should would will shall may might much more most less least
on in at to for from of by with about into over under than then this that these those there here it its
spend spent spending spends expense expenses cost costs paid pay paying payment payments bought buy purchase purchases
money total amount all any every some each per month months monthly week weeks year years day days today yesterday
last past previous next this so far show tell give list top biggest largest highest most expensive
income earn earned salary save saved saving savings afford budget budgets loan loans debt emi owe
and or not no yes ok please me us get got make made going go`.split(/\s+/).concat(Object.keys(MONTH_ALIASES)));

const CATEGORY_LABEL = (c: Category) => `${c.icon} ${c.name}`;

export function matchCategories(q: string, categories: Category[]): Category[] {
  const byName = new Map(categories.map(c => [c.name.toLowerCase(), c] as const));
  const hits = new Map<string, Category>();
  const has = (phrase: string) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}\\b`).test(q);

  for (const c of categories) {
    const n = c.name.toLowerCase();
    if (n !== 'other' && has(n)) hits.set(c.id, c);
  }
  for (const [catName, words] of Object.entries(SYNONYMS)) {
    const c = byName.get(catName.toLowerCase());
    if (c && words.some(has)) hits.set(c.id, c);
  }
  for (const [word, names] of Object.entries(GROUPS)) {
    if (!has(word)) continue;
    for (const n of names) {
      const c = byName.get(n.toLowerCase());
      if (c) hits.set(c.id, c);
    }
  }
  return [...hits.values()];
}

/** A merchant word from the user's own history mentioned in the question. */
export function matchMerchant(q: string, txs: Tx[]): string | null {
  const words = q.split(/[^a-z]+/).filter(w => w.length >= 3 && !STOPWORDS.has(w) && !SYNONYM_WORDS.has(w));
  if (!words.length) return null;
  const counts = new Map<string, number>();
  for (const t of txs) {
    for (const tok of new Set(normMerchant(t.merchant).split(' '))) {
      if (tok.length >= 3) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const w of words) {
    const n = counts.get(w) ?? 0;
    if (n > 0 && (best == null || n > (counts.get(best) ?? 0))) best = w;
  }
  return best;
}

const merchantHas = (tx: Tx, word: string) => normMerchant(tx.merchant).split(' ').includes(word);

// ─── Answering ───────────────────────────────────────────────────────────────

function coverageNote(p: Period, ctx: AskContext): string | null {
  if (ctx.historyFrom && p.from < ctx.historyFrom) {
    const h = ctx.historyFrom;
    return `Note: I only have your transactions from ${MONTH_NAMES[h.getMonth()]} ${h.getFullYear()}, so anything earlier isn't counted.`;
  }
  return null;
}

/** Average spend over the 3 complete months before the period's month (same filter). */
function usualMonthly(ctx: AskContext, p: Period, filter: (t: Tx) => boolean): number | null {
  const isMonth = p.from.getDate() === 1 && p.to.getDate() === 1 && (p.to.getTime() - p.from.getTime()) < 32 * DAY_MS;
  // Skip the current, still-running month: comparing a half month to full ones misleads.
  if (!isMonth || p.to.getTime() > ctx.now.getTime()) return null;
  const base = [1, 2, 3].map(i => monthPeriod(p.from.getFullYear(), p.from.getMonth() - i)).filter(bp => hasData(ctx.txs, bp));
  if (!base.length) return null;
  return base.reduce((s, bp) => s + spendOf(inRange(ctx.txs, bp).filter(filter)), 0) / base.length;
}

function compareLine(amount: number, usual: number | null): string | null {
  if (usual == null || usual <= 0) return null;
  const change = ((amount - usual) / usual) * 100;
  if (Math.abs(change) < 5) return `That's about your usual (${inr(usual)} a month).`;
  return `That's ${Math.abs(Math.round(change))}% ${change > 0 ? 'more' : 'less'} than your usual ${inr(usual)} a month.`;
}

function rx(q: string, re: RegExp) { return re.test(q); }

export function ask(question: string, ctx: AskContext): AskAnswer {
  const q = question.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return unknown();
  const now = ctx.now;
  const period = parsePeriod(q, now);
  const amount = parseAmount(q);

  // 1. Can I afford … ("can I spend/buy" only counts when an amount is given —
  //    "how much can I spend on food" is a spending question, not affordability)
  if (rx(q, /\bafford\b/) || (amount != null && rx(q, /\bcan i (buy|get|spend)\b|\bshould i (buy|get)\b/))) {
    if (amount == null) {
      return { intent: 'afford', title: 'Can you afford it?', lines: ['Tell me the amount, e.g. "Can I afford 50k?" or "Can I afford a 3k monthly EMI?"'], action: { label: 'Open the planner', route: '/(tabs)/brain?tab=planners' } };
    }
    const monthly = rx(q, /\bper month\b|\bmonthly\b|\ba month\b|\bemi\b|\bsubscription\b/);
    const result = canAfford({
      amount, mode: monthly ? 'monthly' : 'once',
      basics: cashflowBasics(ctx.txs, now),
      emergencyFund: ctx.emergencyFund, essentialMonthly: ctx.essentialMonthly,
      existingEmi: ctx.loans.filter(l => l.isActive).reduce((s, l) => s + l.emiAmount, 0),
    });
    const icon = { yes: '✅', maybe: '🟡', stretch: '🟠', no: '🔴' }[result.verdict];
    return {
      intent: 'afford', title: `${icon} ${inr(amount)}${monthly ? '/month' : ''}: ${result.headline}`,
      lines: result.points, action: { label: 'Open the planner', route: '/(tabs)/brain?tab=planners' },
    };
  }

  // 2. Subscriptions / repeating charges
  if (rx(q, /subscri|\brepeat|\brecurring\b|\bauto ?debit|monthly charges/)) {
    const r = repeatCharges(ctx.txs, now);
    if (!r.items.length) {
      return { intent: 'subscriptions', title: 'No repeating monthly charges found', lines: ['I look for the same merchant charging a similar amount about every month for 3+ months. Nothing matches yet.'] };
    }
    return {
      intent: 'subscriptions',
      title: `${r.items.length} repeating charges · ${inr(r.monthlyTotal)}/month`,
      lines: [`That's about ${inr(r.monthlyTotal * 12)} a year.`, ...r.items.filter(i => i.priceUp).map(i => `⬆️ ${i.merchant} went up from ${inr(i.prevAmount ?? 0)} to ${inr(i.lastAmount)}.`)],
      items: r.items.slice(0, 8).map(i => ({ label: i.merchant, value: `${inr(i.monthly)}/mo` })),
    };
  }

  // 3. Runway / emergency
  if (rx(q, /emergency|runway|surviv|\bhow long can i (last|survive|go)|lose my job|lost my job|income stops|no income|without (a )?(job|income|salary)/)) {
    if (ctx.survivalMonths == null) {
      return { intent: 'runway', title: 'Set up your Safety Net first', lines: ['I need your emergency fund and a few months of spending to work out your runway.'], action: { label: 'Open Safety Net', route: '/(tabs)/safety-net' } };
    }
    const m = ctx.survivalMonths;
    return {
      intent: 'runway',
      title: `About ${m >= 24 ? `${(m / 12).toFixed(1)} years` : `${m.toFixed(1)} months`} on essentials`,
      lines: [
        `Your emergency fund of ${inr(ctx.emergencyFund)} covers essential spending of ${inr(ctx.essentialMonthly)}/month.`,
        m >= 6 ? 'That meets the 6-month safety mark. 👍' : 'Aim for 6 months. Trimming optional spending helps it last longer.',
      ],
      action: { label: 'Open Safety Net', route: '/(tabs)/safety-net' },
    };
  }

  // 4. Net worth
  if (rx(q, /net ?worth|how much am i worth|what am i worth/)) {
    if (ctx.netWorth == null) return { intent: 'networth', title: 'Net worth unavailable', lines: ['Open the Home screen once so I can load it.'] };
    return { intent: 'networth', title: `Your net worth is ${inr(ctx.netWorth)}`, lines: ['Cash in hand plus the current value of your investments (as entered in Savings).'], action: { label: 'Open Savings', route: '/(tabs)/savings' } };
  }

  // 5. Tax → the Tax tab
  if (rx(q, /\btax\b|\btaxes\b|\bregime\b|\b80c\b|\bitr\b/)) {
    return { intent: 'tax', title: 'Old vs new tax regime', lines: ['The Tax tab compares both regimes for your income and deductions and shows which saves more.'], action: { label: 'Open the Tax tab', route: '/(tabs)/brain?tab=tax' } };
  }

  // 6. Investing → amount invested, or the Coach
  if (rx(q, /\binvest|\bsip\b|\bsips\b|mutual fund|\bstocks?\b|\bshares?\b|\bsector|portfolio|\bequity\b/)) {
    if (rx(q, /how much/) && period) {
      const total = inRange(ctx.txs, period).filter(t => t.type === 'INVESTMENT').reduce((s, t) => s + t.amount, 0);
      return { intent: 'invested', title: `You moved ${inr(total)} into investments ${periodPhrase(period)}`, lines: ['Counted from transactions marked as Investment.'] };
    }
    return {
      intent: 'invest', title: 'Investing: the Investment Coach',
      lines: ['I don\'t predict markets or pick stocks. Nobody can do that reliably.', 'The Coach checks whether you\'re ready to invest, your mix vs your target, your goals and a money calendar.'],
      action: { label: 'Open the Coach', route: '/(tabs)/coach' },
    };
  }

  // 7. Loans / debt
  if (rx(q, /\bloans?\b|\bdebts?\b|\bemis?\b|\bowe\b|\boutstanding\b/)) {
    const active = ctx.loans.filter(l => l.isActive && l.outstandingBalance > 0);
    if (!active.length) return { intent: 'loans', title: 'No active loans 🎉', lines: ['Nothing outstanding in your Loans.'] };
    const owed = active.reduce((s, l) => s + l.outstandingBalance, 0);
    const emi = active.reduce((s, l) => s + l.emiAmount, 0);
    const top = active.reduce((a, b) => (b.interestRate > a.interestRate ? b : a));
    return {
      intent: 'loans', title: `You owe ${inr(owed)} across ${active.length} loan${active.length > 1 ? 's' : ''}`,
      lines: [`EMIs total ${inr(emi)}/month.`, `Highest interest: ${top.name} at ${top.interestRate}%. Extra payments there save the most.`],
      items: active.map(l => ({ label: `${l.name} · ${l.interestRate}%`, value: inr(l.outstandingBalance) })),
      action: { label: 'Compare payoff plans', route: '/(tabs)/brain?tab=planners' },
    };
  }

  // 8. Budgets ("will I overspend" is a pace question — handled by the forecast below)
  if (rx(q, /\bbudgets?\b/)) {
    if (!ctx.budgets.length) return { intent: 'budget', title: 'No budgets set', lines: ['Set monthly limits per category in Budgets.'], action: { label: 'Open Budgets', route: '/(tabs)/budgets' } };
    const over = ctx.budgets.filter(b => b.percentUsed >= 100);
    const near = ctx.budgets.filter(b => b.percentUsed >= 80 && b.percentUsed < 100);
    return {
      intent: 'budget',
      title: over.length ? `${over.length} budget${over.length > 1 ? 's' : ''} over the limit` : near.length ? `${near.length} budget${near.length > 1 ? 's' : ''} close to the limit` : 'All budgets on track ✅',
      lines: [`This month: ${ctx.budgets.length} budget${ctx.budgets.length > 1 ? 's' : ''}.`],
      items: [...ctx.budgets].sort((a, b) => b.percentUsed - a.percentUsed).map(b => ({ label: `${b.icon} ${b.name}`, value: `${inr(b.spent)} / ${inr(b.amount)} (${Math.round(b.percentUsed)}%)` })),
      action: { label: 'Open Budgets', route: '/(tabs)/budgets' },
    };
  }

  // 9. Unusual
  if (rx(q, /unusual|strange|weird|\bodd\b|anomal|suspicious|big spends?|large spends?/)) {
    const u = unusualSpends(ctx.txs, now);
    if (!u.length) return { intent: 'unusual', title: 'Nothing unusual in the last 30 days ✅', lines: ['No spends stood out against your history.'] };
    return {
      intent: 'unusual', title: `${u.length} spend${u.length > 1 ? 's' : ''} stood out (last 30 days)`, lines: [],
      items: u.map(x => ({ label: `${x.tx.merchant} · ${shortDate(x.tx.date)}`, value: `${inr(x.tx.amount)}: ${x.reason}` })),
    };
  }

  // 10. Forecast / pace
  if (rx(q, /forecast|end of (the )?month|month end|\bpace\b|on track|will i (spend|overspend)|projected|predict|overspen|over spen/)) {
    const p = monthPace(ctx.txs, now);
    if (!p) return { intent: 'forecast', title: 'Not enough history yet', lines: ['I need at least one complete earlier month to compare against.'] };
    return {
      intent: 'forecast',
      title: paceTitle(p.pacePct),
      lines: [
        `Spent ${inr(p.spentSoFar)} so far (day ${p.day} of ${p.daysInMonth}). By now you usually spend ${inr(p.usualByToday)}.`,
        ...(p.bigOneOff ? [`Mostly one purchase: ${p.bigOneOff.merchant}, ${inr(p.bigOneOff.amount)}.`] : []),
        `Expect around ${inr(p.forecast)} by month-end (usual: ${inr(p.usualMonth)}).`,
        ...(p.early ? ['It\'s early in the month, so treat this as a rough guide.'] : []),
      ],
    };
  }

  const cats = matchCategories(q, ctx.categories);
  const merchant = matchMerchant(q, ctx.txs);

  // 11. Where did my money go / biggest
  if (rx(q, /biggest|largest|highest|most expensive|where (did|does|has) (all )?my money go|spent the most|top (spend|expense|categor|merchant)/)) {
    const p = period ?? monthsAgo(now, 0);
    const rows = inRange(ctx.txs, p);
    const cTotals = categoryTotals(ctx.txs, ctx.categories, p).slice(0, 5);
    const biggest = rows.filter(t => t.type === 'DEBIT').sort((a, b) => b.amount - a.amount).slice(0, 3);
    if (!cTotals.length) return { intent: 'biggest', title: `No spending ${periodPhrase(p)}`, lines: [coverageNote(p, ctx) ?? 'Nothing recorded for that period.'] };
    const total = spendOf(rows);
    return {
      intent: 'biggest',
      title: `Where your money went ${periodPhrase(p)}`,
      lines: [
        `Total spent: ${inr(total)}.`,
        ...(biggest.length ? [`Biggest single spends: ${biggest.map(t => `${t.merchant} ${inr(t.amount)}`).join(', ')}.`] : []),
        ...nonNull([coverageNote(p, ctx)]),
      ],
      items: cTotals.map(c => ({ label: CATEGORY_LABEL(c.category), value: `${inr(c.amount)} · ${total > 0 ? Math.round((c.amount / total) * 100) : 0}%` })),
    };
  }

  // 12. Income
  if (rx(q, /\bincome\b|\bearn|\bsalary\b|\breceived\b|\bcredited\b|got paid/)) {
    const p = period ?? monthsAgo(now, 0);
    const rows = inRange(ctx.txs, p).filter(t => t.type === 'CREDIT');
    const total = incomeOf(rows);
    const sources = topSources(rows);
    return {
      intent: 'income', title: `Income ${periodPhrase(p)}: ${inr(total)}`,
      lines: nonNull([rows.length ? `${rows.length} credit${rows.length > 1 ? 's' : ''}.` : 'No credits recorded.', coverageNote(p, ctx)]),
      items: sources.map(s => ({ label: s.name, value: inr(s.amount) })),
    };
  }

  // 13. Savings
  if (rx(q, /\bsav(e|ed|ing)\b|savings rate|left over|leftover/)) {
    const p = period ?? monthsAgo(now, 1);
    const r = savingsRate(ctx.txs, p);
    return {
      intent: 'saved',
      title: r.rate == null ? `No income recorded ${periodPhrase(p)}` : `You saved ${inr(r.saved)} ${periodPhrase(p)} (${Math.round(r.rate)}%)`,
      lines: nonNull([
        `Income ${inr(r.income)} − spending ${inr(r.spend)}.`,
        r.rate != null ? (r.rate >= 20 ? 'A 20%+ savings rate is a strong habit. 👍' : r.rate >= 0 ? 'Aim for 20%+ if you can.' : 'You spent more than you earned this period.') : null,
        coverageNote(p, ctx),
      ]),
    };
  }

  // 14. "How much can I (still) spend on X?" → what's left in that budget
  if (cats.length && rx(q, /\bcan i (still )?spend\b|left to spend|\bremaining\b|how much (more )?can i\b/)) {
    const names = new Set(cats.map(c => c.name.toLowerCase()));
    const b = ctx.budgets.find(x => names.has(x.name.toLowerCase()));
    if (b) {
      const left = b.amount - b.spent;
      return {
        intent: 'budget-left',
        title: left >= 0 ? `${inr(left)} left in your ${b.icon} ${b.name} budget` : `${b.icon} ${b.name} is ${inr(-left)} over budget`,
        lines: [`Spent ${inr(b.spent)} of ${inr(b.amount)} this month (${Math.round(b.percentUsed)}%).`],
        action: { label: 'Open Budgets', route: '/(tabs)/budgets' },
      };
    }
    return {
      intent: 'budget-left', title: `No budget set for ${cats.map(CATEGORY_LABEL).join(', ')}`,
      lines: ['Set a monthly limit in Budgets and I can tell you what\'s left to spend.'],
      action: { label: 'Open Budgets', route: '/(tabs)/budgets' },
    };
  }

  // 15. Spending (total / category / merchant) — the default money question
  if (cats.length || merchant || rx(q, /\bspen[dt]|\bexpense|\bcost|\bpaid\b|\bpay\b|\bbought\b|\bpurchase|how much/)) {
    const p = period ?? monthsAgo(now, 0);
    const filter: (t: Tx) => boolean =
      merchant ? (t => merchantHas(t, merchant))
      : cats.length ? (t => cats.some(c => c.id === t.categoryId))
      : () => true;
    const rows = inRange(ctx.txs, p).filter(filter);
    const amountSpent = spendOf(rows);
    const debits = rows.filter(t => t.type === 'DEBIT');
    const what = merchant ? `at ${titleCase(merchant)}` : cats.length ? `on ${cats.map(CATEGORY_LABEL).join(', ')}` : '';
    const items = merchant
      ? debits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6).map(t => ({ label: `${t.merchant} · ${shortDate(t.date)}`, value: inr(t.amount) }))
      : topMerchants(rows, { from: p.from, to: p.to, label: p.label }, 5).map(m => ({ label: `${m.merchant} (${m.count}×)`, value: inr(m.amount) }));
    return {
      intent: merchant ? 'spend-merchant' : cats.length ? 'spend-category' : 'spend',
      title: `You spent ${inr(amountSpent)} ${what} ${periodPhrase(p)}`.replace(/\s+/g, ' ').trim(),
      lines: nonNull([
        debits.length ? `${debits.length} transaction${debits.length > 1 ? 's' : ''}.` : 'No transactions found.',
        compareLine(amountSpent, usualMonthly(ctx, p, filter)),
        coverageNote(p, ctx),
      ]),
      items: items.length ? items : undefined,
    };
  }

  return unknown();
}

function unknown(): AskAnswer {
  return {
    intent: 'unknown',
    title: 'I didn\'t catch that',
    lines: ['I answer questions about your spending, income, savings, budgets, subscriptions, loans and runway, using your own data. Try one of these:'],
    suggestions: SAMPLE_QUESTIONS.slice(0, 6),
  };
}

export function paceTitle(pacePct: number): string {
  if (pacePct >= 200) return `Spending ${(pacePct / 100).toFixed(1)}× your usual pace`;
  if (pacePct > 110) return `Running ${pacePct - 100}% above your usual pace`;
  if (pacePct < 90) return `Running ${100 - pacePct}% below your usual pace 👍`;
  return 'Right on your usual pace';
}

function periodPhrase(p: Period): string {
  const l = p.label;
  if (/^(today|yesterday|this week|last week|this month)$/.test(l)) return l;
  if (l.startsWith('the last')) return `over ${l}`;
  return `in ${l}`;
}

function topSources(rows: Tx[]): { name: string; amount: number }[] {
  const acc = new Map<string, { name: string; amount: number }>();
  for (const t of rows) {
    const key = normMerchant(t.merchant) || t.merchant;
    const cur = acc.get(key) ?? { name: t.merchant, amount: 0 };
    cur.amount += t.amount;
    acc.set(key, cur);
  }
  return [...acc.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
}

const nonNull = (xs: (string | null)[]) => xs.filter((x): x is string => !!x);
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export { MONTH_NAMES };
