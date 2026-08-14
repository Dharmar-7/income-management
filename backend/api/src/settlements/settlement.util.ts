// Pure helpers for settlements — no DB, so they're trivially unit-testable.

export type Direction = 'SENT' | 'RECEIVED';
export type Leg = 'PRINCIPAL' | 'REPAYMENT';
export type TxType = 'DEBIT' | 'CREDIT';

// The natural (non-TRANSFER) transaction type for a settlement leg, used to
// restore a transaction when it's unlinked/removed.
//  - SENT principal  = you paid out           → DEBIT
//  - SENT repayment  = money came back to you  → CREDIT
//  - RECEIVED principal = money came in        → CREDIT
//  - RECEIVED repayment = you paid it back      → DEBIT
export function naturalTxType(direction: Direction, kind: Leg): TxType {
  if (direction === 'SENT') return kind === 'PRINCIPAL' ? 'DEBIT' : 'CREDIT';
  return kind === 'PRINCIPAL' ? 'CREDIT' : 'DEBIT';
}

// Small epsilon so floating-point sums (e.g. 0.1 + 0.2) still settle cleanly.
const EPS = 0.005;

export function outstanding(totalPrincipal: number, totalRepaid: number): number {
  return Math.round((totalPrincipal - totalRepaid) * 100) / 100;
}

// A tab is SETTLED once repayments cover the principal (and there's principal to
// settle). Overpayment still counts as settled.
export function settlementStatus(
  totalPrincipal: number,
  totalRepaid: number,
): 'PENDING' | 'SETTLED' {
  return totalPrincipal > 0 && totalRepaid >= totalPrincipal - EPS ? 'SETTLED' : 'PENDING';
}
