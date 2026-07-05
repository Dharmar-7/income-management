'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { apiFetch } from '@/lib/api';
import CustomSelect from '@/components/CustomSelect';

interface Category {
  id: string;
  name: string;
  icon: string;
}

interface BudgetWithProgress {
  id: string;
  amount: number;
  month: number;
  year: number;
  category: Category;
  spent: number;
  remaining: number;
  percentUsed: number;
}

interface BudgetsResponse {
  data: BudgetWithProgress[];
  month: number;
  year: number;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function BudgetManager() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // Add-budget form state
  const [showForm, setShowForm] = useState(false);
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formAmount, setFormAmount] = useState('');

  // Fetch budgets with progress for the selected month
  const { data, isLoading } = useQuery({
    queryKey: ['budgets', month, year],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<BudgetsResponse>(`/budgets?month=${month}&year=${year}`, token!);
    },
  });

  // Fetch all categories for the add-budget dropdown
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Category[]>('/transactions/categories', token!);
    },
  });

  // Upsert budget
  const upsertMutation = useMutation({
    mutationFn: async (body: { categoryId: string; amount: number; month: number; year: number }) => {
      const token = await getToken();
      return apiFetch('/budgets', token!, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', month, year] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setShowForm(false);
      setFormCategoryId('');
      setFormAmount('');
    },
  });

  // Delete budget
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      return apiFetch(`/budgets/${id}`, token!, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', month, year] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!formCategoryId || !formAmount) return;
    upsertMutation.mutate({
      categoryId: formCategoryId,
      amount: parseFloat(formAmount),
      month,
      year,
    });
  }

  // Categories that don't have a budget yet this month (to avoid duplicates in dropdown)
  const budgetedCategoryIds = new Set(data?.data.map(b => b.category.id) ?? []);
  const availableCategories = (categories ?? []).filter(c => !budgetedCategoryIds.has(c.id));

  return (
    <div className="space-y-4">
      {/* Month picker */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
        <CustomSelect
          value={String(month)}
          onChange={v => setMonth(Number(v))}
          placeholder="Month"
          options={MONTHS.map((name, i) => ({ value: String(i + 1), label: name, icon: '📅' }))}
        />
        <CustomSelect
          value={String(year)}
          onChange={v => setYear(Number(v))}
          placeholder="Year"
          options={[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => ({
            value: String(y), label: String(y),
          }))}
        />
        <span className="text-sm text-gray-400 dark:text-gray-500 ml-auto">
          {data?.data.length ?? 0} budget{data?.data.length !== 1 ? 's' : ''} set
        </span>
      </div>

      {/* Budget list */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-6 py-5 animate-pulse space-y-2">
                <div className="flex justify-between">
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-28" />
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-20" />
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full" />
              </div>
            ))}
          </div>
        ) : data?.data.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            No budgets set for {MONTHS[month - 1]} {year}. Add one below.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {data?.data.map(budget => {
              const isOver = budget.percentUsed >= 100;
              const isWarning = budget.percentUsed >= 80 && !isOver;
              const barColor = isOver
                ? 'bg-gradient-to-r from-red-500 to-rose-500'
                : isWarning
                ? 'bg-gradient-to-r from-amber-400 to-yellow-500'
                : 'bg-gradient-to-r from-emerald-400 to-teal-500';

              return (
                <div key={budget.id} className="px-6 py-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-lg">{budget.category.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900 dark:text-white text-sm">
                          {budget.category.name}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {formatINR(budget.spent)} of {formatINR(budget.amount)}
                          </span>
                          <button
                            onClick={() => deleteMutation.mutate(budget.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${budget.percentUsed}%` }}
                    />
                  </div>

                  <div className="flex justify-between mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                    <span>
                      {isOver
                        ? `${formatINR(Math.abs(budget.remaining))} over budget`
                        : `${formatINR(budget.remaining)} remaining`}
                    </span>
                    <span>{Math.round(budget.percentUsed)}% used</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add budget */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          disabled={availableCategories.length === 0}
          className="w-full rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 py-4 text-sm text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Set a budget for another category
        </button>
      ) : (
        <form
          onSubmit={handleAdd}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4"
        >
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">New Budget</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">Category</label>
              <CustomSelect
                value={formCategoryId}
                onChange={v => setFormCategoryId(v)}
                placeholder="Select category..."
                options={availableCategories.map(c => ({ value: c.id, label: c.name, icon: c.icon }))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">Monthly limit (₹)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={formAmount}
                onChange={e => setFormAmount(e.target.value)}
                placeholder="e.g. 5000"
                required
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormCategoryId(''); setFormAmount(''); }}
              className="rounded-full border border-gray-200 dark:border-gray-600 dark:text-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={upsertMutation.isPending}
              className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 shadow-md shadow-indigo-200"
            >
              {upsertMutation.isPending ? 'Saving...' : 'Save Budget'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
