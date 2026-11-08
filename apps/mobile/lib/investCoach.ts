// ─────────────────────────────────────────────────────────────────────────────
// Investment Coach — the rules-and-maths "expert" for investing.
//
// Deliberately NOT a predictor: it never says "buy sector X in month Y" (nobody
// can do that reliably, and it would be investment advice). Instead it does what
// good advisers actually add — order of operations, allocation discipline,
// goal-to-instrument matching, and a calendar of dated, predictable actions.
//
// Everything here is pure (no React Native imports) so the maths is easy to
// reason about and can be sanity-checked outside the app. Screen: coach.tsx.
// Figures are rules of thumb and Indian tax rules as of FY 2025-26 — tax rules
// change in each Union Budget, so the UI tells the user to double-check.
// ─────────────────────────────────────────────────────────────────────────────

export type Risk = 'low' | 'medium' | 'high';
export type TaxRegime = 'old' | 'new';

export interface MoneyProfile {
  age: number | null;          // null = profile not set up yet
  risk: Risk;
  regime: TaxRegime;
  hasHealthInsurance: boolean;
  hasDependents: boolean;      // anyone relying on your income
  hasTermInsurance: boolean;   // only matters when hasDependents
}

export const DEFAULT_PROFILE: MoneyProfile = {
  age: null,
  risk: 'medium',
  regime: 'new',               // the default regime since FY 2023-24
  hasHealthInsurance: false,
  hasDependents: false,
  hasTermInsurance: false,
};

// ─── Input row shapes (only the fields we read from the API) ────────────────

export interface SavingInput {
  id: string;
  name: string;
  type: string;                // SavingType enum
  investedAmount: number;
  currentValue: number;
  sipAmount: number | null;
}
export interface LoanInput { id: string; name: string; interestRate: number; isActive: boolean }
export interface GoalInput {
  id: string;
  name: string;
  icon: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string | null;
}

export function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(Math.round(n));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ─── 1. Asset allocation ─────────────────────────────────────────────────────

type Bucket = 'equity' | 'debt' | 'gold' | 'other';

// How each saving type splits across asset buckets. Mutual funds are counted as
// equity (we can't tell debt funds apart) and NPS as a 50/50 mix — both are
// surfaced to the user as assumptions rather than hidden.
const BUCKET_SPLIT: Record<string, Partial<Record<Bucket, number>>> = {
  STOCKS: { equity: 1 },
  MUTUAL_FUNDS: { equity: 1 },
  FIXED_DEPOSIT: { debt: 1 },
  RECURRING_DEPOSIT: { debt: 1 },
  POST_OFFICE: { debt: 1 },
  EPF: { debt: 1 },
  NPS: { equity: 0.5, debt: 0.5 },
  GOLD: { gold: 1 },
  OTHER: { other: 1 },
};

export interface Allocation {
  total: number;                                   // all holdings, current value
  amounts: Record<Bucket, number>;
  pct: { equity: number; debt: number; gold: number }; // share of equity+debt+gold
  otherAmount: number;
}

export function computeAllocation(savings: SavingInput[]): Allocation {
  const amounts: Record<Bucket, number> = { equity: 0, debt: 0, gold: 0, other: 0 };
  for (const s of savings) {
    const value = Math.max(0, s.currentValue || 0);
    const split = BUCKET_SPLIT[s.type] ?? { other: 1 };
    for (const [bucket, share] of Object.entries(split) as [Bucket, number][]) {
      amounts[bucket] += value * share;
    }
  }
  const core = amounts.equity + amounts.debt + amounts.gold;
  const pct = core > 0
    ? {
        equity: Math.round((amounts.equity / core) * 100),
        debt: Math.round((amounts.debt / core) * 100),
        gold: Math.round((amounts.gold / core) * 100),
      }
    : { equity: 0, debt: 0, gold: 0 };
  return { total: core + amounts.other, amounts, pct, otherAmount: amounts.other };
}

