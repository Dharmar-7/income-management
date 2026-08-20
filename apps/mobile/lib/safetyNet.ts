import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// Safety Net — "if my income stops today, how long can I last?"
//
// Runway = emergency fund ÷ essential monthly burn.
//
// Two honesty problems the app's data model forces us to solve here:
//  1. There is NO bank-balance concept — the only liquid figures the app knows
//     are cash-in-hand + investment values. So the fund is a number the USER
//     sets (pre-filled with a smart estimate), stored on-device.
//  2. Categories have no "essential" flag — so we ship a sensible default split
//     and let the user reclassify any category (also on-device).
//
// Burn is computed from REAL transactions (statement imports already include
// EMIs/rent), so loan EMIs are shown only as an informational "fixed
// commitments" figure — never added on top, which would double-count.
// ─────────────────────────────────────────────────────────────────────────────

// Bias: when unsure, treat spend as ESSENTIAL — better to under-state runway
// than to promise months you don't have. Only the clearly-discretionary
// category names are optional-by-default; everything else (Groceries, Utilities,
// Health, Insurance, Fuel, Finance, Education, Other, …) counts as essential.
const OPTIONAL_CATEGORIES = new Set([
  'Food & Dining', 'Snack', 'Shopping', 'Entertainment',
  'Flight', 'Cab & Auto', 'Travel', 'Transport',
]);

export function defaultEssential(categoryName: string): boolean {
  return !OPTIONAL_CATEGORIES.has(categoryName);
}

// Investment types realistically sellable within days if income stops. FDs/RDs/
// PostOffice/EPF/NPS are locked or penalised, so they're left OUT of the auto
// estimate — the user can always override the fund with their real number.
const LIQUID_SAVING_TYPES = new Set(['STOCKS', 'MUTUAL_FUNDS', 'GOLD']);

