// ─────────────────────────────────────────────────────────────────────────────
// Stock "fundamentals health check" — a rules-of-thumb scorecard, NOT buy/sell
// advice. You enter the numbers; it rates each metric good / ok / weak and rolls
// them into an overall read (Strong / Mixed / Weak) with the reasons.
//
// Everything is pure + on-device. Thresholds are sector-aware because the same
// number means very different things across sectors — a bank is meant to carry
// heavy debt; a software firm isn't. 'na' marks a metric that just isn't a
// meaningful signal for a given sector, so it's skipped rather than mis-scored.
// ─────────────────────────────────────────────────────────────────────────────

export type Sector = 'general' | 'it' | 'bank' | 'fmcg' | 'manufacturing' | 'pharma' | 'utility';

export const SECTORS: { key: Sector; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'it', label: 'IT / Tech' },
  { key: 'bank', label: 'Bank / NBFC' },
  { key: 'fmcg', label: 'FMCG / Consumer' },
  { key: 'manufacturing', label: 'Manufacturing' },
  { key: 'pharma', label: 'Pharma / Health' },
  { key: 'utility', label: 'Utility / Infra' },
];

export type Rating = 'good' | 'ok' | 'weak';
export type MetricCategory = 'Valuation' | 'Profitability' | 'Financial health' | 'Growth';

interface Band { good: number; ok: number }
interface MetricDef {
  key: string;
  label: string;
  category: MetricCategory;
  unit: string;              // '%', 'x', ''
  dir: 'low' | 'high';       // 'low' = a smaller number is better
  base: Band;                // general-sector thresholds
  bySector?: Partial<Record<Sector, Band | 'na'>>;
  positiveOnly?: boolean;    // e.g. a P/E ≤ 0 means loss-making → weak
  hints: { good: string; ok: string; weak: string };
}

// Ordered by category. `good`/`ok` read as: value crosses `good` → good, else
// crosses `ok` → ok, else weak (direction depends on `dir`).
export const METRICS: MetricDef[] = [
  // ── Valuation (is it cheap or expensive?) ──
  {
    key: 'pe', label: 'P/E ratio', category: 'Valuation', unit: 'x', dir: 'low', positiveOnly: true,
    base: { good: 15, ok: 25 },
    bySector: {
      it: { good: 25, ok: 40 }, bank: { good: 15, ok: 22 }, fmcg: { good: 35, ok: 55 },
      pharma: { good: 25, ok: 40 }, manufacturing: { good: 18, ok: 30 }, utility: { good: 14, ok: 22 },
    },
    hints: { good: 'reasonably valued on earnings', ok: 'fairly valued on earnings', weak: 'looks expensive (or loss-making)' },
  },
  {
    key: 'pb', label: 'P/B ratio', category: 'Valuation', unit: 'x', dir: 'low', positiveOnly: true,
    base: { good: 1.5, ok: 3 },
    bySector: {
      it: { good: 6, ok: 12 }, bank: { good: 1.5, ok: 3 }, fmcg: { good: 8, ok: 15 },
      pharma: { good: 4, ok: 8 }, manufacturing: { good: 2.5, ok: 5 }, utility: { good: 2, ok: 3.5 },
    },
    hints: { good: 'trading near book value', ok: 'a fair premium to book', weak: 'a steep premium to book' },
  },
  {
    key: 'peg', label: 'PEG ratio', category: 'Valuation', unit: 'x', dir: 'low', positiveOnly: true,
    base: { good: 1, ok: 2 },
    hints: { good: 'cheap relative to its growth', ok: 'fair relative to its growth', weak: 'pricey relative to its growth' },
  },
  {
    key: 'evEbitda', label: 'EV / EBITDA', category: 'Valuation', unit: 'x', dir: 'low', positiveOnly: true,
    base: { good: 8, ok: 14 },
    bySector: {
      it: { good: 15, ok: 25 }, bank: 'na', fmcg: { good: 18, ok: 30 },
      pharma: { good: 12, ok: 20 }, manufacturing: { good: 8, ok: 14 }, utility: { good: 9, ok: 14 },
    },
    hints: { good: 'modest value on cash profits', ok: 'reasonable value on cash profits', weak: 'richly valued on cash profits' },
  },

  // ── Profitability (is it a good business?) ──
  {
    key: 'roe', label: 'ROE', category: 'Profitability', unit: '%', dir: 'high',
    base: { good: 18, ok: 12 },
    bySector: { utility: { good: 12, ok: 8 } },
    hints: { good: 'strong return on equity', ok: 'decent return on equity', weak: 'weak return on equity' },
  },
  {
    key: 'roce', label: 'ROCE', category: 'Profitability', unit: '%', dir: 'high',
    base: { good: 18, ok: 12 },
    bySector: { bank: 'na', utility: { good: 12, ok: 8 } },
    hints: { good: 'capital is working hard', ok: 'acceptable use of capital', weak: 'capital returns look thin' },
  },
  {
    key: 'netMargin', label: 'Net profit margin', category: 'Profitability', unit: '%', dir: 'high',
    base: { good: 10, ok: 4 },
    bySector: {
      it: { good: 15, ok: 8 }, fmcg: { good: 12, ok: 6 }, manufacturing: { good: 8, ok: 3 }, bank: { good: 18, ok: 10 },
    },
    hints: { good: 'healthy profitability', ok: 'modest profitability', weak: 'thin or negative margins' },
  },

  // ── Financial health (can it survive a bad year?) ──
  {
    key: 'de', label: 'Debt / Equity', category: 'Financial health', unit: 'x', dir: 'low',
    base: { good: 0.5, ok: 1 },
    bySector: {
      bank: 'na', it: { good: 0.3, ok: 0.7 }, utility: { good: 1.2, ok: 2 }, manufacturing: { good: 0.7, ok: 1.5 },
    },
    hints: { good: 'low debt', ok: 'manageable debt', weak: 'carries heavy debt' },
  },
  {
    key: 'current', label: 'Current ratio', category: 'Financial health', unit: 'x', dir: 'high',
    base: { good: 1.5, ok: 1 },
    bySector: { bank: 'na' },
    hints: { good: 'comfortable short-term liquidity', ok: 'adequate short-term liquidity', weak: 'tight short-term liquidity' },
  },
  {
    key: 'interestCover', label: 'Interest coverage', category: 'Financial health', unit: 'x', dir: 'high',
    base: { good: 4, ok: 2 },
    bySector: { bank: 'na' },
    hints: { good: 'easily covers its interest', ok: 'covers its interest', weak: 'struggles to cover interest' },
  },

  // ── Growth (is it getting bigger?) ──
  {
    key: 'revGrowth', label: 'Revenue growth (YoY)', category: 'Growth', unit: '%', dir: 'high',
    base: { good: 15, ok: 7 },
    hints: { good: 'sales growing fast', ok: 'sales growing steadily', weak: 'sales flat or shrinking' },
  },
  {
    key: 'epsGrowth', label: 'Profit growth (YoY)', category: 'Growth', unit: '%', dir: 'high',
    base: { good: 15, ok: 8 },
    hints: { good: 'profits rising strongly', ok: 'profits rising', weak: 'profits flat or falling' },
  },
];

