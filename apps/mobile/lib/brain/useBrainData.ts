import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '../api';
import { useSafetyNet } from '../safetyNet';
import type { Tx, Category } from './core';
import type { AskContext } from './ask';

// Everything the Velora Brain reads, in one hook. Only ONE new request
// (/transactions/history); the rest reuse the exact query keys the Home,
// Transactions, Loans and Savings screens already use, so their caches are shared.

interface HistoryResponse { from: string; months: number; truncated: boolean; transactions: Tx[] }
interface DashboardSlice {
  budgets: { data: { id: string; amount: number; spent: number; percentUsed: number; category: { name: string; icon: string } }[] };
  networth: { netWorth: number };
}
export interface BrainLoan {
  id: string; name: string; isActive: boolean; interestRate: number;
  emiAmount: number; outstandingBalance: number; remainingEmis: number;
}
export interface BrainGoal { id: string; name: string; icon: string; targetAmount: number; savedAmount: number; targetDate: string | null }

export const HISTORY_KEY = ['tx-history', 12];

export function useBrainData() {
  const { getToken } = useAuth();
  const token = async () => (await getToken())!;

  const history = useQuery<HistoryResponse>({
    queryKey: HISTORY_KEY,
    queryFn: async () => apiFetch<HistoryResponse>('/transactions/history?months=12', await token()),
    staleTime: 5 * 60_000,
  });
  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => apiFetch<Category[]>('/transactions/categories', await token()),
    staleTime: 10 * 60_000,
  });
  const dashboard = useQuery<DashboardSlice>({
    queryKey: ['dashboard'],
    queryFn: async () => apiFetch<DashboardSlice>('/dashboard/overview', await token()),
    staleTime: 2 * 60_000,
  });
  const loans = useQuery<BrainLoan[]>({
    queryKey: ['loans'],
    queryFn: async () => apiFetch<BrainLoan[]>('/loans', await token()),
    staleTime: 2 * 60_000,
  });
  const goals = useQuery<BrainGoal[]>({
    queryKey: ['goals'],
    queryFn: async () => apiFetch<BrainGoal[]>('/goals', await token()),
    staleTime: 2 * 60_000,
  });
  const safety = useSafetyNet();

  const txs = history.data?.transactions ?? [];
  const cats = categories.data ?? [];
  const activeLoans = (loans.data ?? []).filter(l => l.isActive && l.outstandingBalance > 0);

  const askContext = useMemo<AskContext>(() => ({
    now: new Date(),
    txs,
    categories: cats,
    historyFrom: history.data ? new Date(history.data.from) : null,
    budgets: (dashboard.data?.budgets?.data ?? []).map(b => ({
      name: b.category.name, icon: b.category.icon, amount: b.amount, spent: b.spent, percentUsed: b.percentUsed,
    })),
    netWorth: dashboard.data?.networth?.netWorth ?? null,
    survivalMonths: safety.survivalMonths,
    emergencyFund: safety.fund,
    essentialMonthly: safety.essentialMonthly,
    loans: loans.data ?? [],
  }), [txs, cats, history.data, dashboard.data, safety.survivalMonths, safety.fund, safety.essentialMonthly, loans.data]);

  return {
    txs,
    categories: cats,
    truncated: history.data?.truncated ?? false,
    loans: activeLoans,
    goals: goals.data ?? [],
    safety,
    askContext,
    loading: history.isLoading || categories.isLoading,
    error: history.isError,
    refreshing: history.isFetching || dashboard.isFetching || loans.isFetching,
    refetch: () => { history.refetch(); categories.refetch(); dashboard.refetch(); loans.refetch(); goals.refetch(); safety.refetch(); },
  };
}

export type BrainData = ReturnType<typeof useBrainData>;
