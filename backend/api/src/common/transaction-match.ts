import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Shared logic for mapping a "section" entry (EMI payment, SIP contribution,
// recurring bill) to the real bank transaction that represents the same money
// movement — so the app links instead of creating a duplicate.

export interface TxMatchQuery {
  amount: number;
  type: TransactionType;   // the bank tx type to look for (usually DEBIT)
  aroundDate: Date;        // centre of the date window
  windowDays?: number;     // ± days to search (default 5)
  amountTolerance?: number;// ± rupees (default 1 — near-exact)
}

export interface TxMatchCandidate {
  id: string;
  amount: number;
  merchant: string;
  date: Date;
  type: TransactionType;
}

// Transactions already claimed by a loan payment, saving contribution or
// settlement — never offer these as matches (would double-link one tx).
export async function getLinkedTransactionIds(
  prisma: PrismaService,
  userId: string,
): Promise<Set<string>> {
  const [loanPays, savingContribs, settlements] = await Promise.all([
    prisma.loanPayment.findMany({
      where: { transactionId: { not: null }, loan: { userId } },
      select: { transactionId: true },
    }),
    prisma.savingContribution.findMany({
      where: { userId, transactionId: { not: null } },
      select: { transactionId: true },
    }),
    prisma.settlement.findMany({
      where: { userId },
      select: { originalTxId: true, repaymentTxId: true },
    }),
  ]);

  const ids = new Set<string>();
  loanPays.forEach(p => p.transactionId && ids.add(p.transactionId));
  savingContribs.forEach(c => c.transactionId && ids.add(c.transactionId));
  settlements.forEach(s => {
    if (s.originalTxId) ids.add(s.originalTxId);
    if (s.repaymentTxId) ids.add(s.repaymentTxId);
  });
  return ids;
}

// Find candidate bank transactions for a section entry, newest first,
// excluding ones already linked elsewhere.
export async function findTransactionMatches(
  prisma: PrismaService,
  userId: string,
  q: TxMatchQuery,
): Promise<TxMatchCandidate[]> {
  const windowMs = (q.windowDays ?? 5) * 24 * 60 * 60 * 1000;
  const tol = q.amountTolerance ?? 1;

  const [rows, linked] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        type: q.type,
        amount: { gte: q.amount - tol, lte: q.amount + tol },
        date: {
          gte: new Date(q.aroundDate.getTime() - windowMs),
          lte: new Date(q.aroundDate.getTime() + windowMs),
        },
      },
      select: { id: true, amount: true, merchant: true, date: true, type: true },
      orderBy: { date: 'desc' },
      take: 10,
    }),
    getLinkedTransactionIds(prisma, userId),
  ]);

  return rows.filter(r => !linked.has(r.id));
}

// Pure decision for the "auto-link, no duplicate" preference: link only when
// there is exactly ONE candidate (unambiguous). With 0 or 2+, defer to the user
// (or fall back to creating a mirror transaction).
export function pickAutoLink<T>(candidates: T[]): T | null {
  return candidates.length === 1 ? candidates[0] : null;
}