export interface MetricResult {
  key: string; label: string; category: MetricCategory;
  value: number; unit: string; rating: Rating; hint: string;
}
export interface CategoryResult {
  name: MetricCategory; scored: number; pct: number | null; results: MetricResult[];
}
export interface GrowthProfile {
  label: 'High-growth' | 'Steady grower' | 'Slow grower' | 'Shrinking';
  emoji: string;
  growthRate: number;   // blended rev/EPS growth used
  parts: string[];      // e.g. ['revenue +22%', 'profit +18%']
  quality: string;      // ROE/ROCE-based note, may be ''
  tone: Rating;
}
export interface ValueGauge {
  label: string;
  peg: number | null;
  derived: boolean;     // true = estimated from P/E ÷ growth
  fillPct: number;      // 0..100 attractiveness (higher = cheaper for its growth)
  tone: Rating | 'neutral';
  note: string;
}
export interface StockEvaluation {
  score: number | null;
  verdict: 'Strong' | 'Mixed' | 'Weak' | null;
  scoredCount: number;
  categories: CategoryResult[];
  naNotes: string[];
  // Forward-*ish* lenses — both describe the company TODAY, never predict price.
  growth: GrowthProfile | null;
  value: ValueGauge | null;
}

const CATEGORIES: MetricCategory[] = ['Valuation', 'Profitability', 'Financial health', 'Growth'];

function bandFor(m: MetricDef, sector: Sector): Band | 'na' {
  return m.bySector?.[sector] ?? m.base;
}

function rate(m: MetricDef, value: number, band: Band): Rating {
  if (m.positiveOnly && value <= 0) return 'weak';
  if (m.dir === 'low') return value <= band.good ? 'good' : value <= band.ok ? 'ok' : 'weak';
  return value >= band.good ? 'good' : value >= band.ok ? 'ok' : 'weak';
}

const points = (r: Rating) => (r === 'good' ? 2 : r === 'ok' ? 1 : 0);

