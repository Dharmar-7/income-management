// Velora Brain — spending insights. Pure functions over the transaction history.
// Every insight is built from the user's own numbers and only shows when the
// data actually supports it (enough history, big enough change) — no filler.

import {
  type Tx, type Category, type Period,
  monthsAgo, monthPeriod, inRange, spendOf, incomeOf, normMerchant, median, percentile,
  hasData, inr, time, DAY_MS, MONTH_NAMES,
} from './core';

const UNCATEGORIZED: Category = { id: '__none__', name: 'Uncategorized', icon: '❓' };

// ─── Month series ────────────────────────────────────────────────────────────

export interface MonthTotals { label: string; short: string; income: number; spend: number; hasData: boolean }

/** The last `n` months including the current one, oldest first. */
export function monthlySeries(txs: Tx[], now: Date, n = 6): MonthTotals[] {
  const out: MonthTotals[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = monthsAgo(now, i);
    const rows = inRange(txs, p);
    out.push({
      label: p.label,
      short: MONTH_NAMES[p.from.getMonth()].slice(0, 3),
      income: incomeOf(rows),
      spend: spendOf(rows),
      hasData: rows.length > 0,
    });
  }
  return out;
}

// ─── Pace + month-end forecast ───────────────────────────────────────────────

export interface Pace {
  day: number;
  daysInMonth: number;
  spentSoFar: number;
  usualByToday: number;   // avg spend by this day-of-month in recent months
  usualMonth: number;     // avg full-month spend in those months
  pacePct: number;        // spentSoFar ÷ usualByToday
  forecast: number;       // spent so far + what you usually spend in the rest of the month
  early: boolean;         // first few days — the projection is shaky
  monthsCompared: number;
  bigOneOff: { merchant: string; amount: number } | null; // a single spend driving the pace
}

/**
 * Compares this month's spend so far against what you'd usually spent by the
 * same day in recent months. Ratio-based on purpose: if rent always lands on
 * the 1st, earlier months had it too, so a big early bill doesn't fake a spike.
 */
export function monthPace(txs: Tx[], now: Date, lookback = 3): Pace | null {
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const soFarRows = inRange(txs, { from: monthsAgo(now, 0).from, to: new Date(now.getTime() + 1), label: '' });
  const spentSoFar = spendOf(soFarRows);

  const partials: number[] = [];
  const fulls: number[] = [];
  for (let i = 1; i <= lookback; i++) {
    const p = monthsAgo(now, i);
    if (!hasData(txs, p)) continue;
    const dim = new Date(p.from.getFullYear(), p.from.getMonth() + 1, 0).getDate();
    const cut = new Date(p.from.getFullYear(), p.from.getMonth(), Math.min(day, dim) + 1);
    partials.push(spendOf(inRange(txs, { from: p.from, to: cut, label: '' })));
    fulls.push(spendOf(inRange(txs, p)));
  }
  if (!partials.length) return null;

  const usualByToday = partials.reduce((a, b) => a + b, 0) / partials.length;
  const usualMonth = fulls.reduce((a, b) => a + b, 0) / fulls.length;
  if (usualByToday <= 0 || usualMonth <= 0) return null;

  // Forecast = what's already spent + what you USUALLY spend in the rest of the
  // month. Additive, not a ratio — a one-off purchase (a new phone) shouldn't be
  // multiplied into the projection as if it would repeat.
  const restOfMonth = Math.max(0, usualMonth - usualByToday);

  // Name the culprit when one purchase is most of the pace.
  const biggest = soFarRows.filter(t => t.type === 'DEBIT').sort((a, b) => b.amount - a.amount)[0];
  const bigOneOff = biggest && biggest.amount >= 5000 && biggest.amount >= 0.3 * spentSoFar
    ? { merchant: biggest.merchant, amount: biggest.amount }
    : null;

  return {
    day, daysInMonth, spentSoFar, usualByToday, usualMonth,
    pacePct: Math.round((spentSoFar / usualByToday) * 100),
    forecast: Math.round(spentSoFar + restOfMonth),
    early: day < 5,
    monthsCompared: partials.length,
    bigOneOff,
  };
}

// ─── Category totals + changes ───────────────────────────────────────────────

export interface CategoryTotal { category: Category; amount: number; count: number }

