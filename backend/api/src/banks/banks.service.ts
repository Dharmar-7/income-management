import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { naturalTxType } from '../settlements/settlement.util';
import { happenedAfter, istDayStart, moneyDirection, trackedBalance, type TxType } from './bank-balance.util';

@Injectable()
export class BanksService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  // List banks, each enriched with how many transactions use it and the date of
  // the most recent one (answers "when did I last add a transaction for X bank?").
  async findAll(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const [banks, grouped, lastDates] = await Promise.all([
      this.prisma.bank.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.transaction.groupBy({
        by: ['bankId'],
        where: { userId, bankId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['bankId'],
        where: { userId, bankId: { not: null } },
        _max: { date: true },
      }),
    ]);

    const countMap = new Map(grouped.map(g => [g.bankId, g._count._all]));
    const lastMap = new Map(lastDates.map(g => [g.bankId, g._max.date]));
    const tracked = await this.trackBalances(userId, banks);

    return banks.map(b => ({
      ...b,
      transactionCount: countMap.get(b.id) ?? 0,
      lastTransactionAt: lastMap.get(b.id) ?? null,
      // null when the user hasn't set a balance for this bank
      tracked: tracked.get(b.id) ?? null,
    }));
  }

  // For banks with a typed-in balance: move it forward by the bank's
  // transactions since then. Only runs queries when some balance is set.
  private async trackBalances(userId: string, banks: { id: string; balance: number | null; balanceAt: Date | null }[]) {
    const out = new Map<string, ReturnType<typeof trackedBalance>>();
    const anchored = banks.filter(b => b.balance != null && b.balanceAt != null);
    if (anchored.length === 0) return out;

    const since = new Date(Math.min(...anchored.map(b => istDayStart(b.balanceAt!).getTime())));
    const txs = await this.prisma.transaction.findMany({
      where: { userId, bankId: { in: anchored.map(b => b.id) }, date: { gte: since } },
      select: { id: true, bankId: true, amount: true, type: true, date: true, createdAt: true },
    });

    // Settlement legs are re-typed TRANSFER; their real direction comes from the tab.
    const transferIds = txs.filter(t => t.type === 'TRANSFER').map(t => t.id);
    const transferAs = new Map<string, 'DEBIT' | 'CREDIT'>();
    if (transferIds.length > 0) {
      const legs = await this.prisma.settlementEntry.findMany({
        where: { transactionId: { in: transferIds } },
        select: { transactionId: true, kind: true, settlement: { select: { direction: true } } },
      });
      for (const l of legs) {
        if (l.transactionId) transferAs.set(l.transactionId, naturalTxType(l.settlement.direction as any, l.kind as any));
      }
    }

    for (const b of anchored) {
      const moves = txs
        .filter(t => t.bankId === b.id && happenedAfter(t, b.balanceAt!))
        .map(t => ({ amount: t.amount, direction: moneyDirection(t.type as TxType, transferAs.get(t.id) ?? null) }));
      out.set(b.id, trackedBalance(b.balance!, moves));
    }
    return out;
  }

  async create(clerkId: string, dto: CreateBankDto) {
    const userId = await this.resolveUserId(clerkId);
    try {
      return await this.prisma.bank.create({
        data: { userId, name: dto.name.trim(), color: dto.color?.trim() || 'indigo' },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Bank "${dto.name}" already exists.`);
      throw e;
    }
  }

  async update(clerkId: string, id: string, dto: UpdateBankDto) {
    const userId = await this.resolveUserId(clerkId);
    await this.assertOwned(userId, id);
    try {
      return await this.prisma.bank.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.color !== undefined && { color: dto.color?.trim() || 'indigo' }),
          // Setting a balance re-anchors tracking at this moment.
          ...(dto.balance !== undefined && {
            balance: dto.balance,
            balanceAt: dto.balance === null ? null : new Date(),
          }),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Bank "${dto.name}" already exists.`);
      throw e;
    }
  }

  // Deleting a bank leaves its transactions intact (bankId → null via SetNull).
  async remove(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    await this.assertOwned(userId, id);
    await this.prisma.bank.delete({ where: { id } });
    return { message: 'Bank deleted.' };
  }

  private async assertOwned(userId: string, id: string) {
    const bank = await this.prisma.bank.findFirst({ where: { id, userId } });
    if (!bank) throw new NotFoundException('Bank not found.');
    return bank;
  }
}