function num(inputs: Record<string, string>, key: string): number | null {
  const raw = inputs[key];
  if (raw == null || raw.trim() === '') return null;
  const v = Number(raw.replace(/[^0-9.\-]/g, ''));
  return isFinite(v) ? v : null;
}

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}%`;

// Blended growth rate from whatever growth figures are present.
function blendedGrowth(inputs: Record<string, string>): number | null {
  const gs = [num(inputs, 'revGrowth'), num(inputs, 'epsGrowth')].filter((x): x is number => x != null);
  return gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null;
}

// "Is it growing?" — describes the company's CURRENT trajectory, not the future.
function growthProfile(inputs: Record<string, string>): GrowthProfile | null {
  const rev = num(inputs, 'revGrowth');
  const eps = num(inputs, 'epsGrowth');
  const g = blendedGrowth(inputs);
  if (g == null) return null;

  let label: GrowthProfile['label'];
  let emoji: string;
  let tone: Rating;
  if (g >= 18) { label = 'High-growth'; emoji = '🚀'; tone = 'good'; }
  else if (g >= 8) { label = 'Steady grower'; emoji = '📈'; tone = 'good'; }
  else if (g >= 0) { label = 'Slow grower'; emoji = '🐢'; tone = 'ok'; }
  else { label = 'Shrinking'; emoji = '📉'; tone = 'weak'; }

  const parts: string[] = [];
  if (rev != null) parts.push(`revenue ${fmtPct(rev)}`);
  if (eps != null) parts.push(`profit ${fmtPct(eps)}`);

  // High, self-funded returns are what let growth compound without diluting.
  const roe = num(inputs, 'roe');
  const r = roe ?? num(inputs, 'roce');
  const rLabel = roe != null ? 'ROE' : 'ROCE';
  let quality = '';
  if (r != null) {
    const desc = r < 0 ? 'currently loss-making'
      : r >= 18 ? 'high returns — compounds well on its own'
        : r >= 12 ? 'solid returns'
          : 'modest returns — growth may need outside capital';
    quality = `${rLabel} ${r}% — ${desc}`;
  }

  return { label, emoji, growthRate: g, parts, quality, tone };
}

// "Is that growth already in the price?" — PEG (entered, or P/E ÷ growth). This
// is the honest counterweight: fast growth you overpay for is often a worse buy
// than steady growth at a fair price.
function valueGauge(inputs: Record<string, string>): ValueGauge | null {
  const pegIn = num(inputs, 'peg');
  const pe = num(inputs, 'pe');
  const g = blendedGrowth(inputs);

  let peg: number | null = null;
  let derived = false;
  if (pegIn != null && pegIn > 0) peg = pegIn;
  else if (pe != null && pe > 0 && g != null && g > 0) { peg = pe / g; derived = true; }

  if (peg == null) {
    // Enough valuation info but no growth → PEG is undefined; say so honestly.
    if ((pegIn != null || pe != null) && g != null && g <= 0) {
      return {
        label: 'Not growing — PEG doesn’t apply', peg: null, derived: false, fillPct: 0, tone: 'neutral',
        note: 'With little or no growth, PEG isn’t meaningful — judge the price on P/E and P/B instead.',
      };
    }
    return null;
  }

  let label: string;
  let tone: Rating;
  if (peg <= 1) { label = 'Cheap for its growth'; tone = 'good'; }
  else if (peg <= 2) { label = 'Fairly priced for its growth'; tone = 'ok'; }
  else { label = 'Expensive for its growth'; tone = 'weak'; }

  const phrase = peg <= 1 ? 'the price looks modest for how fast it’s growing'
    : peg <= 2 ? 'the growth looks mostly priced in'
      : 'you’d be paying up for the growth';
  const source = derived ? `Estimated PEG ~${peg.toFixed(1)} (P/E ÷ growth)` : `PEG ${peg.toFixed(1)}`;
  const fillPct = Math.max(0, Math.min(100, Math.round((1 - Math.min(peg, 3) / 3) * 100)));

  return { label, peg, derived, fillPct, tone, note: `${source} — ${phrase}.` };
}

// Pure. `inputs` maps metric key → raw string from the form. Only metrics the
// user actually filled in are scored; sector-'na' metrics are noted and skipped.
export function evaluateStock(inputs: Record<string, string>, sector: Sector): StockEvaluation {
  const byCat = new Map<MetricCategory, MetricResult[]>(CATEGORIES.map(c => [c, []]));
  const naNotes: string[] = [];
  let totalPts = 0;
  let totalScored = 0;

  for (const m of METRICS) {
    const raw = inputs[m.key];
    if (raw == null || raw.trim() === '') continue;
    const value = Number(raw.replace(/[^0-9.\-]/g, ''));
    if (!isFinite(value)) continue;

    const band = bandFor(m, sector);
    if (band === 'na') {
      naNotes.push(`${m.label} isn’t a meaningful signal for this sector — skipped.`);
      continue;
    }

    const rating = rate(m, value, band);
    const hint = rating === 'good' ? m.hints.good : rating === 'ok' ? m.hints.ok : m.hints.weak;
    byCat.get(m.category)!.push({ key: m.key, label: m.label, category: m.category, value, unit: m.unit, rating, hint });
    totalPts += points(rating);
    totalScored += 1;
  }

  const categories: CategoryResult[] = CATEGORIES.map(name => {
    const results = byCat.get(name)!;
    const pts = results.reduce((s, r) => s + points(r.rating), 0);
    return { name, scored: results.length, pct: results.length ? Math.round((100 * pts) / (2 * results.length)) : null, results };
  });

  const score = totalScored ? Math.round((100 * totalPts) / (2 * totalScored)) : null;
  const verdict = score == null ? null : score >= 70 ? 'Strong' : score >= 45 ? 'Mixed' : 'Weak';

  return {
    score, verdict, scoredCount: totalScored, categories, naNotes,
    growth: growthProfile(inputs),
    value: valueGauge(inputs),
  };
}
