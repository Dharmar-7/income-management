'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import CustomSelect from '@/components/CustomSelect';

interface Category {
  id: string;
  name: string;
  icon: string;
}

type TxType = 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT';

interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: TxType;
  description: string | null;
  source: string;
  category: Category | null;
}

const TYPE_LABEL: Record<TxType, string> = {
  DEBIT: 'Expense',
  CREDIT: 'Income',
  REFUND: 'Refund',
  INVESTMENT: 'Investment',
};
const TYPE_SIGN: Record<TxType, string> = {
  DEBIT: '-',
  CREDIT: '+',
  REFUND: '↩',
  INVESTMENT: '→',
};
// Money-in (CREDIT/REFUND) reads green; investment transfers indigo; spend rose.
const TYPE_COLOR: Record<TxType, string> = {
  DEBIT: 'text-rose-600',
  CREDIT: 'text-emerald-600',
  REFUND: 'text-emerald-600',
  INVESTMENT: 'text-indigo-600',
};
const TYPE_OPTIONS = [
  { value: 'DEBIT', label: 'Expense', icon: '💸' },
  { value: 'CREDIT', label: 'Income', icon: '💰' },
  { value: 'REFUND', label: 'Refund', icon: '↩️' },
  { value: 'INVESTMENT', label: 'Investment', icon: '📊' },
];

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function TransactionDetail({ id }: { id: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [merchant, setMerchant] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [txType, setTxType] = useState<TxType>('DEBIT');
  const [isEditing, setIsEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Pull current values into the edit form (used on load + Cancel)
  function seedForm(t: Transaction) {
    setSelectedCategory(t.category?.id ?? '');
    setNote(t.description ?? '');
    setMerchant(t.merchant);
    setAmount(String(t.amount));
    setDate(t.date.slice(0, 10));
    setTxType(t.type);
    setFormError(null);
  }

  // Fetch transaction
  const { data: tx, isLoading, error } = useQuery({
    queryKey: ['transaction', id],
    queryFn: async () => {
      const token = await getToken();
      const result = await apiFetch<Transaction>(`/transactions/${id}`, token!);
      // Pre-fill edit fields with current values
      seedForm(result);
      return result;
    },
  });

  // Fetch categories for dropdown
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Category[]>('/transactions/categories', token!);
    },
  });

  // Save mutation
  const mutation = useMutation({
    mutationFn: async (body: {
      amount?: number;
      merchant?: string;
      type?: TxType;
      date?: string;
      categoryId?: string;
      description?: string;
    }) => {
      const token = await getToken();
      return apiFetch<Transaction>(`/transactions/${id}`, token!, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      // Invalidate so the list, detail and dashboard aggregate all refresh
      queryClient.invalidateQueries({ queryKey: ['transaction', id] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setIsEditing(false);
    },
  });

  function handleSave() {
    const parsed = parseFloat(amount);
    if (!merchant.trim()) {
      setFormError('Merchant is required.');
      return;
    }
    if (isNaN(parsed) || parsed <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (!date) {
      setFormError('Date is required.');
      return;
    }
    setFormError(null);
    mutation.mutate({
      amount: parsed,
      merchant: merchant.trim(),
      type: txType,
      date,
      // '' clears the field on the backend (Uncategorized / no note)
      categoryId: selectedCategory,
      description: note,
    });
  }

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 animate-pulse space-y-4">
        <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded w-48" />
        <div className="h-10 bg-gray-100 dark:bg-gray-700 rounded w-32" />
        <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-24" />
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
        <p className="text-gray-400 dark:text-gray-500 text-sm">Transaction not found.</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white underline"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-2xl flex-shrink-0">
            {tx.category?.icon ?? '📦'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{tx.merchant}</h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(tx.date)}</p>
          </div>
          <div className={`text-2xl font-bold flex-shrink-0 ${TYPE_COLOR[tx.type]}`}>
            {TYPE_SIGN[tx.type]}{formatINR(tx.amount)}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-400 dark:text-gray-500">Type</p>
            <p className="font-medium mt-0.5 dark:text-white">
              {TYPE_LABEL[tx.type]}
            </p>
          </div>
          <div>
            <p className="text-gray-400 dark:text-gray-500">Category</p>
            <p className="font-medium mt-0.5 dark:text-white">
              {tx.category ? `${tx.category.icon} ${tx.category.name}` : 'Uncategorized'}
            </p>
          </div>
          <div>
            <p className="text-gray-400 dark:text-gray-500">Source</p>
            <p className="font-medium mt-0.5 capitalize dark:text-white">{tx.source.toLowerCase().replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-gray-400 dark:text-gray-500">Note</p>
            <p className="font-medium mt-0.5 text-gray-700 dark:text-gray-300">
              {tx.description ?? <span className="text-gray-400 font-normal">None</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Edit card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Edit Details</h3>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-600 rounded-full px-3 py-1"
            >
              Edit
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Type</label>
              <CustomSelect
                value={txType}
                onChange={v => setTxType(v as TxType)}
                options={TYPE_OPTIONS}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-gray-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Merchant</label>
              <input
                type="text"
                maxLength={200}
                value={merchant}
                onChange={e => setMerchant(e.target.value)}
                placeholder="e.g. Swiggy"
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Category</label>
              <CustomSelect
                value={selectedCategory}
                onChange={v => setSelectedCategory(v)}
                placeholder="Uncategorized"
                options={[
                  { value: '', label: 'Uncategorized', icon: '📦' },
                  ...(categories ?? []).map(c => ({ value: c.id, label: c.name, icon: c.icon })),
                ]}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Note</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="Add a note..."
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  seedForm(tx);
                  setIsEditing(false);
                }}
                className="rounded-full border border-gray-200 dark:border-gray-600 dark:text-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={mutation.isPending}
                className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 shadow-md shadow-indigo-200"
              >
                {mutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>

            {(formError || mutation.isError) && (
              <p className="text-sm text-red-500 text-center">
                {formError ?? 'Failed to save. Try again.'}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Click Edit to change the amount, merchant, date, type, category, or note.
          </p>
        )}
      </div>
    </div>
  );
}