export interface Target { equity: number; debt: number; gold: number }

// The classic "100 minus age" equity rule, nudged by risk comfort, with a 10%
// gold sleeve. A starting point to compare against — not a prescription.
export function targetAllocation(p: MoneyProfile): Target {
  const base = p.age != null ? 100 - p.age : 60;
  const adj = p.risk === 'low' ? -15 : p.risk === 'high' ? 10 : 0;
  const equity = clamp(Math.round(base + adj), 15, 85);
  const gold = 10;
  return { equity, debt: 100 - equity - gold, gold };
}

export interface CoachMessage { tone: 'good' | 'warn' | 'info'; text: string }

export interface PortfolioCheck {
  allocation: Allocation;
  target: Target;
  messages: CoachMessage[];
  assumptions: string[];
  hasHoldings: boolean;
}

const DRIFT_PTS = 10; // how far equity may drift from target before we nudge

export function checkPortfolio(savings: SavingInput[], profile: MoneyProfile): PortfolioCheck {
  const allocation = computeAllocation(savings);
  const target = targetAllocation(profile);
  const messages: CoachMessage[] = [];
  const assumptions: string[] = [];
  const core = allocation.amounts.equity + allocation.amounts.debt + allocation.amounts.gold;
  const hasHoldings = core > 0;

  if (hasHoldings) {
    const drift = allocation.pct.equity - target.equity;
    if (drift > DRIFT_PTS) {
      messages.push({
        tone: 'warn',
        text: `Equity is ${allocation.pct.equity}% vs your ${target.equity}% target. Send new money to debt or gold, or rebalance in April.`,
      });
    } else if (drift < -DRIFT_PTS) {
      messages.push({
        tone: 'warn',
        text: `Equity is only ${allocation.pct.equity}% vs your ${target.equity}% target. For goals 5+ years away, consider raising equity SIPs gradually.`,
      });
    } else {
      messages.push({ tone: 'good', text: `Your mix is within ${DRIFT_PTS} points of your target. Nothing to rebalance right now.` });
    }

    if (allocation.pct.gold > target.gold + DRIFT_PTS) {
      messages.push({
        tone: 'warn',
        text: `Gold is ${allocation.pct.gold}% of your investments. It's a good hedge, but it doesn't compound like equity over the long run.`,
      });
    }

    // Single-stock concentration. Mutual funds are diversified by design and FDs
    // are a different kind of risk, so only direct stocks are flagged.
    const total = allocation.total;
    for (const s of savings) {
      if (s.type !== 'STOCKS' || total <= 0) continue;
      const share = Math.round((Math.max(0, s.currentValue) / total) * 100);
      if (share >= 20) {
        messages.push({
          tone: 'warn',
          text: `"${s.name}" alone is ${share}% of your investments. One company's bad year would hit you hard.`,
        });
      }
    }

    const directStocks = savings
      .filter(s => s.type === 'STOCKS')
      .reduce((sum, s) => sum + Math.max(0, s.currentValue), 0);
    if (allocation.amounts.equity > 0 && directStocks / allocation.amounts.equity > 0.6) {
      messages.push({
        tone: 'info',
        text: 'Most of your equity is in individual stocks. An index fund gives you every sector at once, with far less single-company risk.',
      });
    }
  }

  if (savings.some(s => s.type === 'MUTUAL_FUNDS')) {
    assumptions.push('All mutual funds are counted as equity. If some are debt funds, your equity share is a little overstated.');
  }
  if (savings.some(s => s.type === 'NPS')) {
    assumptions.push('NPS is counted as half equity, half debt.');
  }
  if (allocation.otherAmount > 0) {
    assumptions.push(`${inr(allocation.otherAmount)} in "Other" holdings is left out of the mix.`);
  }

  return { allocation, target, messages, assumptions, hasHoldings };
}

// ─── 2. Readiness: the order of operations ──────────────────────────────────

