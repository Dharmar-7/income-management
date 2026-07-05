'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import CustomSelect from '@/components/CustomSelect';
import AddTransactionModal from './AddTransactionModal';

// Debounce hook — waits `delay` ms after the user stops typing before updating the value.
// Without this, every keystroke would trigger an API call (wasteful + flickery).
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface Category {
  id: string;
  name: string;
  icon: string;
}

interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT';
  source: 'TAKEOUT' | 'GMAIL' | 'MANUAL' | 'SMS';
  description: string | null;
  category: Category | null;
}

interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface TransactionsResponse {
  data: Transaction[];
  meta: PageMeta;
}

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function TransactionList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset to page 1 when search changes
  const prevSearch = useRef(search);
  useEffect(() => {
    if (prevSearch.current !== search) {
      setPage(1);
      prevSearch.current = search;
    }
  }, [search]);

  // Fetch categories for the filter dropdown
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Category[]>('/transactions/categories', token!);
    },
  });

  const params = new URLSearchParams({
    page: String(page),
    limit: '20',
    sortBy,
    sortOrder,
    ...(search && { search }),
    ...(type && { type }),
    ...(categoryId && { categoryId }),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['transactions', page, search, type, categoryId, sortBy, sortOrder],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<TransactionsResponse>(`/transactions?${params}`, token!);
    },
  });

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const token = await getToken();
      await apiFetch(`/transactions/${id}`, token!, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }); // summary/charts include this tx
    } catch {
      alert('Failed to delete transaction.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
    {showModal && (
      <AddTransactionModal
        categories={categories ?? []}
        onClose={() => setShowModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] }); // summary/charts include this tx
        }}
      />
    )}
    <div className="space-y-4">
      {/* Header row: title + Add button */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Transactions</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 shadow-sm"
        >
          <span className="text-base leading-none">+</span> Add Transaction
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex gap-2 flex-1 min-w-48 relative">
          <input
            type="text"
            placeholder="Search merchant..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-full px-4 py-2 pl-10 text-sm focus:outline-none focus:border-gray-400"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-500 text-sm">
            🔍
          </span>
        </div>

        <CustomSelect
          value={type}
          onChange={v => { setType(v); setPage(1); }}
          placeholder="All types"
          options={[
            { value: '', label: 'All types' },
            { value: 'DEBIT', label: 'Expenses', icon: '💸' },
            { value: 'CREDIT', label: 'Income', icon: '💰' },
            { value: 'REFUND', label: 'Refunds', icon: '↩️' },
            { value: 'INVESTMENT', label: 'Investments', icon: '📊' },
          ]}
        />

        <CustomSelect
          value={categoryId}
          onChange={v => { setCategoryId(v); setPage(1); }}
          placeholder="All categories"
          options={[
            { value: '', label: 'All categories' },
            ...(categories ?? []).map(c => ({ value: c.id, label: c.name, icon: c.icon })),
          ]}
        />

        <CustomSelect
          value={`${sortBy}-${sortOrder}`}
          onChange={v => {
            const [by, order] = v.split('-');
            setSortBy(by);
            setSortOrder(order);
            setPage(1);
          }}
          placeholder="Sort by"
          options={[
            { value: 'date-desc', label: 'Newest first', icon: '🕐' },
            { value: 'date-asc', label: 'Oldest first', icon: '🕐' },
            { value: 'amount-desc', label: 'Highest amount', icon: '📈' },
            { value: 'amount-asc', label: 'Lowest amount', icon: '📉' },
          ]}
        />

        {(searchInput || type || categoryId) && (
          <button
            onClick={() => { setSearchInput(''); setType(''); setCategoryId(''); setPage(1); }}
            className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Transaction rows */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-32" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20" />
                </div>
                <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded w-20" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            Failed to load transactions.
          </div>
        ) : data?.data.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            No transactions found. Try adjusting your filters.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {data?.data.map(tx => (
              <div key={tx.id} className="flex items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                <Link
                  href={`/transactions/${tx.id}`}
                  className="flex-1 flex items-center gap-4 px-6 py-4"
                >
                  {/* Category icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${
                    tx.type === 'CREDIT' ? 'bg-emerald-100 dark:bg-emerald-900/40'
                    : tx.type === 'REFUND' ? 'bg-teal-50 dark:bg-teal-900/40'
                    : tx.type === 'INVESTMENT' ? 'bg-indigo-50 dark:bg-indigo-900/40'
                    : 'bg-rose-50 dark:bg-rose-900/40'
                  }`}>
                    {tx.type === 'REFUND' ? '↩️' : tx.type === 'INVESTMENT' ? '📊' : (tx.category?.icon ?? '📦')}
                  </div>

                  {/* Merchant + category + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{tx.merchant}</p>
                      {tx.type === 'INVESTMENT' && (
                        <span className="text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800 rounded-full px-2 py-0.5 flex-shrink-0 leading-none">
                          Investment
                        </span>
                      )}
                      {tx.type === 'REFUND' && (
                        <span className="text-xs bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-800 rounded-full px-2 py-0.5 flex-shrink-0 leading-none">
                          Refund
                        </span>
                      )}
                      {tx.source === 'MANUAL' && (
                        <span className="text-xs bg-violet-50 dark:bg-violet-900/40 text-violet-500 dark:text-violet-400 border border-violet-100 dark:border-violet-800 rounded-full px-2 py-0.5 flex-shrink-0 leading-none">
                          Manual
                        </span>
                      )}
                      {tx.source === 'SMS' && (
                        <span className="text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-500 dark:text-blue-400 border border-blue-100 dark:border-blue-800 rounded-full px-2 py-0.5 flex-shrink-0 leading-none">
                          SMS
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {tx.category?.name ?? 'Uncategorized'} · {formatDate(tx.date)}
                    </p>
                  </div>

                  {/* Amount */}
                  <div className={`font-semibold text-sm flex-shrink-0 ${
                    tx.type === 'CREDIT' ? 'text-emerald-600'
                    : tx.type === 'REFUND' ? 'text-teal-600'
                    : tx.type === 'INVESTMENT' ? 'text-indigo-600'
                    : 'text-rose-600'
                  }`}>
                    {tx.type === 'CREDIT' ? '+' : tx.type === 'REFUND' ? '↩' : tx.type === 'INVESTMENT' ? '→' : '-'}{formatINR(tx.amount)}
                  </div>
                </Link>

                {/* Delete — only for manual entries, visible on hover */}
                {tx.source === 'MANUAL' && (
                  <button
                    onClick={() => handleDelete(tx.id)}
                    disabled={deletingId === tx.id}
                    className="mr-5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 dark:text-gray-600 hover:text-rose-400 disabled:opacity-40 text-lg"
                    title="Delete transaction"
                  >
                    {deletingId === tx.id ? '…' : '🗑️'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {data.meta.total} transactions · Page {data.meta.page} of {data.meta.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
              className="rounded-full border border-gray-200 dark:border-gray-700 dark:text-gray-300 px-4 py-2 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page === data.meta.totalPages}
              className="rounded-full border border-gray-200 dark:border-gray-700 dark:text-gray-300 px-4 py-2 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
