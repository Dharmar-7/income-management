'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { apiFetch } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Platform {
  id: string;
  name: string;
  totalAdded: number;
  note: string | null;
  totalInvested: number;
  totalCurrentValue: number;
  balance: number;
}

interface Saving {
  id: string;
  name: string;
  type: SavingType;
  investedAmount: number;
  charges: number;
  currentValue: number;
  netCost: number;
  gainLoss: number;
  gainPercent: number;
  startDate: string;
  maturityDate: string | null;
  note: string | null;
  platform: { id: string; name: string } | null;
}

interface SavingsSummary {
  totalInvested: number;
  totalCharges: number;
  totalNetCost: number;
  totalCurrentValue: number;
  totalGainLoss: number;
  totalGainPercent: number;
  count: number;
}

type SavingType =
  | 'POST_OFFICE' | 'FIXED_DEPOSIT' | 'RECURRING_DEPOSIT'
  | 'STOCKS' | 'MUTUAL_FUNDS' | 'GOLD' | 'EPF' | 'NPS' | 'OTHER';

// ─── Constants ──────────────────────────────────────────────────────────────────

const SAVING_TYPE_OPTIONS: { value: SavingType; label: string; icon: string }[] = [
  { value: 'POST_OFFICE',       label: 'Post Office (PPF/NSC/MIS)', icon: '📮' },
  { value: 'FIXED_DEPOSIT',     label: 'Fixed Deposit',              icon: '🏦' },
  { value: 'RECURRING_DEPOSIT', label: 'Recurring Deposit',          icon: '📅' },
  { value: 'MUTUAL_FUNDS',      label: 'Mutual Funds / SIP',         icon: '📈' },
  { value: 'STOCKS',            label: 'Stocks',                      icon: '💹' },
  { value: 'GOLD',              label: 'Gold / SGB / ETF',            icon: '🥇' },
  { value: 'EPF',               label: 'EPF',                         icon: '🏢' },
  { value: 'NPS',               label: 'NPS',                         icon: '🛡️' },
  { value: 'OTHER',             label: 'Other',                       icon: '📦' },
];

