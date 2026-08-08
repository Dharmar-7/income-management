import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';

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

    return banks.map(b => ({
      ...b,
      transactionCount: countMap.get(b.id) ?? 0,
      lastTransactionAt: lastMap.get(b.id) ?? null,
    }));
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
