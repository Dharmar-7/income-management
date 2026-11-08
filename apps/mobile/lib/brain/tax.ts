// Velora Brain — old vs new income-tax regime calculator (India, individual).
//
// The RULES table is data, not logic: after each Union Budget, update the table
// (and its `fy` label) — the maths below doesn't change. Current table: FY
// 2025-26 (AY 2026-27). Scope, stated to the user in the UI: salary/business-
// style income at normal slab rates. NOT included — surcharge (income > ₹50L),
// capital gains (taxed at special rates), employer NPS 80CCD(2), and the many
// niche deductions. It's an estimate to choose a regime, not a filing tool.

import { inr } from './core';

interface Slab { upTo: number | null; rate: number } // rate in %, upTo = slab ceiling (null = no ceiling)

export const RULES = {
  fy: '2025-26',
  cessPct: 4,
  surchargeAbove: 5_000_000,
  newRegime: {
    standardDeduction: 75_000,
    rebateIncomeLimit: 1_200_000, // 87A: no tax up to this taxable income…
    rebateMax: 60_000,            // …via a rebate of up to this; marginal relief just above
    slabs: [
      { upTo: 400_000, rate: 0 },
      { upTo: 800_000, rate: 5 },
      { upTo: 1_200_000, rate: 10 },
      { upTo: 1_600_000, rate: 15 },
      { upTo: 2_000_000, rate: 20 },
      { upTo: 2_400_000, rate: 25 },
      { upTo: null, rate: 30 },
    ] as Slab[],
  },
  oldRegime: {
    standardDeduction: 50_000,
    rebateIncomeLimit: 500_000,
    rebateMax: 12_500,
    slabs: {
      below60: [
        { upTo: 250_000, rate: 0 }, { upTo: 500_000, rate: 5 }, { upTo: 1_000_000, rate: 20 }, { upTo: null, rate: 30 },
      ] as Slab[],
      senior: [ // 60–79
        { upTo: 300_000, rate: 0 }, { upTo: 500_000, rate: 5 }, { upTo: 1_000_000, rate: 20 }, { upTo: null, rate: 30 },
      ] as Slab[],
      superSenior: [ // 80+
        { upTo: 500_000, rate: 0 }, { upTo: 1_000_000, rate: 20 }, { upTo: null, rate: 30 },
      ] as Slab[],
    },
    caps: {
      sec80C: 150_000,
      sec80dSelf: 25_000,
      sec80dSelfSenior: 50_000,
      sec80dParents: 25_000,
      sec80dParentsSenior: 50_000,
      nps80ccd1b: 50_000,
      homeLoan24b: 200_000,
    },
  },
};

export interface TaxInput {
  grossIncome: number;       // annual
  salaried: boolean;         // gets the standard deduction
  age: number | null;
  // old-regime deductions (ignored by the new regime)
  sec80C: number;
  sec80dSelf: number;
  sec80dParents: number;
  parentsSenior: boolean;
  nps80ccd1b: number;
  hraExemption: number;
  homeLoanInterest: number;
  otherDeductions: number;
}

export const EMPTY_TAX_INPUT: TaxInput = {
  grossIncome: 0, salaried: true, age: null,
  sec80C: 0, sec80dSelf: 0, sec80dParents: 0, parentsSenior: false,
  nps80ccd1b: 0, hraExemption: 0, homeLoanInterest: 0, otherDeductions: 0,
};

export interface RegimeResult {
  regime: 'old' | 'new';
  deductions: { label: string; amount: number }[];
  totalDeductions: number;
  taxable: number;
  slabTax: number;
  rebate: number;            // 87A rebate + any marginal relief
  cess: number;
  total: number;
  effectiveRate: number;     // total ÷ gross, %
}

export interface TaxComparison {
  fy: string;
  old: RegimeResult;
  new: RegimeResult;
  better: 'old' | 'new' | 'same';
  saving: number;
  /** When new wins: extra old-regime deductions needed for old to match it. */
  oldBreakEven: number | null;
  surchargeNote: boolean;
}