export type StepStatus = 'done' | 'partial' | 'todo' | 'unknown';

export interface ReadinessStep {
  id: 'emergency' | 'debt' | 'health' | 'term' | 'invest';
  title: string;
  detail: string;
  status: StepStatus;
  link?: string;               // expo-router path to fix it
}

const HIGH_INTEREST = 12; // % p.a. — above typical long-run investment returns

function monthsLabel(m: number): string {
  return m >= 24 ? `${(m / 12).toFixed(1)} years` : `${m.toFixed(1)} months`;
}

export function readinessSteps(input: {
  survivalMonths: number | null;
  loans: LoanInput[];
  profile: MoneyProfile;
  savings: SavingInput[];
}): ReadinessStep[] {
  const { survivalMonths, loans, profile, savings } = input;
  const steps: ReadinessStep[] = [];

  // 1. Emergency fund
  steps.push(
    survivalMonths == null
      ? {
          id: 'emergency', title: 'Emergency fund (6 months)', status: 'unknown', link: '/(tabs)/safety-net',
          detail: 'Set your emergency fund in Safety Net so we can measure this.',
        }
      : {
          id: 'emergency', title: 'Emergency fund (6 months)', link: '/(tabs)/safety-net',
          status: survivalMonths >= 6 ? 'done' : survivalMonths >= 3 ? 'partial' : 'todo',
          detail: survivalMonths >= 6
            ? `Covers ${monthsLabel(survivalMonths)} of essentials. You're protected.`
            : `Covers ${monthsLabel(survivalMonths)} of essentials. Build this to 6 months before investing heavily.`,
        },
  );

  // 2. High-interest debt
  const costly = loans.filter(l => l.isActive && l.interestRate >= HIGH_INTEREST);
  if (costly.length === 0) {
    steps.push({ id: 'debt', title: 'No high-interest debt', status: 'done', detail: `No active loans at ${HIGH_INTEREST}% or more.` });
  } else {
    const top = Math.max(...costly.map(l => l.interestRate));
    steps.push({
      id: 'debt', title: 'Clear high-interest debt', status: 'todo', link: '/(tabs)/loans',
      detail: `${costly.map(l => `${l.name} (${l.interestRate}%)`).join(', ')}. Paying these off is a guaranteed ${top}% return, better than most investments.`,
    });
  }

  // 3. Health insurance
  steps.push({
    id: 'health', title: 'Health insurance', status: profile.hasHealthInsurance ? 'done' : 'todo',
    detail: profile.hasHealthInsurance
      ? 'Covered. One hospital bill won\'t wipe out your savings.'
      : 'A health policy (beyond any employer cover) stops one hospital bill from wiping out your savings.',
  });

  // 4. Term life cover — only relevant with dependents
  steps.push(
    !profile.hasDependents
      ? { id: 'term', title: 'Term life cover', status: 'done', detail: 'Not needed until someone depends on your income.' }
      : {
          id: 'term', title: 'Term life cover', status: profile.hasTermInsurance ? 'done' : 'todo',
          detail: profile.hasTermInsurance
            ? 'Your family is protected if your income stops.'
            : 'Protects your family if your income stops. A common rule is 10–15× your annual income.',
        },
  );

  // 5. Invest regularly
  const sipMonthly = savings.reduce((s, x) => s + (x.sipAmount ?? 0), 0);
  const invested = savings.reduce((s, x) => s + Math.max(0, x.currentValue), 0);
  steps.push(
    sipMonthly > 0
      ? { id: 'invest', title: 'Invest every month', status: 'done', detail: `You invest ${inr(sipMonthly)}/month through SIPs.`, link: '/(tabs)/savings' }
      : invested > 0
        ? { id: 'invest', title: 'Invest every month', status: 'partial', link: '/(tabs)/savings', detail: 'You have investments but no monthly SIP. A fixed monthly amount builds the habit.' }
        : { id: 'invest', title: 'Invest every month', status: 'todo', link: '/(tabs)/savings', detail: 'Once the steps above are done, start a monthly SIP. Even a small one.' },
  );

  return steps;
}