function typeLabel(type: SavingType) {
  return SAVING_TYPE_OPTIONS.find(o => o.value === type) ?? { label: type, icon: '📦' };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Add Platform Modal ─────────────────────────────────────────────────────────

function AddPlatformModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [totalAdded, setTotalAdded] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !totalAdded) return;
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      await apiFetch('/savings/platforms', token!, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), totalAdded: parseFloat(totalAdded), note: note.trim() || undefined }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add platform.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add Investment Platform</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          A platform is your in-app wallet (e.g. Groww, Zerodha). Add the total amount you transferred into it.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Platform Name</label>
            <input
              type="text"
              placeholder="e.g. Groww, Zerodha, Post Office"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              maxLength={100}
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Total Transferred In (₹)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="e.g. 5000"
              value={totalAdded}
              onChange={e => setTotalAdded(e.target.value)}
              required
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Note <span className="text-gray-300">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. Primary brokerage account"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={300}
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {loading ? 'Adding…' : 'Add Platform'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Top Up Platform Modal ──────────────────────────────────────────────────────

function TopUpPlatformModal({ platform, onClose, onSuccess }: { platform: Platform; onClose: () => void; onSuccess: () => void }) {
  const { getToken } = useAuth();
  const [addAmount, setAddAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addAmount) return;
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const newTotal = platform.totalAdded + parseFloat(addAmount);
      await apiFetch(`/savings/platforms/${platform.id}`, token!, {
        method: 'PATCH',
        body: JSON.stringify({ totalAdded: newTotal }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to top up.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Top Up {platform.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Current balance: <span className="font-semibold text-gray-900 dark:text-white">{formatINR(platform.balance)}</span></p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Add Amount (₹)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              placeholder="e.g. 2000"
              value={addAmount}
              onChange={e => setAddAmount(e.target.value)}
              required
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {loading ? '…' : 'Add Funds'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Saving Modal ───────────────────────────────────────────────────────────

function AddSavingModal({ platforms, onClose, onSuccess }: { platforms: Platform[]; onClose: () => void; onSuccess: () => void }) {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [savingType, setSavingType] = useState<SavingType>('MUTUAL_FUNDS');
  const [investedAmount, setInvestedAmount] = useState('');
  const [charges, setCharges] = useState('0');
  const [currentValue, setCurrentValue] = useState('');
  const [startDate, setStartDate] = useState(todayISO);
  const [maturityDate, setMaturityDate] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // When investedAmount or charges change, default currentValue to their sum
  function handleInvestedChange(v: string) {
    setInvestedAmount(v);
    if (!currentValue) {
      const invested = parseFloat(v) || 0;
      const ch = parseFloat(charges) || 0;
      setCurrentValue(String(invested + ch));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !investedAmount || !currentValue || !startDate) return;
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      await apiFetch('/savings', token!, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type: savingType,
          investedAmount: parseFloat(investedAmount),
          charges: parseFloat(charges) || 0,
          currentValue: parseFloat(currentValue),
          startDate,
          maturityDate: maturityDate || undefined,
          platformId: platformId || undefined,
          note: note.trim() || undefined,
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add saving.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add Investment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type chips */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Type</label>
            <div className="flex flex-wrap gap-2">
              {SAVING_TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSavingType(opt.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    savingType === opt.value
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-violet-300 hover:text-violet-600'
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Investment Name</label>
            <input
              type="text"
              placeholder="e.g. Nifty 50 SIP, PPF, SGB 2025"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              maxLength={200}
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>

          {/* Amounts row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Invested (₹)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={investedAmount}
                onChange={e => handleInvestedChange(e.target.value)}
                required
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Charges (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={charges}
                onChange={e => setCharges(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Current Value (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={currentValue}
                onChange={e => setCurrentValue(e.target.value)}
                required
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
                max={todayISO()}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Maturity Date <span className="text-gray-300">(optional)</span>
              </label>
              <input
                type="date"
                value={maturityDate}
                onChange={e => setMaturityDate(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {/* Platform (optional) */}
          {platforms.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                Platform <span className="text-gray-300 dark:text-gray-600">(optional — deducts from platform balance)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPlatformId('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    !platformId
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-violet-300'
                  }`}
                >
                  No platform
                </button>
                {platforms.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatformId(p.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      platformId === p.id
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-violet-300'
                    }`}
                  >
                    {p.name} <span className="opacity-60">(bal {formatINR(p.balance)})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Note <span className="text-gray-300">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Monthly ₹500 SIP"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={300}
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {loading ? 'Adding…' : 'Add Investment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Current Value Modal ───────────────────────────────────────────────────

function EditSavingModal({ saving, onClose, onSuccess }: { saving: Saving; onClose: () => void; onSuccess: () => void }) {
  const { getToken } = useAuth();
  const [currentValue, setCurrentValue] = useState(String(saving.currentValue));
  const [note, setNote] = useState(saving.note ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      await apiFetch(`/savings/${saving.id}`, token!, {
        method: 'PATCH',
        body: JSON.stringify({
          currentValue: parseFloat(currentValue),
          note: note.trim() || undefined,
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Update {saving.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Current Value (₹)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={currentValue}
              onChange={e => setCurrentValue(e.target.value)}
              required
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Note <span className="text-gray-300">(optional)</span></label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={300}
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {loading ? '…' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function SavingsManager() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [showAddPlatform, setShowAddPlatform] = useState(false);
  const [topUpPlatform, setTopUpPlatform] = useState<Platform | null>(null);
  const [showAddSaving, setShowAddSaving] = useState(false);
  const [editSaving, setEditSaving] = useState<Saving | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingPlatformId, setDeletingPlatformId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['savings-summary'] });
    queryClient.invalidateQueries({ queryKey: ['savings-platforms'] });
    queryClient.invalidateQueries({ queryKey: ['savings-list'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }); // investments feed dashboard savings + net worth
  };

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['savings-summary'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<SavingsSummary>('/savings/summary', token!);
    },
  });

  const { data: platforms = [] } = useQuery({
    queryKey: ['savings-platforms'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Platform[]>('/savings/platforms', token!);
    },
  });

  const { data: savings = [], isLoading: savingsLoading } = useQuery({
    queryKey: ['savings-list'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Saving[]>('/savings', token!);
    },
  });

  async function deleteSaving(id: string) {
    if (!confirm('Delete this investment? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const token = await getToken();
      await apiFetch(`/savings/${id}`, token!, { method: 'DELETE' });
      invalidate();
    } catch {
      alert('Failed to delete.');
    } finally {
      setDeletingId(null);
    }
  }

  async function deletePlatform(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its investments? This cannot be undone.`)) return;
    setDeletingPlatformId(id);
    try {
      const token = await getToken();
      await apiFetch(`/savings/platforms/${id}`, token!, { method: 'DELETE' });
      invalidate();
    } catch {
      alert('Failed to delete platform.');
    } finally {
      setDeletingPlatformId(null);
    }
  }

  const isGain = (summary?.totalGainLoss ?? 0) >= 0;

  return (
    <>
      {/* Modals */}
      {showAddPlatform && (
        <AddPlatformModal onClose={() => setShowAddPlatform(false)} onSuccess={invalidate} />
      )}
      {topUpPlatform && (
        <TopUpPlatformModal platform={topUpPlatform} onClose={() => setTopUpPlatform(null)} onSuccess={invalidate} />
      )}
      {showAddSaving && (
        <AddSavingModal platforms={platforms} onClose={() => setShowAddSaving(false)} onSuccess={invalidate} />
      )}
      {editSaving && (
        <EditSavingModal saving={editSaving} onClose={() => setEditSaving(null)} onSuccess={invalidate} />
      )}

      <div className="space-y-8">

        {/* ── Portfolio Summary ─────────────────────────────────────────── */}
        {summaryLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : summary && summary.count > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl p-5 text-white">
              <p className="text-xs text-white/70 mb-1">Total Invested</p>
              <p className="text-xl font-bold">{formatINR(summary.totalNetCost)}</p>
              {summary.totalCharges > 0 && (
                <p className="text-xs text-white/60 mt-1">incl. {formatINR(summary.totalCharges)} charges</p>
              )}
            </div>
            <div className="bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl p-5 text-white">
              <p className="text-xs text-white/70 mb-1">Current Value</p>
              <p className="text-xl font-bold">{formatINR(summary.totalCurrentValue)}</p>
              <p className="text-xs text-white/60 mt-1">{summary.count} investments</p>
            </div>
            <div className={`rounded-2xl p-5 text-white ${isGain ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-rose-500 to-pink-600'}`}>
              <p className="text-xs text-white/70 mb-1">Total Gain / Loss</p>
              <p className="text-xl font-bold">{isGain ? '+' : ''}{formatINR(summary.totalGainLoss)}</p>
              <p className="text-xs text-white/60 mt-1">{summary.totalGainPercent >= 0 ? '+' : ''}{summary.totalGainPercent.toFixed(2)}%</p>
            </div>
            <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-5 text-white">
              <p className="text-xs text-white/70 mb-1">Total Charges</p>
              <p className="text-xl font-bold">{formatINR(summary.totalCharges)}</p>
              <p className="text-xs text-white/60 mt-1">STT, GST, brokerage</p>
            </div>
          </div>
        ) : null}

        {/* ── Platforms ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Investment Platforms</h2>
            <button
              onClick={() => setShowAddPlatform(true)}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 shadow-sm"
            >
              + Add Platform
            </button>
          </div>

          {platforms.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No platforms yet. Add one to start tracking your in-app wallet balance.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {platforms.map(p => (
                <div key={p.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-3 group">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{p.name}</p>
                      {p.note && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{p.note}</p>}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setTopUpPlatform(p)}
                        className="text-xs text-violet-500 hover:text-violet-700 px-2 py-1 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/30"
                        title="Add more funds"
                      >
                        + Top Up
                      </button>
                      <button
                        onClick={() => deletePlatform(p.id, p.name)}
                        disabled={deletingPlatformId === p.id}
                        className="text-gray-300 dark:text-gray-600 hover:text-rose-400 px-2 py-1 text-lg"
                        title="Delete platform"
                      >
                        {deletingPlatformId === p.id ? '…' : '🗑️'}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                      <span>Total transferred</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatINR(p.totalAdded)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                      <span>Invested</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatINR(p.totalInvested)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700 dark:text-gray-300 border-t border-gray-100 dark:border-gray-700 pt-1.5">
                      <span className="font-medium">Available balance</span>
                      <span className={`font-bold ${p.balance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {formatINR(p.balance)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Individual Savings ────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Investments</h2>
            <button
              onClick={() => setShowAddSaving(true)}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 shadow-sm"
            >
              + Add Investment
            </button>
          </div>

          {savingsLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}
            </div>
          ) : savings.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No investments yet. Click "+ Add Investment" to start tracking.
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {savings.map(s => {
                  const t = typeLabel(s.type);
                  const gain = s.gainLoss >= 0;
                  return (
                    <div key={s.id} className="flex items-center px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                      {/* Type icon */}
                      <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-lg flex-shrink-0">
                        {t.icon}
                      </div>

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0 mx-4">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full px-2 py-0.5 flex-shrink-0">
                            {t.label}
                          </span>
                          {s.platform && (
                            <span className="text-xs bg-violet-50 dark:bg-violet-900/40 text-violet-500 dark:text-violet-400 border border-violet-100 dark:border-violet-800 rounded-full px-2 py-0.5 flex-shrink-0">
                              {s.platform.name}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          Invested {formatINR(s.investedAmount)}
                          {s.charges > 0 && ` + ${formatINR(s.charges)} charges`}
                          {' · '}Started {formatDate(s.startDate)}
                          {s.maturityDate && ` · Matures ${formatDate(s.maturityDate)}`}
                        </p>
                      </div>

                      {/* Values */}
                      <div className="text-right flex-shrink-0 mr-4">
                        <p className="font-semibold text-gray-900 dark:text-white">{formatINR(s.currentValue)}</p>
                        <p className={`text-xs font-medium ${gain ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {gain ? '+' : ''}{formatINR(s.gainLoss)} ({s.gainPercent >= 0 ? '+' : ''}{s.gainPercent.toFixed(1)}%)
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditSaving(s)}
                          className="text-xs text-violet-500 hover:text-violet-700 px-2 py-1 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/30"
                          title="Update value"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteSaving(s.id)}
                          disabled={deletingId === s.id}
                          className="text-gray-300 dark:text-gray-600 hover:text-rose-400 text-lg px-1"
                          title="Delete"
                        >
                          {deletingId === s.id ? '…' : '🗑️'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
