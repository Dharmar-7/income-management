import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CashFlow, CashSource } from '@prisma/client';
import { AddCashDto } from './dto/add-cash.dto';
import { SpendCashDto } from './dto/spend-cash.dto';

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  // Current cash balance = SUM(IN) - SUM(OUT)
  async getBalance(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);

    // Single grouped query — sums IN and OUT in one DB round-trip.
    const grouped = await this.prisma.cashTransaction.groupBy({
      by: ['flow'],
      where: { userId },
      _sum: { amount: true },
    });
    const sumByFlow = (f: CashFlow) =>
      grouped.find(g => g.flow === f)?._sum.amount ?? 0;

    const totalIn = sumByFlow(CashFlow.IN);
    const totalOut = sumByFlow(CashFlow.OUT);
    const balance = totalIn - totalOut;

    return { balance, totalIn, totalOut };
  }

  // Paginated history of all cash events
  async getHistory(clerkId: string, page = 1, limit = 20) {
    const userId = await this.resolveUserId(clerkId);

    const [data, total] = await Promise.all([
      this.prisma.cashTransaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cashTransaction.count({ where: { userId } }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // Add cash in (ATM, person, other)
  async addCash(clerkId: string, dto: AddCashDto) {
    const userId = await this.resolveUserId(clerkId);

    return this.prisma.cashTransaction.create({
      data: {
        userId,
        amount: dto.amount,
        flow: CashFlow.IN,
        source: dto.source as CashSource,
        note: dto.note?.trim() || null,
        date: new Date(dto.date),
      },
    });
  }

  // Spend or deposit cash out
  async spendCash(clerkId: string, dto: SpendCashDto) {
    const userId = await this.resolveUserId(clerkId);

    // Guard: can't spend more than current balance
    const { balance } = await this.getBalance(clerkId);
    if (dto.amount > balance) {
      throw new BadRequestException(
        `Insufficient cash. You have ₹${balance.toFixed(0)} in hand.`,
      );
    }

    // Mirror a "Cash Payment" (SPENT) as a DEBIT transaction so it shows in the
    // transactions list and monthly expense summary. DEPOSITED is just moving
    // money back to the bank — not an expense — so it gets no mirror.
    // Current time-of-day is stamped on the chosen date so two same-amount cash
    // payments on one day don't collide with the (userId, merchant, amount, date)
    // unique constraint.
    const now = new Date();
    const txDate = new Date(dto.date);
    txDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());

    const [entry] = await Promise.all([
      this.prisma.cashTransaction.create({
        data: {
          userId,
          amount: dto.amount,
          flow: CashFlow.OUT,
          source: dto.source as CashSource,
          note: dto.note?.trim() || null,
          date: new Date(dto.date),
        },
      }),
      dto.source === 'SPENT'
        ? this.prisma.transaction
            .create({
              data: {
                userId,
                amount: dto.amount,
                merchant: dto.note?.trim() || 'Cash Payment',
                description: 'Paid with cash in hand',
                date: txDate,
                type: 'DEBIT',
                source: 'MANUAL',
              },
            })
            .catch(() => null) // mirror is best-effort — never fail the cash entry
        : Promise.resolve(null),
    ]);
    return entry;
  }

  // Delete a cash transaction (to correct mistakes)
  async remove(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const entry = await this.prisma.cashTransaction.findUnique({ where: { id, userId } });
    if (!entry) throw new NotFoundException('Cash transaction not found.');
    await this.prisma.cashTransaction.delete({ where: { id } });
    return { message: 'Deleted.' };
  }
}