function monthlyAmount(amount: number, freq: string): number {
  if (freq === 'WEEKLY') return (amount * 52) / 12;
  if (freq === 'YEARLY') return amount / 12;
  return amount; // MONTHLY
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

// A runway expressed in the friendliest unit: weeks when short, months in the
// mid-range, years once it's comfortable. null = not computable yet.
export function formatMonths(m: number | null): string {
  if (m == null || !isFinite(m)) return '—';
  if (m >= 24) return `${(m / 12).toFixed(1)} yrs`;
  if (m >= 1) return `${m.toFixed(1)} mo`;
  const weeks = Math.max(1, Math.round(m * 4.345));
  return `${weeks} wk${weeks === 1 ? '' : 's'}`;
}

// ─── API row shapes (only the fields we consume) ─────────────────────────────

interface CashBalance { balance: number; totalIn: number; totalOut: number }
interface SavingRow { id: string; type: string; currentValue: number; sipAmount: number | null }
interface LoanRow { id: string; emiAmount: number; isActive: boolean }
interface RecurringRow {
  id: string; amount: number; type: string;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY'; isActive: boolean;
  category: { name: string; icon: string } | null;
}
interface CategoryAverages {
  months: number;
  perCategory: { name: string; icon: string; avgMonthly: number }[];
  totalAvgMonthly: number;
  uncategorizedAvgMonthly: number;
}
interface SafetyData {
  cash: CashBalance;
  savings: SavingRow[];
  loans: LoanRow[];
  recurring: RecurringRow[];
  averages: CategoryAverages;
}

// ─── On-device preference stores (zero-Neon, same pattern as useJobFinder) ───

// Emergency fund override. null → use the auto estimate.
const FUND_KEY = 'velora-safety-fund';
export function useEmergencyFund() {
  const qc = useQueryClient();
  const { data: fund = null } = useQuery<number | null>({
    queryKey: ['pref', 'safetyFund'],
    queryFn: async () => {
      const v = await AsyncStorage.getItem(FUND_KEY);
      return v == null || v === '' ? null : Number(v);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function setFund(next: number | null) {
    if (next == null || !isFinite(next)) await AsyncStorage.removeItem(FUND_KEY);
    else await AsyncStorage.setItem(FUND_KEY, String(Math.round(next)));
    qc.setQueryData(['pref', 'safetyFund'], next == null ? null : Math.round(next));
  }

  return { fund, setFund };
}

// Per-category essential/optional overrides, keyed by category NAME.
const ESSENTIAL_KEY = 'velora-essential-overrides';
export function useEssentialOverrides() {
  const qc = useQueryClient();
  const { data: overrides = {} } = useQuery<Record<string, boolean>>({
    queryKey: ['pref', 'essentialOverrides'],
    queryFn: async () => {
      const v = await AsyncStorage.getItem(ESSENTIAL_KEY);
      return v ? (JSON.parse(v) as Record<string, boolean>) : {};
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function setEssential(name: string, essential: boolean) {
    const next = { ...overrides, [name]: essential };
    await AsyncStorage.setItem(ESSENTIAL_KEY, JSON.stringify(next));
    qc.setQueryData(['pref', 'essentialOverrides'], next);
  }

  return { overrides, setEssential };
}

// The "what-if" trim set: ids of optional levers the user has toggled off to
// see their runway extend. Purely a projection — it never mutates real data.
const TRIM_KEY = 'velora-safety-trim';
export function useTrimmed() {
  const qc = useQueryClient();
  const { data: trimmed = [] } = useQuery<string[]>({
    queryKey: ['pref', 'safetyTrim'],
    queryFn: async () => {
      const v = await AsyncStorage.getItem(TRIM_KEY);
      return v ? (JSON.parse(v) as string[]) : [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function toggleTrim(id: string) {
    const set = new Set(trimmed);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set];
    await AsyncStorage.setItem(TRIM_KEY, JSON.stringify(next));
    qc.setQueryData(['pref', 'safetyTrim'], next);
  }

  return { trimmed, toggleTrim };
}

// The first-week action plan: ids of tasks the user has ticked off. The task
// list itself (labels/links) lives in the checklist component; here we only
// persist which are done, on-device.
const PLAN_KEY = 'velora-first-week-plan';
export function useFirstWeekPlan() {
  const qc = useQueryClient();
  const { data: done = [] } = useQuery<string[]>({
    queryKey: ['pref', 'firstWeekPlan'],
    queryFn: async () => {
      const v = await AsyncStorage.getItem(PLAN_KEY);
      return v ? (JSON.parse(v) as string[]) : [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function toggleTask(id: string) {
    const set = new Set(done);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set];
    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(next));
    qc.setQueryData(['pref', 'firstWeekPlan'], next);
  }

  return { done, toggleTask };
}

// ─── The assembled model ─────────────────────────────────────────────────────

export interface CategorySpend { name: string; icon: string; avgMonthly: number; essential: boolean }
export interface TrimItem { id: string; label: string; icon: string; monthly: number }

export interface SafetyNetModel {
  // fund
  cashInHand: number;
  liquidInvestments: number;
  suggestedFund: number;
  fund: number;
  fundIsCustom: boolean;
  // monthly burn
  essentialMonthly: number;      // essential categories + uncategorised (conservative)
  optionalMonthly: number;
  sipMonthly: number;
  uncategorizedMonthly: number;
  // fixed commitments (informational — already inside the burn above)
  emiMonthly: number;
  essentialRecurringMonthly: number;
  // runway (months) — null when not computable
  survivalMonths: number | null;   // essentials only (optional cut, SIPs paused)
  currentMonths: number | null;    // everything as-is
  trimmedMonths: number | null;    // essentials + whatever optional is left un-trimmed
  monthsAveraged: number;
  hasData: boolean;
  // detail
  categories: CategorySpend[];
  trimItems: TrimItem[];
}

const EMPTY_MODEL: SafetyNetModel = {
  cashInHand: 0, liquidInvestments: 0, suggestedFund: 0, fund: 0, fundIsCustom: false,
  essentialMonthly: 0, optionalMonthly: 0, sipMonthly: 0, uncategorizedMonthly: 0,
  emiMonthly: 0, essentialRecurringMonthly: 0,
  survivalMonths: null, currentMonths: null, trimmedMonths: null,
  monthsAveraged: 0, hasData: false, categories: [], trimItems: [],
};

// Pure — everything the runway needs, given raw data + the user's on-device
// preferences. Kept side-effect-free so the math is trivial to reason about.
export function computeSafetyNet(
  data: SafetyData | undefined,
  fundOverride: number | null,
  overrides: Record<string, boolean>,
  trimmed: string[],
): SafetyNetModel {
  if (!data) return EMPTY_MODEL;

  const cashInHand = data.cash?.balance ?? 0;
  const liquidInvestments = (data.savings ?? [])
    .filter(s => LIQUID_SAVING_TYPES.has(s.type))
    .reduce((sum, s) => sum + (s.currentValue ?? 0), 0);
  const suggestedFund = cashInHand + liquidInvestments;
  const fundIsCustom = fundOverride != null;
  const fund = fundIsCustom ? fundOverride! : suggestedFund;

  const categories: CategorySpend[] = (data.averages?.perCategory ?? []).map(cat => ({
    name: cat.name,
    icon: cat.icon,
    avgMonthly: cat.avgMonthly,
    essential: overrides[cat.name] ?? defaultEssential(cat.name),
  }));

  const uncategorizedMonthly = data.averages?.uncategorizedAvgMonthly ?? 0;
  const essentialCats = categories.filter(c => c.essential).reduce((s, c) => s + c.avgMonthly, 0);
  const optionalMonthly = categories.filter(c => !c.essential).reduce((s, c) => s + c.avgMonthly, 0);
  const essentialMonthly = essentialCats + uncategorizedMonthly; // unknown spend → treated as unavoidable

  const sipMonthly = (data.savings ?? []).reduce((s, sv) => s + (sv.sipAmount ?? 0), 0);
  const emiMonthly = (data.loans ?? []).filter(l => l.isActive).reduce((s, l) => s + (l.emiAmount ?? 0), 0);
  const essentialRecurringMonthly = (data.recurring ?? [])
    .filter(r => r.isActive && r.type === 'DEBIT'
      && (overrides[r.category?.name ?? ''] ?? defaultEssential(r.category?.name ?? 'Other')))
    .reduce((s, r) => s + monthlyAmount(r.amount, r.frequency), 0);

  // Trim levers = optional categories + one "pause SIPs" lever.
  const trimItems: TrimItem[] = [
    ...categories
      .filter(c => !c.essential && c.avgMonthly > 0)
      .map(c => ({ id: `cat:${c.name}`, label: c.name, icon: c.icon, monthly: c.avgMonthly })),
    ...(sipMonthly > 0 ? [{ id: 'sip', label: 'Pause SIP investments', icon: '📈', monthly: sipMonthly }] : []),
  ];
  const trimmedSet = new Set(trimmed);
  const untrimmedLevers = trimItems
    .filter(t => !trimmedSet.has(t.id))
    .reduce((s, t) => s + t.monthly, 0);

  const survivalBurn = essentialMonthly;                         // cut all optional + SIPs
  const currentBurn = essentialMonthly + optionalMonthly + sipMonthly;
  const trimmedBurn = essentialMonthly + untrimmedLevers;        // whatever optional/SIP is left on

  const months = (burn: number): number | null => (fund > 0 && burn > 0 ? fund / burn : null);
  const hasData = (data.averages?.totalAvgMonthly ?? 0) > 0;

  return {
    cashInHand, liquidInvestments, suggestedFund, fund, fundIsCustom,
    essentialMonthly, optionalMonthly, sipMonthly, uncategorizedMonthly,
    emiMonthly, essentialRecurringMonthly,
    survivalMonths: months(survivalBurn),
    currentMonths: months(currentBurn),
    trimmedMonths: months(trimmedBurn),
    monthsAveraged: data.averages?.months ?? 0,
    hasData,
    categories, trimItems,
  };
}

// ─── The hook screens/cards consume ──────────────────────────────────────────

export function useSafetyNet() {
  const { getToken } = useAuth();
  const { fund: fundOverride } = useEmergencyFund();
  const { overrides } = useEssentialOverrides();
  const { trimmed } = useTrimmed();

  const q = useQuery<SafetyData>({
    queryKey: ['safety-net'],
    queryFn: async () => {
      const token = await getToken();
      const [cash, savings, loans, recurring, averages] = await Promise.all([
        apiFetch<CashBalance>('/cash/balance', token!),
        apiFetch<SavingRow[]>('/savings', token!),
        apiFetch<LoanRow[]>('/loans', token!),
        apiFetch<RecurringRow[]>('/recurring', token!),
        apiFetch<CategoryAverages>('/reports/category-averages?months=3', token!),
      ]);
      return { cash, savings, loans, recurring, averages };
    },
    staleTime: 2 * 60 * 1000,
  });

  const model = useMemo(
    () => computeSafetyNet(q.data, fundOverride, overrides, trimmed),
    [q.data, fundOverride, overrides, trimmed],
  );

  return {
    ...model,
    loading: q.isLoading,
    error: q.isError,
    refetch: () => q.refetch(),
    refreshing: q.isFetching,
  };
}