// ─── 3. Goals → the right kind of investment ────────────────────────────────

export type Horizon = 'done' | 'nodate' | 'overdue' | 'short' | 'medium' | 'mid' | 'long';

export interface GoalPlan {
  goal: GoalInput;
  remaining: number;
  monthsLeft: number | null;
  monthlyNeeded: number | null; // without counting returns — deliberately conservative
  horizon: Horizon;
  suggestion: string;
}

const MONTH_MS = 30.4375 * 86_400_000;

export function planGoals(goals: GoalInput[], now: Date = new Date()): GoalPlan[] {
  return goals.map(goal => {
    const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
    if (remaining <= 0) {
      return { goal, remaining: 0, monthsLeft: null, monthlyNeeded: null, horizon: 'done', suggestion: 'Goal reached 🎉' };
    }
    const t = goal.targetDate ? Date.parse(goal.targetDate) : NaN;
    if (Number.isNaN(t)) {
      return { goal, remaining, monthsLeft: null, monthlyNeeded: null, horizon: 'nodate', suggestion: 'Add a target date to get a suggestion.' };
    }
    const monthsLeft = Math.ceil((t - now.getTime()) / MONTH_MS);
    if (monthsLeft <= 0) {
      return { goal, remaining, monthsLeft: 0, monthlyNeeded: null, horizon: 'overdue', suggestion: 'The target date has passed. Update it to re-plan.' };
    }
    const monthlyNeeded = remaining / monthsLeft;
    const [horizon, suggestion]: [Horizon, string] =
      monthsLeft < 12 ? ['short', 'Under a year: keep it safe in a savings account, liquid fund or FD.']
      : monthsLeft < 36 ? ['medium', '1–3 years: FDs/RDs or short-term debt funds. Steady, little risk.']
      : monthsLeft < 60 ? ['mid', '3–5 years: hybrid/balanced funds, a mix of equity and stable debt.']
      : ['long', '5+ years: equity index funds via SIP. Time smooths out the ups and downs.'];
    return { goal, remaining, monthsLeft, monthlyNeeded, horizon, suggestion };
  });
}

// ─── 4. Money calendar — dated, predictable actions ─────────────────────────

export interface CalendarItem {
  id: string;
  title: string;
  detail: string;
  months: number[] | 'monthly';   // 1 = January … 12 = December
  oldRegimeOnly?: boolean;
  needsEquity?: boolean;
  needsPostOffice?: boolean;
  needsSip?: boolean;
}

export const CALENDAR: CalendarItem[] = [
  {
    id: 'ppf-5th', months: 'monthly', needsPostOffice: true,
    title: 'PPF deposit before the 5th',
    detail: 'PPF interest uses your lowest balance between the 5th and month-end. Money added after the 5th earns nothing that month.',
  },
  {
    id: 'sip-balance', months: 'monthly', needsSip: true,
    title: 'Keep balance ready for SIP dates',
    detail: 'A SIP that bounces for low balance can attract a bank charge and breaks your streak.',
  },
  {
    id: 'proofs', months: [1, 2], oldRegimeOnly: true,
    title: 'Submit investment proofs to your employer',
    detail: 'Employers collect 80C/80D/HRA proofs around Jan–Feb. Missing them means extra tax deducted from your salary.',
  },
  {
    id: '80c', months: [1, 2, 3], oldRegimeOnly: true,
    title: 'Finish 80C investments by 31 March',
    detail: 'Up to ₹1.5L across ELSS, PPF, EPF, life insurance etc. cuts your taxable income under the old regime.',
  },
  {
    id: 'harvest', months: [3], needsEquity: true,
    title: 'Book tax-free equity gains',
    detail: 'Long-term equity gains up to ₹1.25L a year are tax-free. Selling and re-buying before 31 March uses this year\'s limit.',
  },
  {
    id: 'advance-tax', months: [3, 6, 9, 12],
    title: 'Advance tax due on the 15th',
    detail: 'Only if you have income beyond salary (freelance, rent, large capital gains) and owe over ₹10,000 tax for the year.',
  },
  {
    id: 'new-fy', months: [4],
    title: 'New financial year: reset & review',
    detail: 'Tell your employer your tax regime, check your investment mix, rebalance if it has drifted, and step up SIPs (~10%) with any raise.',
  },
  {
    id: 'itr', months: [6, 7],
    title: 'File your income tax return',
    detail: 'Form 16 usually arrives by mid-June. The deadline for salaried people is usually 31 July.',
  },
  {
    id: 'festive', months: [10, 11],
    title: 'Festive season & bonus plan',
    detail: 'Set a festive spending budget, and decide up front how much of any bonus goes to goals vs spending.',
  },
  {
    id: 'year-end', months: [12],
    title: 'Year-end check',
    detail: 'Review your goals for next year and top up your emergency fund before January.',
  },
];

