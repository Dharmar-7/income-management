// Velora Brain — shared types and helpers. PURE (no React Native imports), so
// the whole brain can be compiled and sanity-checked with plain Node.
//
// Money semantics match the backend summary exactly:
//   income  = CREDIT
//   spend   = DEBIT − REFUND        (refunds reduce spending)
//   INVESTMENT and TRANSFER are excluded from both.

export { inr } from '../investCoach';

export type TxType = 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT' | 'TRANSFER';

export interface Tx {
  id: string;
  amount: number;
  merchant: string;
  date: string;            // ISO
  type: TxType;
  categoryId: string | null;
}

export interface Category { id: string; name: string; icon: string }

export interface Period { from: Date; to: Date; label: string } // half-open [from, to)

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const DAY_MS = 86_400_000;

export function monthPeriod(year: number, month0: number): Period {
  const from = new Date(year, month0, 1);
  return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 1), label: `${MONTH_NAMES[from.getMonth()]} ${from.getFullYear()}` };
}

// The month `offset` months before the one containing `now` (0 = this month).
export function monthsAgo(now: Date, offset: number): Period {
  return monthPeriod(now.getFullYear(), now.getMonth() - offset);
}

export const time = (tx: Tx) => Date.parse(tx.date);

export function inPeriod(tx: Tx, p: Period): boolean {
  const t = time(tx);
  return t >= p.from.getTime() && t < p.to.getTime();
}

export function inRange(txs: Tx[], p: Period): Tx[] {
  return txs.filter(t => inPeriod(t, p));
}

export function spendOf(txs: Tx[]): number {
  let debit = 0, refund = 0;
  for (const t of txs) {
    if (t.type === 'DEBIT') debit += t.amount;
    else if (t.type === 'REFUND') refund += t.amount;
  }
  return Math.max(0, debit - refund);
}

export function incomeOf(txs: Tx[]): number {
  return txs.reduce((s, t) => (t.type === 'CREDIT' ? s + t.amount : s), 0);
}

// "SWIGGY*ORDER 1234" / "Swiggy Instamart" → "swiggy order" / "swiggy instamart".
export function normMerchant(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|llp|inc|india|upi|payment|payments|technologies|tech)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function percentile(nums: number[], p: number): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[idx];
}

// A month "has data" when ANY transaction falls in it — so a brand-new user's
// empty past months don't drag averages to zero.
export function hasData(txs: Tx[], p: Period): boolean {
  return txs.some(t => inPeriod(t, p));
}

export const pct = (n: number) => `${Math.round(n)}%`;

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
