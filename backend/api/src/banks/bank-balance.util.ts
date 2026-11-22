// ─────────────────────────────────────────────────────────────────────────────
// Bank balance tracking. IOB/TMB SMS say "Bal: NA", so balances can't be read
// from messages. Instead the user types a bank's balance once (an "anchor"),
// and we move it forward by that bank's transactions since then. Pure
// functions only, so the rules are unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TxType = 'DEBIT' | 'CREDIT' | 'REFUND' | 'INVESTMENT' | 'TRANSFER';

// +1 money into the bank, -1 money out, 0 unknown.
// TRANSFER rows (settlement legs) carry their real direction separately.
export function moneyDirection(type: TxType, transferAs: 'DEBIT' | 'CREDIT' | null = null): 1 | -1 | 0 {
  switch (type) {
    case 'DEBIT':
    case 'INVESTMENT':
      return -1;
    case 'CREDIT':
    case 'REFUND':
      return 1;
    case 'TRANSFER':
      return transferAs === 'DEBIT' ? -1 : transferAs === 'CREDIT' ? 1 : 0;
    default:
      return 0;
  }
}

// Manual and statement transactions store only a date (saved as UTC midnight);
// SMS and cash ones carry the real time.
export function isDateOnly(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

// Calendar day number in India time.
export function istDay(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);
}

// Start of the India-time day containing `d`, as a UTC instant.
export function istDayStart(d: Date): Date {
  return new Date(istDay(d) * DAY_MS - IST_OFFSET_MS);
}

// Did this transaction happen after the user typed the balance (so it isn't
// already included in it)?
//  • Timed rows: simply after the anchor moment.
//  • Date-only rows: a later day counts. On the anchor day itself we can't
//    know the time, so count it only if it was entered after the anchor.
export function happenedAfter(tx: { date: Date; createdAt: Date }, anchor: Date): boolean {
  if (!isDateOnly(tx.date)) return tx.date.getTime() > anchor.getTime();
  // A date-only row's day is its UTC date (it was saved as UTC midnight).
  const txDay = Math.floor(tx.date.getTime() / DAY_MS);
  const anchorDay = istDay(anchor);
  if (txDay > anchorDay) return true;
  if (txDay < anchorDay) return false;
  return tx.createdAt.getTime() > anchor.getTime();
}

export interface BalanceMove { amount: number; direction: 1 | -1 | 0 }

export function trackedBalance(anchor: number, moves: BalanceMove[]): {
  current: number; change: number; counted: number; unknown: number;
} {
  let change = 0;
  let counted = 0;
  let unknown = 0;
  for (const m of moves) {
    if (m.direction === 0) { unknown++; continue; }
    change += m.direction * m.amount;
    counted++;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { current: r2(anchor + change), change: r2(change), counted, unknown };
}