export function slabTax(income: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (income > lower) tax += (Math.min(income, upper) - lower) * (s.rate / 100);
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

const r0 = (n: number) => Math.round(Math.max(0, n));

function finish(regime: 'old' | 'new', gross: number, deductions: { label: string; amount: number }[], slabs: Slab[], rebateFn: (taxable: number, tax: number) => number): RegimeResult {
  const used = deductions.filter(d => d.amount > 0);
  const totalDeductions = used.reduce((s, d) => s + d.amount, 0);
  const taxable = r0(gross - totalDeductions);
  const st = slabTax(taxable, slabs);
  const rebate = Math.min(st, rebateFn(taxable, st));
  const afterRebate = st - rebate;
  const cess = afterRebate * (RULES.cessPct / 100);
  const total = afterRebate + cess;
  return {
    regime, deductions: used, totalDeductions: r0(totalDeductions), taxable,
    slabTax: r0(st), rebate: r0(rebate), cess: r0(cess), total: r0(total),
    effectiveRate: gross > 0 ? (total / gross) * 100 : 0,
  };
}

export function computeNew(input: TaxInput): RegimeResult {
  const R = RULES.newRegime;
  const deductions = input.salaried ? [{ label: 'Standard deduction', amount: R.standardDeduction }] : [];
  return finish('new', input.grossIncome, deductions, R.slabs, (taxable, tax) => {
    if (taxable <= R.rebateIncomeLimit) return Math.min(tax, R.rebateMax);
    // Marginal relief: tax can't exceed the income above the rebate limit.
    const excess = taxable - R.rebateIncomeLimit;
    return tax > excess ? tax - excess : 0;
  });
}

export function computeOld(input: TaxInput, extraDeduction = 0): RegimeResult {
  const R = RULES.oldRegime;
  const C = R.caps;
  const age = input.age ?? 0;
  const slabs = age >= 80 ? R.slabs.superSenior : age >= 60 ? R.slabs.senior : R.slabs.below60;
  const deductions = [
    { label: 'Standard deduction', amount: input.salaried ? R.standardDeduction : 0 },
    { label: '80C (ELSS, PPF, EPF…)', amount: Math.min(input.sec80C, C.sec80C) },
    { label: '80D health insurance (self/family)', amount: Math.min(input.sec80dSelf, age >= 60 ? C.sec80dSelfSenior : C.sec80dSelf) },
    { label: '80D health insurance (parents)', amount: Math.min(input.sec80dParents, input.parentsSenior ? C.sec80dParentsSenior : C.sec80dParents) },
    { label: '80CCD(1B) NPS', amount: Math.min(input.nps80ccd1b, C.nps80ccd1b) },
    { label: 'HRA exemption', amount: Math.max(0, input.hraExemption) },
    { label: 'Home loan interest 24(b)', amount: Math.min(input.homeLoanInterest, C.homeLoan24b) },
    { label: 'Other deductions', amount: Math.max(0, input.otherDeductions) },
    ...(extraDeduction > 0 ? [{ label: 'Extra (what-if)', amount: extraDeduction }] : []),
  ];
  return finish('old', input.grossIncome, deductions, slabs, (taxable, tax) =>
    taxable <= R.rebateIncomeLimit ? Math.min(tax, R.rebateMax) : 0,
  );
}

export function compareRegimes(input: TaxInput): TaxComparison {
  const oldR = computeOld(input);
  const newR = computeNew(input);
  const diff = oldR.total - newR.total;
  const better: TaxComparison['better'] = Math.abs(diff) < 1 ? 'same' : diff > 0 ? 'new' : 'old';

  // If new wins, how much MORE old-regime deduction would make old match it?
  let oldBreakEven: number | null = null;
  if (better === 'new') {
    let lo = 0, hi = Math.max(0, input.grossIncome);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (computeOld(input, mid).total <= newR.total) hi = mid; else lo = mid;
    }
    oldBreakEven = Math.ceil(hi / 1000) * 1000;
  }

  return {
    fy: RULES.fy,
    old: oldR,
    new: newR,
    better,
    saving: r0(Math.abs(diff)),
    oldBreakEven,
    surchargeNote: input.grossIncome > RULES.surchargeAbove,
  };
}

export function verdictLine(c: TaxComparison): string {
  if (c.better === 'same') return `Both regimes come to about ${inr(c.new.total)}.`;
  const name = c.better === 'new' ? 'New' : 'Old';
  return `${name} regime saves you ${inr(c.saving)} (${inr(Math.min(c.old.total, c.new.total))} vs ${inr(Math.max(c.old.total, c.new.total))}).`;
}
