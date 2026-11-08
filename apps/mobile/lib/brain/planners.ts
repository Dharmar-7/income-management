// Velora Brain — planners. Pure maths: "can I afford it?", goal SIP, and a loan
// payoff simulator (avalanche vs snowball). Inputs come from the user's real
// history; every verdict explains the numbers behind it.

import { type Tx, monthsAgo, inRange, spendOf, incomeOf, hasData, inr } from './core';

// ─── Cash-flow basics ────────────────────────────────────────────────────────

export interface CashflowBasics { avgIncome: number; avgSpend: number; surplus: number; monthsUsed: number }

/** Averages over the last `months` COMPLETE months that have any data. */
export function cashflowBasics(txs: Tx[], now: Date, months = 3): CashflowBasics {
  const periods = Array.from({ length: months }, (_, i) => monthsAgo(now, i + 1)).filter(p => hasData(txs, p));
  if (!periods.length) return { avgIncome: 0, avgSpend: 0, surplus: 0, monthsUsed: 0 };
  let income = 0, spend = 0;
  for (const p of periods) {
    const rows = inRange(txs, p);
    income += incomeOf(rows);
    spend += spendOf(rows);
  }
  const avgIncome = income / periods.length;
  const avgSpend = spend / periods.length;
  return { avgIncome, avgSpend, surplus: avgIncome - avgSpend, monthsUsed: periods.length };
}

// ─── Can I afford it? ────────────────────────────────────────────────────────

export type AffordMode = 'once' | 'monthly';
export type Verdict = 'yes' | 'maybe' | 'stretch' | 'no';

export interface AffordInput {
  amount: number;
  mode: AffordMode;
  basics: CashflowBasics;
  emergencyFund: number;     // from Safety Net
  essentialMonthly: number;  // essential burn, from Safety Net
  existingEmi: number;       // active loan EMIs
}

export interface AffordResult { verdict: Verdict; headline: string; points: string[] }

export function canAfford(i: AffordInput): AffordResult {
  const { amount, basics } = i;
  if (!(amount > 0)) return { verdict: 'maybe', headline: 'Enter an amount to check.', points: [] };
  if (basics.monthsUsed === 0 || basics.avgIncome <= 0) {
    return {
      verdict: 'maybe',
      headline: 'Not enough history yet.',
      points: ['Import a statement or a few months of transactions so the Brain can see your income and spending.'],
    };
  }

  const surplus = basics.surplus;
  const flowLine = `On average you earn ${inr(basics.avgIncome)} and spend ${inr(basics.avgSpend)} a month (last ${basics.monthsUsed} month${basics.monthsUsed === 1 ? '' : 's'}).`;

  if (i.mode === 'monthly') {
    const newSurplus = surplus - amount;
    const emiPct = Math.round(((i.existingEmi + amount) / basics.avgIncome) * 100);
    const points = [
      flowLine,
      `Your monthly surplus would drop from ${inr(surplus)} to ${inr(newSurplus)}.`,
      `All EMIs together would take ${emiPct}% of your income. A healthy limit is about 30–40%.`,
    ];
    if (newSurplus < 0) return { verdict: 'no', headline: 'This would push you into spending more than you earn.', points };
    if (emiPct <= 30 && newSurplus >= 0.1 * basics.avgIncome) return { verdict: 'yes', headline: `Comfortable: ${inr(amount)}/month fits your budget.`, points };
    if (emiPct <= 40) return { verdict: 'maybe', headline: 'Doable, but it tightens your monthly budget.', points };
    return { verdict: 'stretch', headline: 'A stretch: your total EMIs would be too large a share of income.', points };
  }

  // One-time purchase
  const fundAfter = i.emergencyFund - amount;
  const coverAfter = i.essentialMonthly > 0 ? fundAfter / i.essentialMonthly : null;
  const coverLine = coverAfter != null
    ? `Paying from savings would leave ${Math.max(0, coverAfter).toFixed(1)} months of emergency cover (aim for 6).`
    : null;

  if (surplus <= 0) {
    const points = [flowLine, ...(coverLine ? [coverLine] : [])];
    if (coverAfter != null && coverAfter >= 6) {
      return { verdict: 'stretch', headline: 'Your savings can cover it, but you spend about what you earn.', points };
    }
    return { verdict: 'no', headline: 'Not right now: you\'re spending about as much as you earn.', points };
  }

  const monthsToSave = Math.ceil(amount / surplus);
  const points = [
    flowLine,
    `That leaves a surplus of about ${inr(surplus)} a month, so saving for it takes ${monthsToSave} month${monthsToSave === 1 ? '' : 's'}.`,
    ...(coverLine ? [coverLine] : []),
  ];

  if (amount <= 0.5 * surplus) return { verdict: 'yes', headline: `Comfortable: about ${Math.round((amount / surplus) * 100)}% of one month's surplus.`, points };
  if (amount <= surplus) return { verdict: 'yes', headline: 'Affordable from this month\'s surplus.', points };
  if (monthsToSave <= 3) return { verdict: 'maybe', headline: `Save for ${monthsToSave} months and buy it without touching your savings.`, points };
  if (coverAfter != null && coverAfter >= 6) {
    return { verdict: 'maybe', headline: 'You could pay from savings and still keep 6+ months of cover.', points };
  }
  return { verdict: 'stretch', headline: `A stretch: it would take ${monthsToSave} months of saving.`, points };
}