export interface CalendarContext { regime: TaxRegime; hasEquity: boolean; hasPostOffice: boolean; hasSip: boolean }

export function calendarFor(month: number, ctx: CalendarContext): CalendarItem[] {
  return CALENDAR.filter(item => {
    if (item.months !== 'monthly' && !item.months.includes(month)) return false;
    if (item.oldRegimeOnly && ctx.regime !== 'old') return false;
    if (item.needsEquity && !ctx.hasEquity) return false;
    if (item.needsPostOffice && !ctx.hasPostOffice) return false;
    if (item.needsSip && !ctx.hasSip) return false;
    return true;
  });
}

export function calendarContext(savings: SavingInput[], profile: MoneyProfile): CalendarContext {
  return {
    regime: profile.regime,
    hasEquity: savings.some(s => s.type === 'STOCKS' || s.type === 'MUTUAL_FUNDS'),
    hasPostOffice: savings.some(s => s.type === 'POST_OFFICE'),
    hasSip: savings.some(s => (s.sipAmount ?? 0) > 0),
  };
}

// ─── 5. Learn: sectors without predictions ──────────────────────────────────

export interface LearnCard { id: string; emoji: string; title: string; body: string }

export const LEARN: LearnCard[] = [
  {
    id: 'timing', emoji: '⏳', title: 'Time in the market beats timing it',
    body: 'Most professional fund managers fail to beat a simple index over 10 years. Investing a fixed amount every month (SIP) means you automatically buy more when prices are low and less when they are high, with no predictions needed.',
  },
  {
    id: 'defensive-cyclical', emoji: '🛡️', title: 'Defensive vs cyclical sectors',
    body: 'Defensive sectors (FMCG, pharma, utilities) sell things people buy in good times and bad, so they swing less. Cyclical sectors (autos, metals, real estate, capital goods) boom when the economy grows and fall hard in slowdowns.',
  },
  {
    id: 'rates', emoji: '🏦', title: 'How interest rates move sectors',
    body: 'When the RBI raises rates, loans get costlier: real estate and autos often slow, while banks can earn more on lending. When rates fall, the reverse tends to happen. Knowing this explains the news. It doesn\'t predict prices.',
  },
  {
    id: 'thematic', emoji: '🎯', title: 'Why single-sector funds are risky',
    body: 'Sector and thematic funds bet everything on one industry. Last year\'s best sector is often next year\'s laggard. If you use them at all, keep them a small slice (say under 10%) on top of a diversified core.',
  },
  {
    id: 'index', emoji: '🧺', title: 'Index funds: every sector at once',
    body: 'A Nifty 50 or Nifty 500 index fund owns the leading companies across all sectors, with very low costs. Whichever sector does well, you already own it. That\'s why it makes a strong core holding.',
  },
];
