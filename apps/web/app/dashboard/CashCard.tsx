'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useDashboard, useInvalidateDashboard } from '@/lib/useDashboard';

type Mode = 'idle' | 'add' | 'spend';

const SOURCE_OPTIONS_IN = [
  { value: 'ATM',    label: 'ATM Withdrawal', icon: '🏧' },
  { value: 'PERSON', label: 'Received from Person', icon: '🤝' },
  { value: 'OTHER',  label: 'Other',           icon: '💵' },
];

const SOURCE_OPTIONS_OUT = [
  { value: 'SPENT',     label: 'Cash Payment', icon: '🛍️' },
  { value: 'DEPOSITED', label: 'Deposited to Bank', icon: '🏦' },
];

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CashCard() {
  const { getToken } = useAuth();
  const { data, isLoading } = useDashboard();
  const invalidate = useInvalidateDashboard();
  const queryClient = useQueryClient();
  const cashData = data?.cash;

  const [mode, setMode] = useState<Mode>('idle');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function openMode(m: Mode) {
    setMode(m);
    setAmount('');
    setSource(m === 'add' ? 'ATM' : 'SPENT');
    setNote('');
    setDate(todayISO());
    setError('');
  }

  function cancel() {
    setMode('idle');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !source || !date) return;
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const endpoint = mode === 'add' ? '/cash/add' : '/cash/spend';
      await apiFetch(endpoint, token!, {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(amount),
          source,
          note: note.trim() || undefined,
          date,
        }),
      });
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['transactions'] }); // cash payments mirror into transactions
      setMode('idle');
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const sourceOptions = mode === 'add' ? SOURCE_OPTIONS_IN : SOURCE_OPTIONS_OUT;

  return (
    <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-6 text-white shadow-lg shadow-black/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💵</span>
          <span className="text-sm text-white/80 font-medium">Cash in Hand</span>
        </div>
        {mode === 'idle' && (
          <div className="flex gap-2">
            <button
              onClick={() => openMode('add')}
              className="text-xs bg-white/20 hover:bg-white/30 rounded-full px-3 py-1 font-semibold transition-colors"
            >
              + Add
            </button>
            <button
              onClick={() => openMode('spend')}
              className="text-xs bg-white/20 hover:bg-white/30 rounded-full px-3 py-1 font-semibold transition-colors"
            >
              − Spend
            </button>
          </div>
        )}
      </div>

      {/* Balance */}
      {isLoading ? (
        <div className="h-9 bg-white/20 rounded-xl animate-pulse w-32" />
      ) : (
        <div className="text-3xl font-bold tracking-tight">
          {formatINR(cashData?.balance ?? 0)}
        </div>
      )}

      {/* In/Out summary */}
      {cashData && mode === 'idle' && (
        <div className="flex gap-4 mt-3 text-xs text-white/70">
          <span>↑ {formatINR(cashData.totalIn)} in</span>
          <span>↓ {formatINR(cashData.totalOut)} out</span>
        </div>
      )}

      {/* Inline form */}
      {mode !== 'idle' && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {/* Source chips */}
          <div className="flex flex-wrap gap-2">
            {sourceOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSource(opt.value)}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                  source === opt.value
                    ? 'bg-white text-orange-600 border-white'
                    : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
                }`}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>

          {/* Amount + Date row */}
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Amount ₹"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
              className="flex-1 bg-white/20 placeholder-white/60 text-white rounded-xl px-3 py-2 text-sm outline-none border border-white/20 focus:border-white/60"
            />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={todayISO()}
              required
              className="bg-white/20 text-white rounded-xl px-3 py-2 text-sm outline-none border border-white/20 focus:border-white/60"
            />
          </div>

          {/* Note */}
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={300}
            className="w-full bg-white/20 placeholder-white/60 text-white rounded-xl px-3 py-2 text-sm outline-none border border-white/20 focus:border-white/60"
          />

          {error && <p className="text-xs text-white/90 bg-red-500/30 rounded-lg px-3 py-1.5">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              className="flex-1 bg-white/10 hover:bg-white/20 rounded-xl py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-white text-orange-600 hover:bg-white/90 rounded-xl py-2 text-sm font-bold disabled:opacity-50"
            >
              {loading ? '…' : mode === 'add' ? 'Add Cash' : 'Record Spend'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