// ─── Goal planner (with returns) ─────────────────────────────────────────────

export const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

/** A conservative expected return for the time horizon (assumption, shown to the user). */
export function suggestedReturn(months: number): number {
  if (months < 12) return 6;
  if (months < 36) return 7;
  if (months < 60) return 8.5;
  return 10;
}

export interface SipPlan { monthly: number; withoutReturns: number; currentGrowsTo: number; onTrack: boolean }

/** Monthly amount needed to reach `target` in `months`, given money already saved. */
export function sipNeeded(target: number, current: number, months: number, annualPct: number): SipPlan {
  const n = Math.max(1, Math.round(months));
  const r = monthlyRate(annualPct);
  const growth = Math.pow(1 + r, n);
  const currentGrowsTo = current * growth;
  const gap = target - currentGrowsTo;
  const withoutReturns = Math.max(0, (target - current) / n);
  if (gap <= 0) return { monthly: 0, withoutReturns, currentGrowsTo, onTrack: true };
  const monthly = r === 0 ? gap / n : (gap * r) / (growth - 1);
  return { monthly, withoutReturns, currentGrowsTo, onTrack: false };
}

/** Months to reach `target` investing `monthly`; null if not reachable in 50 years. */
export function monthsToReach(target: number, current: number, monthly: number, annualPct: number): number | null {
  const r = monthlyRate(annualPct);
  let bal = current;
  for (let m = 0; m <= 600; m++) {
    if (bal >= target) return m;
    bal = bal * (1 + r) + monthly;
  }
  return null;
}

// ─── Loan payoff simulator ───────────────────────────────────────────────────

export interface LoanState { id: string; name: string; balance: number; rate: number; emi: number }
export type Strategy = 'minimum' | 'avalanche' | 'snowball';

export interface PayoffPlan {
  strategy: Strategy;
  months: number;            // until every loan is cleared
  totalInterest: number;
  order: { name: string; month: number }[];
  stuck: boolean;            // an EMI doesn't cover its interest — never ends
}

const MAX_MONTHS = 600;

/**
 * Month-by-month payoff. Every loan pays its EMI; with avalanche/snowball the
 * `extra` amount — plus the EMIs freed as loans close ("rolling over") — goes to
 * one target loan at a time: highest rate first (avalanche) or smallest balance
 * first (snowball). 'minimum' = EMIs only, the baseline.
 */
export function simulatePayoff(loans: LoanState[], extra: number, strategy: Strategy): PayoffPlan {
  const ls = loans.filter(l => l.balance > 0).map(l => ({ ...l }));
  const order: { name: string; month: number }[] = [];
  const closed = new Set<string>(); // by id — two loans may share a name
  let totalInterest = 0;
  let freed = 0;
  let month = 0;

  while (ls.some(l => l.balance > 0.5) && month < MAX_MONTHS) {
    month++;
    let pool = strategy === 'minimum' ? 0 : extra + freed;

    for (const l of ls) {
      if (l.balance <= 0.5) continue;
      const interest = l.balance * (l.rate / 1200);
      totalInterest += interest;
      l.balance += interest;
      const pay = Math.min(l.balance, l.emi);
      l.balance -= pay;
      if (strategy !== 'minimum') pool += l.emi - pay; // unused part of a final EMI
    }

    if (strategy !== 'minimum') {
      while (pool > 0.5) {
        const active = ls.filter(l => l.balance > 0.5);
        if (!active.length) break;
        const target = strategy === 'avalanche'
          ? active.reduce((a, b) => (b.rate > a.rate ? b : a))
          : active.reduce((a, b) => (b.balance < a.balance ? b : a));
        const pay = Math.min(pool, target.balance);
        target.balance -= pay;
        pool -= pay;
      }
    }

    for (const l of ls) {
      if (l.balance <= 0.5 && !closed.has(l.id)) {
        l.balance = 0;
        closed.add(l.id);
        order.push({ name: l.name, month });
        if (strategy !== 'minimum') freed += l.emi;
      }
    }
  }

  return {
    strategy,
    months: month,
    totalInterest: Math.round(totalInterest),
    order,
    stuck: ls.some(l => l.balance > 0.5),
  };
}

export interface PayoffComparison {
  minimum: PayoffPlan;
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  best: 'avalanche' | 'snowball';
  interestSaved: number;   // best vs minimum
  monthsSaved: number;
}

export function comparePayoff(loans: LoanState[], extra: number): PayoffComparison {
  const minimum = simulatePayoff(loans, 0, 'minimum');
  const avalanche = simulatePayoff(loans, extra, 'avalanche');
  const snowball = simulatePayoff(loans, extra, 'snowball');
  const best = avalanche.totalInterest <= snowball.totalInterest ? 'avalanche' : 'snowball';
  const b = best === 'avalanche' ? avalanche : snowball;
  return {
    minimum, avalanche, snowball, best,
    interestSaved: Math.max(0, minimum.totalInterest - b.totalInterest),
    monthsSaved: Math.max(0, minimum.months - b.months),
  };
}
