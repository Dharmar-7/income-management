import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { CreateSavingDto } from './dto/create-saving.dto';
import { UpdateSavingDto } from './dto/update-saving.dto';
import { findTransactionMatches, pickAutoLink } from '../common/transaction-match';

@Injectable()
export class SavingsService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  // ─── Platform (wallet) ────────────────────────────────────────────────────

  async createPlatform(clerkId: string, dto: CreatePlatformDto) {
    const userId = await this.resolveUserId(clerkId);
    try {
      return await this.prisma.investmentPlatform.create({
        data: { userId, name: dto.name.trim(), totalAdded: dto.totalAdded, note: dto.note?.trim() || null },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Platform "${dto.name}" already exists.`);
      throw e;
    }
  }

  async getPlatforms(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const platforms = await this.prisma.investmentPlatform.findMany({
      where: { userId },
      include: { savings: true },
      orderBy: { createdAt: 'asc' },
    });

    return platforms.map(p => {
      const totalInvested = p.savings.reduce((s, sv) => s + sv.investedAmount + sv.charges, 0);
      const totalCurrentValue = p.savings.reduce((s, sv) => s + sv.currentValue, 0);
      const balance = p.totalAdded - totalInvested;
      return { ...p, totalInvested, totalCurrentValue, balance };
    });
  }

  async updatePlatform(clerkId: string, platformId: string, dto: UpdatePlatformDto) {
    const userId = await this.resolveUserId(clerkId);
    const platform = await this.prisma.investmentPlatform.findUnique({ where: { id: platformId, userId } });
    if (!platform) throw new NotFoundException('Platform not found.');

    if (dto.totalAdded !== undefined) {
      // Guard: can't set totalAdded below what's already invested
      const savings = await this.prisma.saving.findMany({ where: { platformId } });
      const totalInvested = savings.reduce((s, sv) => s + sv.investedAmount + sv.charges, 0);
      if (dto.totalAdded < totalInvested) {
        throw new BadRequestException(
          `Total added (₹${dto.totalAdded}) cannot be less than already invested (₹${totalInvested.toFixed(0)}).`,
        );
      }
    }

    return this.prisma.investmentPlatform.update({
      where: { id: platformId },
      data: {
        ...(dto.totalAdded !== undefined && { totalAdded: dto.totalAdded }),
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
      },
    });
  }

  async removePlatform(clerkId: string, platformId: string) {
    const userId = await this.resolveUserId(clerkId);
    const platform = await this.prisma.investmentPlatform.findUnique({ where: { id: platformId, userId } });
    if (!platform) throw new NotFoundException('Platform not found.');
    await this.prisma.investmentPlatform.delete({ where: { id: platformId } });
    return { message: 'Platform deleted.' };
  }

  // ─── Individual savings ───────────────────────────────────────────────────

  async createSaving(clerkId: string, dto: CreateSavingDto) {
    const userId = await this.resolveUserId(clerkId);

    // If linked to a platform, verify it belongs to this user
    if (dto.platformId) {
      const platform = await this.prisma.investmentPlatform.findUnique({
        where: { id: dto.platformId, userId },
        include: { savings: true },
      });
      if (!platform) throw new NotFoundException('Platform not found.');

      const totalInvested = platform.savings.reduce((s, sv) => s + sv.investedAmount + sv.charges, 0);
      const newCost = dto.investedAmount + dto.charges;
      const balance = platform.totalAdded - totalInvested;

      if (newCost > balance) {
        throw new BadRequestException(
          `Insufficient platform balance. Available: ₹${balance.toFixed(0)}, needed: ₹${newCost.toFixed(0)}.`,
        );
      }
    }

    return this.prisma.saving.create({
      data: {
        userId,
        platformId: dto.platformId || null,
        name: dto.name.trim(),
        type: dto.type,
        investedAmount: dto.investedAmount,
        charges: dto.charges,
        // Current value defaults to the invested amount when not supplied.
        currentValue: dto.currentValue ?? dto.investedAmount,
        sipAmount: dto.sipAmount ?? null,
        startDate: new Date(dto.startDate),
        maturityDate: dto.maturityDate ? new Date(dto.maturityDate) : null,
        note: dto.note?.trim() || null,
      },
      include: { platform: true },
    });
  }

  async getSavings(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const savings = await this.prisma.saving.findMany({
      where: { userId },
      include: { platform: true },
      orderBy: { startDate: 'desc' },
    });

    return savings.map(s => ({
      ...s,
      netCost: s.investedAmount + s.charges,
      gainLoss: s.currentValue - (s.investedAmount + s.charges),
      gainPercent: (((s.currentValue - (s.investedAmount + s.charges)) / (s.investedAmount + s.charges)) * 100),
    }));
  }

  async updateSaving(clerkId: string, savingId: string, dto: UpdateSavingDto) {
    const userId = await this.resolveUserId(clerkId);
    const saving = await this.prisma.saving.findUnique({ where: { id: savingId, userId } });
    if (!saving) throw new NotFoundException('Investment not found.');

    // Where will this investment live after the edit — same platform, a new one,
    // or standalone? (undefined in the DTO = "leave as-is".)
    const targetPlatformId =
      dto.platformId !== undefined ? dto.platformId || null : saving.platformId;

    // If it ends up on a platform, its new cost must still fit that wallet's
    // balance — counting every OTHER investment on the platform but not this
    // one's old cost (which we're about to replace).
    if (targetPlatformId) {
      const platform = await this.prisma.investmentPlatform.findUnique({
        where: { id: targetPlatformId, userId },
        include: { savings: true },
      });
      if (!platform) throw new NotFoundException('Platform not found.');

      const newInvested = dto.investedAmount ?? saving.investedAmount;
      const newCharges = dto.charges ?? saving.charges;
      const newCost = newInvested + newCharges;
      const otherCost = platform.savings
        .filter(s => s.id !== savingId)
        .reduce((sum, s) => sum + s.investedAmount + s.charges, 0);
      const available = platform.totalAdded - otherCost;

      if (newCost > available) {
        throw new BadRequestException(
          `Insufficient ${platform.name} balance. Available: ₹${available.toFixed(0)}, needed: ₹${newCost.toFixed(0)}.`,
        );
      }
    }

    return this.prisma.saving.update({
      where: { id: savingId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.investedAmount !== undefined && { investedAmount: dto.investedAmount }),
        ...(dto.charges !== undefined && { charges: dto.charges }),
        ...(dto.currentValue !== undefined && { currentValue: dto.currentValue }),
        ...(dto.sipAmount !== undefined && { sipAmount: dto.sipAmount || null }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.maturityDate !== undefined && {
          maturityDate: dto.maturityDate ? new Date(dto.maturityDate) : null,
        }),
        ...(dto.platformId !== undefined && { platformId: dto.platformId || null }),
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
      },
      include: { platform: true },
    });
  }

  // Add one contribution to an existing investment — the monthly SIP top-up.
  // Increases both the invested principal and the current value by `amount`
  // (a fresh contribution is worth what you put in until the market moves), so
  // it never creates an artificial gain or loss. `amount` defaults to the
  // investment's stored monthly sipAmount.
  // Candidate bank transactions this SIP contribution could map to.
  async getContributionMatches(clerkId: string, savingId: string, amount?: number) {
    const userId = await this.resolveUserId(clerkId);
    const saving = await this.prisma.saving.findUnique({ where: { id: savingId, userId } });
    if (!saving) throw new NotFoundException('Investment not found.');
    const amt = amount ?? saving.sipAmount ?? 0;
    if (amt <= 0) return [];
    // SIP debits are imported as DEBIT (we reclassify to INVESTMENT on link).
    return findTransactionMatches(this.prisma, userId, {
      amount: amt, type: 'DEBIT', aroundDate: new Date(), windowDays: 7,
    });
  }

  async contribute(clerkId: string, savingId: string, amount?: number, transactionId?: string) {
    const userId = await this.resolveUserId(clerkId);
    const saving = await this.prisma.saving.findUnique({
      where: { id: savingId, userId },
      include: { platform: { include: { savings: true } } },
    });
    if (!saving) throw new NotFoundException('Investment not found.');

    const amt = amount ?? saving.sipAmount ?? 0;
    if (amt <= 0) {
      throw new BadRequestException(
        'No SIP amount is set for this investment. Set a monthly amount first, or pass an explicit amount.',
      );
    }

    // If it sits in a platform wallet, the contribution must fit the wallet's
    // remaining balance — same rule as creating an investment.
    if (saving.platform) {
      const totalInvested = saving.platform.savings.reduce(
        (s, sv) => s + sv.investedAmount + sv.charges,
        0,
      );
      const balance = saving.platform.totalAdded - totalInvested;
      if (amt > balance) {
        throw new BadRequestException(
          `Insufficient ${saving.platform.name} balance. Available: ₹${balance.toFixed(0)}, needed: ₹${amt.toFixed(0)}. Top up the platform first.`,
        );
      }
    }

    // Resolve the bank transaction this contribution maps to (if any).
    let linkedTxId: string | null = null;
    if (transactionId) {
      const tx = await this.prisma.transaction.findFirst({ where: { id: transactionId, userId } });
      if (!tx) throw new NotFoundException('Transaction to link not found.');
      linkedTxId = tx.id;
    } else {
      const matches = await findTransactionMatches(this.prisma, userId, {
        amount: amt, type: 'DEBIT', aroundDate: new Date(), windowDays: 7,
      });
      const auto = pickAutoLink(matches);
      if (auto) linkedTxId = auto.id;
    }

    // A fresh contribution is worth what you put in (no gain/loss yet), so bump
    // both invested and current value. Record the contribution, and reclassify
    // the linked bank debit to INVESTMENT so it drops out of monthly expenses.
    const [updated] = await this.prisma.$transaction([
      this.prisma.saving.update({
        where: { id: savingId },
        data: {
          investedAmount: saving.investedAmount + amt,
          currentValue: saving.currentValue + amt,
        },
        include: { platform: true },
      }),
      this.prisma.savingContribution.create({
        data: { savingId, userId, amount: amt, transactionId: linkedTxId },
      }),
      ...(linkedTxId
        ? [this.prisma.transaction.update({
            where: { id: linkedTxId },
            data: { type: 'INVESTMENT' as any },
          })]
        : []),
    ]);

    const netCost = updated.investedAmount + updated.charges;
    return {
      ...updated,
      netCost,
      gainLoss: updated.currentValue - netCost,
      gainPercent: netCost > 0 ? ((updated.currentValue - netCost) / netCost) * 100 : 0,
      contributed: amt,
      linkResult: { transactionId: linkedTxId, reclassified: !!linkedTxId },
    };
  }

  async removeSaving(clerkId: string, savingId: string) {
    const userId = await this.resolveUserId(clerkId);
    const saving = await this.prisma.saving.findUnique({ where: { id: savingId, userId } });
    if (!saving) throw new NotFoundException('Saving not found.');
    await this.prisma.saving.delete({ where: { id: savingId } });
    return { message: 'Saving deleted.' };
  }

  // ─── Portfolio summary ────────────────────────────────────────────────────

  async getSummary(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);

    // Aggregate in the database instead of fetching every row and reducing in
    // JS — one small round-trip regardless of how many investments exist.
    const agg = await this.prisma.saving.aggregate({
      where: { userId },
      _sum: { investedAmount: true, charges: true, currentValue: true },
      _count: true,
    });

    const totalInvested = agg._sum.investedAmount ?? 0;
    const totalCharges = agg._sum.charges ?? 0;
    const totalNetCost = totalInvested + totalCharges;
    const totalCurrentValue = agg._sum.currentValue ?? 0;
    const totalGainLoss = totalCurrentValue - totalNetCost;
    const totalGainPercent = totalNetCost > 0 ? (totalGainLoss / totalNetCost) * 100 : 0;

    return {
      totalInvested,
      totalCharges,
      totalNetCost,
      totalCurrentValue,
      totalGainLoss,
      totalGainPercent,
      count: agg._count,
    };
  }
}
