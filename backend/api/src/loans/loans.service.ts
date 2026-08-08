import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { findTransactionMatches } from '../common/transaction-match';

function computeEmi(principal: number, annualRate: number, tenure: number): number {
  if (annualRate === 0) return +(principal / tenure).toFixed(2);
  const r = annualRate / 12 / 100;
  return +(principal * r * Math.pow(1 + r, tenure) / (Math.pow(1 + r, tenure) - 1)).toFixed(2);
}

function computeOutstanding(emi: number, annualRate: number, tenure: number, paidEmis: number): number {
  const remaining = tenure - paidEmis;
  if (remaining <= 0) return 0;
  if (annualRate === 0) return +(emi * remaining).toFixed(2);
  const r = annualRate / 12 / 100;
  return +(emi * (1 - Math.pow(1 + r, -remaining)) / r).toFixed(2);
}

@Injectable()
export class LoansService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string) {
    return this.prisma.resolveUserId(clerkId);
  }

  async findAll(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const loans = await this.prisma.loan.findMany({
      where: { userId },
      include: { payments: { orderBy: { paidDate: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });

    // Attach linked-transaction snippets to payments (same approach as Settlements).
    const txIds = loans
      .flatMap(l => l.payments.map(p => p.transactionId))
      .filter((id): id is string => !!id);
    const txMap = new Map<string, { id: string; merchant: string; amount: number; date: Date }>();
    if (txIds.length) {
      const txs = await this.prisma.transaction.findMany({
        where: { id: { in: txIds } },
        select: { id: true, merchant: true, amount: true, date: true },
      });
      txs.forEach(t => txMap.set(t.id, t));
    }

    return loans.map(l => this.enrich(l, txMap));
  }

  // Candidate bank transactions this loan's EMI could map to (for the link picker).
  async getPaymentMatches(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const loan = await this.assertOwner(clerkId, id);
    return findTransactionMatches(this.prisma, userId, {
      amount: loan.emiAmount,
      type: 'DEBIT',
      aroundDate: new Date(),
      windowDays: 7,
    });
  }

  async create(clerkId: string, dto: CreateLoanDto) {
    const userId = await this.resolveUserId(clerkId);
    const emiAmount = dto.emiAmount ?? computeEmi(dto.principalAmount, dto.interestRate, dto.tenure);

    const loan = await this.prisma.loan.create({
      data: {
        userId,
        name: dto.name,
        loanType: dto.loanType as any,
        lender: dto.lender,
        principalAmount: dto.principalAmount,
        interestRate: dto.interestRate,
        tenure: dto.tenure,
        emiAmount,
        emiDay: dto.emiDay,
        startDate: new Date(dto.startDate),
        note: dto.note ?? null,
      },
      include: { payments: true },
    });
    return this.enrich(loan);
  }

  async update(clerkId: string, id: string, dto: { name?: string; note?: string }) {
    await this.assertOwner(clerkId, id);
    const loan = await this.prisma.loan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
      include: { payments: { orderBy: { paidDate: 'desc' } } },
    });
    return this.enrich(loan);
  }

  // Record an EMI as paid. Instead of always creating a mirror DEBIT (which
  // double-counts when the bank also imported the EMI), map it to a real bank
  // transaction: use an explicit `transactionId` if given, else auto-link a
  // single unambiguous match, else fall back to creating a mirror (cash / not
  // yet imported). `txAutoCreated` records which happened so delete can clean up.
  async markPaid(clerkId: string, id: string, opts?: { transactionId?: string }) {
    const userId = await this.resolveUserId(clerkId);
    const loan = await this.assertOwner(clerkId, id);
    const paidEmis = loan.payments.length;

    if (paidEmis >= loan.tenure) {
      throw new Error('All EMIs already paid for this loan.');
    }

    // Resolve which transaction this payment maps to.
    let linkedTxId: string | null = null;
    let autoCreated = false;

    if (opts?.transactionId) {
      // User explicitly linked a bank transaction from the picker.
      const tx = await this.prisma.transaction.findFirst({
        where: { id: opts.transactionId, userId },
      });
      if (!tx) throw new NotFoundException('Transaction to link not found.');
      linkedTxId = tx.id;
    } else {
      // No link chosen → record a fresh mirror debit (cash / not imported).
      const created = await this.prisma.transaction.create({
        data: {
          userId,
          amount: loan.emiAmount,
          merchant: loan.lender,
          description: `EMI: ${loan.name}`,
          date: new Date(),
          type: 'DEBIT',
          source: 'MANUAL',
        },
      });
      linkedTxId = created.id;
      autoCreated = true;
    }

    const newPaidEmis = paidEmis + 1;
    const nowClosed = newPaidEmis >= loan.tenure;
    const [payment] = await Promise.all([
      this.prisma.loanPayment.create({
        data: {
          loanId: id, amount: loan.emiAmount, paidDate: new Date(),
          transactionId: linkedTxId, txAutoCreated: autoCreated,
        },
      }),
      ...(nowClosed
        ? [this.prisma.loan.update({ where: { id }, data: { isActive: false } })]
        : []),
    ]);

    const enriched = this.enrich({
      ...loan,
      isActive: nowClosed ? false : loan.isActive,
      payments: [payment, ...loan.payments],
    });
    // Tell the client what happened so it can show the right toast.
    return { ...enriched, linkResult: { transactionId: linkedTxId, autoCreated } };
  }

  async remove(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const loan = await this.assertOwner(clerkId, id);

    // Delete only the mirror transactions the app itself created for this loan —
    // never the user's real bank transactions we merely linked to.
    const autoTxIds = loan.payments
      .filter((p: any) => p.txAutoCreated && p.transactionId)
      .map((p: any) => p.transactionId as string);

    await this.prisma.$transaction([
      ...(autoTxIds.length
        ? [this.prisma.transaction.deleteMany({ where: { id: { in: autoTxIds }, userId } })]
        : []),
      this.prisma.loan.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertOwner(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const loan = await this.prisma.loan.findFirst({
      where: { id, userId },
      include: { payments: { orderBy: { paidDate: 'desc' } } },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  private enrich(loan: any, txMap?: Map<string, { id: string; merchant: string; amount: number; date: Date }>) {
    const paidEmis = loan.payments?.length ?? 0;
    const remaining = loan.tenure - paidEmis;
    const outstanding = computeOutstanding(loan.emiAmount, loan.interestRate, loan.tenure, paidEmis);
    const totalPaid = loan.payments?.reduce((s: number, p: any) => s + p.amount, 0) ?? 0;

    // Next EMI date = start date + paidEmis months, on emiDay
    const start = new Date(loan.startDate);
    const nextEmiDate = new Date(start.getFullYear(), start.getMonth() + paidEmis, loan.emiDay);

    // Surface the linked bank transaction (if any) on each payment.
    const payments = (loan.payments ?? []).map((p: any) => ({
      ...p,
      linked: !!p.transactionId && !p.txAutoCreated,
      transaction: p.transactionId ? txMap?.get(p.transactionId) ?? null : null,
    }));

    return {
      ...loan,
      payments,
      paidEmis,
      remainingEmis: remaining,
      outstandingBalance: outstanding,
      totalPaid: +totalPaid.toFixed(2),
      progressPercent: +((paidEmis / loan.tenure) * 100).toFixed(1),
      nextEmiDate,
    };
  }
}
