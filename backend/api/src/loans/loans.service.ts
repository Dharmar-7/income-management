import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';

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
    return loans.map(l => this.enrich(l));
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

  async markPaid(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const loan = await this.assertOwner(clerkId, id);
    const paidEmis = loan.payments.length;

    if (paidEmis >= loan.tenure) {
      throw new Error('All EMIs already paid for this loan.');
    }

    // The payment record, the mirror DEBIT transaction, and the possible
    // loan-closure update are independent — run them in one parallel batch
    // instead of 3-4 sequential cross-region round-trips.
    const newPaidEmis = paidEmis + 1;
    const nowClosed = newPaidEmis >= loan.tenure;
    const [payment] = await Promise.all([
      this.prisma.loanPayment.create({
        data: { loanId: id, amount: loan.emiAmount, paidDate: new Date() },
      }),
      this.prisma.transaction.create({
        data: {
          userId,
          amount: loan.emiAmount,
          merchant: loan.lender,
          description: `EMI: ${loan.name}`,
          date: new Date(),
          type: 'DEBIT',
          source: 'MANUAL',
        },
      }),
      ...(nowClosed
        ? [this.prisma.loan.update({ where: { id }, data: { isActive: false } })]
        : []),
    ]);

    // Compose the response from what we already hold — no refetch needed.
    return this.enrich({
      ...loan,
      isActive: nowClosed ? false : loan.isActive,
      payments: [payment, ...loan.payments],
    });
  }

  async remove(clerkId: string, id: string) {
    await this.assertOwner(clerkId, id);
    await this.prisma.loan.delete({ where: { id } });
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

  private enrich(loan: any) {
    const paidEmis = loan.payments?.length ?? 0;
    const remaining = loan.tenure - paidEmis;
    const outstanding = computeOutstanding(loan.emiAmount, loan.interestRate, loan.tenure, paidEmis);
    const totalPaid = loan.payments?.reduce((s: number, p: any) => s + p.amount, 0) ?? 0;

    // Next EMI date = start date + paidEmis months, on emiDay
    const start = new Date(loan.startDate);
    const nextEmiDate = new Date(start.getFullYear(), start.getMonth() + paidEmis, loan.emiDay);

    return {
      ...loan,
      paidEmis,
      remainingEmis: remaining,
      outstandingBalance: outstanding,
      totalPaid: +totalPaid.toFixed(2),
      progressPercent: +((paidEmis / loan.tenure) * 100).toFixed(1),
      nextEmiDate,
    };
  }
}