export function categoryTotals(txs: Tx[], categories: Category[], p: Period): CategoryTotal[] {
  const byId = new Map(categories.map(c => [c.id, c] as const));
  const acc = new Map<string, { debit: number; refund: number; count: number }>();
  for (const t of inRange(txs, p)) {
    if (t.type !== 'DEBIT' && t.type !== 'REFUND') continue;
    const key = t.categoryId ?? UNCATEGORIZED.id;
    const row = acc.get(key) ?? { debit: 0, refund: 0, count: 0 };
    if (t.type === 'DEBIT') { row.debit += t.amount; row.count++; } else row.refund += t.amount;
    acc.set(key, row);
  }
  return [...acc.entries()]
    .map(([id, r]) => ({ category: byId.get(id) ?? UNCATEGORIZED, amount: Math.max(0, r.debit - r.refund), count: r.count }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export interface CategoryChange {
  category: Category;
  last: number;      // spend in the last complete month
  usual: number;     // average of the months before it
  diff: number;
  changePct: number | null; // null when there was no usual spend (new category)
}

/** Last complete month vs the average of the up-to-3 months before it. */
export function categoryChanges(txs: Tx[], categories: Category[], now: Date): { monthLabel: string; changes: CategoryChange[] } {
  const last = monthsAgo(now, 1);
  const base: Period[] = [2, 3, 4].map(i => monthsAgo(now, i)).filter(p => hasData(txs, p));
  if (!hasData(txs, last) || base.length === 0) return { monthLabel: last.label, changes: [] };

  const lastTotals = new Map(categoryTotals(txs, categories, last).map(r => [r.category.id, r] as const));
  const baseSums = new Map<string, { category: Category; sum: number }>();
  for (const p of base) {
    for (const r of categoryTotals(txs, categories, p)) {
      const cur = baseSums.get(r.category.id) ?? { category: r.category, sum: 0 };
      cur.sum += r.amount;
      baseSums.set(r.category.id, cur);
    }
  }

  const ids = new Set([...lastTotals.keys(), ...baseSums.keys()]);
  const changes: CategoryChange[] = [];
  for (const id of ids) {
    const l = lastTotals.get(id)?.amount ?? 0;
    const usual = (baseSums.get(id)?.sum ?? 0) / base.length;
    const category = lastTotals.get(id)?.category ?? baseSums.get(id)!.category;
    const diff = l - usual;
    const changePct = usual > 0 ? (diff / usual) * 100 : null;
    const notable = Math.abs(diff) >= 1000 && (changePct == null ? l >= 2000 : Math.abs(changePct) >= 30);
    if (notable) changes.push({ category, last: l, usual, diff, changePct });
  }
  changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { monthLabel: last.label, changes: changes.slice(0, 6) };
}

// ─── Unusual spends ──────────────────────────────────────────────────────────

export interface Unusual { tx: Tx; reason: string }

/**
 * Recent debits that stand out: way above what you usually pay that merchant,
 * or among your very largest spends overall. Needs some history to judge.
 */
export function unusualSpends(txs: Tx[], now: Date, days = 30): Unusual[] {
  const debits = txs.filter(t => t.type === 'DEBIT').sort((a, b) => time(a) - time(b));
  if (debits.length < 10) return [];
  const since = now.getTime() - days * DAY_MS;
  const p98 = percentile(debits.map(t => t.amount), 98);

  const out: Unusual[] = [];
  for (const tx of debits) {
    if (time(tx) < since) continue;
    const key = normMerchant(tx.merchant);
    const prior = key ? debits.filter(d => time(d) < time(tx) && normMerchant(d.merchant) === key).map(d => d.amount) : [];
    if (prior.length >= 3) {
      // A regular merchant: judged ONLY against its own history. Rent at its
      // normal amount is big but expected — never "unusual".
      const med = median(prior);
      if (med > 0 && tx.amount >= 2.5 * med && tx.amount - med >= 500) {
        out.push({ tx, reason: `About ${Math.round(tx.amount / med)}× your usual ${inr(med)} at ${tx.merchant}` });
      }
      continue;
    }
    // New or rare merchant: flag only the very largest spends.
    if (debits.length >= 20 && tx.amount >= p98 && tx.amount >= 2000) {
      out.push({ tx, reason: 'One of your largest single spends in this period' });
    }
  }
  return out.sort((a, b) => b.tx.amount - a.tx.amount).slice(0, 5);
}

// ─── Repeating monthly charges (subscriptions, rent, EMIs …) ─────────────────

export interface RepeatCharge {
  merchant: string;        // latest display name
  monthly: number;         // typical (median) amount
  count: number;
  lastDate: string;
  lastAmount: number;
  prevAmount: number | null;
  priceUp: boolean;
}

/**
 * Finds merchants you pay roughly the same amount roughly every month. Rules:
 * 3+ payments in 6 months across 3+ different months, typical gap 25–35 days,
 * 80% of amounts within ±15% of the median, and still active (paid in the last
 * 45 days). Flags a price rise when the latest charge beats the previous by 4%+.
 */
export function repeatCharges(txs: Tx[], now: Date): { items: RepeatCharge[]; monthlyTotal: number } {
  const since = now.getTime() - 183 * DAY_MS;
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.type !== 'DEBIT' || time(t) < since) continue;
    const key = normMerchant(t.merchant);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const items: RepeatCharge[] = [];
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => time(a) - time(b));
    const months = new Set(list.map(t => { const d = new Date(t.date); return `${d.getFullYear()}-${d.getMonth()}`; }));
    if (months.size < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push((time(list[i]) - time(list[i - 1])) / DAY_MS);
    const gap = median(gaps);
    if (gap < 25 || gap > 35) continue;

    // Split into price "levels": consecutive charges within ±15% of the level's
    // first amount. Up to 2 levels = a steady charge that changed price at most
    // once (Netflix ₹499 → ₹649); the latest level is the current price.
    const levels: number[][] = [];
    for (const t of list) {
      const cur = levels[levels.length - 1];
      if (cur && Math.abs(t.amount - cur[0]) <= 0.15 * cur[0]) cur.push(t.amount);
      else levels.push([t.amount]);
    }
    if (levels.length > 2) continue;
    const latest = levels[levels.length - 1];
    if (levels.length === 2 && latest.length < 2) continue; // one odd charge, not a new price

    const last = list[list.length - 1];
    if (now.getTime() - time(last) > 45 * DAY_MS) continue;

    const monthly = median(latest);
    const prevLevel = levels.length === 2 ? median(levels[0]) : null;
    items.push({
      merchant: last.merchant,
      monthly: Math.round(monthly),
      count: list.length,
      lastDate: last.date,
      lastAmount: last.amount,
      prevAmount: prevLevel,
      priceUp: prevLevel != null && monthly > prevLevel * 1.04,
    });
  }
  items.sort((a, b) => b.monthly - a.monthly);
  return { items, monthlyTotal: items.reduce((s, i) => s + i.monthly, 0) };
}

// ─── Savings rate ────────────────────────────────────────────────────────────

export interface SavingsRate { label: string; income: number; spend: number; saved: number; rate: number | null }

export function savingsRate(txs: Tx[], p: Period): SavingsRate {
  const rows = inRange(txs, p);
  const income = incomeOf(rows);
  const spend = spendOf(rows);
  return { label: p.label, income, spend, saved: income - spend, rate: income > 0 ? ((income - spend) / income) * 100 : null };
}

// ─── Top merchants ───────────────────────────────────────────────────────────

export interface MerchantTotal { merchant: string; amount: number; count: number }

export function topMerchants(txs: Tx[], p: Period, n = 5): MerchantTotal[] {
  const acc = new Map<string, MerchantTotal>();
  for (const t of inRange(txs, p)) {
    if (t.type !== 'DEBIT') continue;
    const key = normMerchant(t.merchant) || t.merchant;
    const row = acc.get(key) ?? { merchant: t.merchant, amount: 0, count: 0 };
    row.amount += t.amount;
    row.count++;
    acc.set(key, row);
  }
  return [...acc.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

// ─── The assembled insights ──────────────────────────────────────────────────

export interface InsightsModel {
  hasData: boolean;
  series: MonthTotals[];
  pace: Pace | null;
  thisMonth: { label: string; spend: number; topCategories: CategoryTotal[]; topMerchants: MerchantTotal[] };
  changes: { monthLabel: string; changes: CategoryChange[] };
  unusual: Unusual[];
  repeats: { items: RepeatCharge[]; monthlyTotal: number };
  lastMonthSavings: SavingsRate | null;
  avgSavingsRate: number | null; // over up to 3 complete months with income
}

export function buildInsights(txs: Tx[], categories: Category[], now: Date): InsightsModel {
  const thisMonth = monthsAgo(now, 0);
  const last = monthsAgo(now, 1);

  const rates = [1, 2, 3]
    .map(i => monthsAgo(now, i))
    .filter(p => hasData(txs, p))
    .map(p => savingsRate(txs, p))
    .filter(r => r.rate != null);
  const avgSavingsRate = rates.length ? rates.reduce((s, r) => s + (r.rate ?? 0), 0) / rates.length : null;

  return {
    hasData: txs.length > 0,
    series: monthlySeries(txs, now, 6),
    pace: monthPace(txs, now),
    thisMonth: {
      label: thisMonth.label,
      spend: spendOf(inRange(txs, thisMonth)),
      topCategories: categoryTotals(txs, categories, thisMonth).slice(0, 5),
      topMerchants: topMerchants(txs, thisMonth, 5),
    },
    changes: categoryChanges(txs, categories, now),
    unusual: unusualSpends(txs, now),
    repeats: repeatCharges(txs, now),
    lastMonthSavings: hasData(txs, last) ? savingsRate(txs, last) : null,
    avgSavingsRate,
  };
}

export { monthPeriod };
