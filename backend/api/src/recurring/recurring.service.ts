import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { findTransactionMatches, pickAutoLink } from '../common/transaction-match';

@Injectable()
export class RecurringService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string) {
    return this.prisma.resolveUserId(clerkId);
  }

  async findAll(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    return this.prisma.recurringTransaction.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { nextDueDate: 'asc' },
    });
  }

  async create(clerkId: string, dto: CreateRecurringDto) {
    const userId = await this.resolveUserId(clerkId);
    const startDate = new Date(dto.startDate);
    const nextDueDate = this.firstNextDue(dto.frequency, startDate, dto.dayOfMonth, dto.dayOfWeek);

    return this.prisma.recurringTransaction.create({
      data: {
        userId,
        name: dto.name,
        amount: dto.amount,
        type: dto.type as any,
        frequency: dto.frequency as any,
        dayOfMonth: dto.dayOfMonth ?? null,
        dayOfWeek: dto.dayOfWeek ?? null,
        startDate,
        nextDueDate,
        categoryId: dto.categoryId ?? null,
        note: dto.note ?? null,
      },
      include: { category: true },
    });
  }

  async update(clerkId: string, id: string, dto: Partial<CreateRecurringDto>) {
    await this.assertOwner(clerkId, id);
    return this.prisma.recurringTransaction.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
      include: { category: true },
    });
  }

  // Candidate bank transactions this recurring bill could map to (link picker).
  async getMatches(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const rec = await this.assertOwner(clerkId, id);
    return findTransactionMatches(this.prisma, userId, {
      amount: rec.amount, type: rec.type, aroundDate: new Date(), windowDays: 7,
    });
  }

  // Mark this bill paid. Rather than always creating a mirror transaction (which
  // double-counts when the bank also imported it), map it to a real bank
  // transaction: link an explicit/auto-matched one and just label it, else
  // create a mirror (cash / not yet imported). Either way, advance the due date.
  async markPaid(clerkId: string, id: string, opts?: { transactionId?: string }) {
    const userId = await this.resolveUserId(clerkId);
    const rec = await this.assertOwner(clerkId, id);

    const nextDueDate = this.advanceNextDue(
      rec.frequency as string,
      rec.nextDueDate,
      rec.dayOfMonth,
    );

    // Resolve which transaction represents this payment.
    let txId = opts?.transactionId ?? null;
    if (txId) {
      const tx = await this.prisma.transaction.findFirst({ where: { id: txId, userId } });
      if (!tx) throw new NotFoundException('Transaction to link not found.');
    } else {
      const matches = await findTransactionMatches(this.prisma, userId, {
        amount: rec.amount, type: rec.type, aroundDate: new Date(), windowDays: 7,
      });
      const auto = pickAutoLink(matches);
      if (auto) txId = auto.id;
    }

    let linkResult: { transactionId: string; autoCreated: boolean };
    if (txId) {
      // Link: label/categorize the existing bank tx instead of duplicating it.
      await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          description: `Recurring payment: ${rec.name}`,
          ...(rec.categoryId ? { categoryId: rec.categoryId } : {}),
        },
      });
      linkResult = { transactionId: txId, autoCreated: false };
    } else {
      const created = await this.prisma.transaction.create({
        data: {
          userId,
          amount: rec.amount,
          merchant: rec.name,
          description: `Recurring payment: ${rec.name}`,
          date: new Date(),
          type: rec.type,
          source: 'MANUAL',
          categoryId: rec.categoryId ?? null,
        },
      });
      linkResult = { transactionId: created.id, autoCreated: true };
    }

    const updated = await this.prisma.recurringTransaction.update({
      where: { id },
      data: { nextDueDate },
      include: { category: true },
    });
    return { ...updated, linkResult };
  }

  async remove(clerkId: string, id: string) {
    await this.assertOwner(clerkId, id);
    await this.prisma.recurringTransaction.delete({ where: { id } });
    return { ok: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertOwner(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const rec = await this.prisma.recurringTransaction.findFirst({ where: { id, userId } });
    if (!rec) throw new NotFoundException('Recurring transaction not found');
    return rec;
  }

  private firstNextDue(
    frequency: string,
    startDate: Date,
    dayOfMonth?: number | null,
    dayOfWeek?: number | null,
  ): Date {
    const now = new Date();

    if (frequency === 'MONTHLY') {
      const day = dayOfMonth ?? startDate.getDate();
      let d = new Date(now.getFullYear(), now.getMonth(), day);
      if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return d;
    }

    if (frequency === 'WEEKLY') {
      const target = dayOfWeek ?? startDate.getDay();
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      let diff = target - d.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return d;
    }

    // YEARLY — same month/day as start, next future occurrence
    const d = new Date(now.getFullYear(), startDate.getMonth(), startDate.getDate());
    if (d <= now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  private advanceNextDue(frequency: string, current: Date, dayOfMonth: number | null): Date {
    const d = new Date(current);
    if (frequency === 'MONTHLY') {
      d.setMonth(d.getMonth() + 1);
      if (dayOfMonth) d.setDate(dayOfMonth);
    } else if (frequency === 'WEEKLY') {
      d.setDate(d.getDate() + 7);
    } else {
      d.setFullYear(d.getFullYear() + 1);
    }
    return d;
  }
}
