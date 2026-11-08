import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType, ImportSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategorizerService } from '../import/categorizer.service';
import { SmsParserService, RawSms, ParsedSmsTransaction } from './sms-parser.service';

export interface SmsSyncResult {
  imported: number;
  skipped: number;       // already existed (same SMS, same UPI ref, or a manual/statement entry)
  failed: number;
  atmTransactions: AtmEntry[];  // returned so mobile can prompt user
}

export interface AtmEntry {
  amount: number;
  date: string;
  rawSms: string;
}

@Injectable()
export class SmsSyncService {
  constructor(
    private prisma: PrismaService,
    private parser: SmsParserService,
    private categorizer: CategorizerService,
  ) {}

  private async resolveUserId(clerkId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    return user.id;
  }

  async sync(clerkId: string, messages: RawSms[]): Promise<SmsSyncResult> {
    const userId = await this.resolveUserId(clerkId);
    // Oldest first, so a same-day manual entry is matched by the earliest SMS.
    const parsed = this.parser.parse(messages).sort((a, b) => a.date.getTime() - b.date.getTime());

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const atmTransactions: AtmEntry[] = [];

    // Link each SMS to the user's Bank ("IOB", "TMB") so it gets that colour.
    const banks = parsed.length
      ? await this.prisma.bank.findMany({ where: { userId }, select: { id: true, name: true } })
      : [];
    // Manual/statement rows already matched to an SMS in this run — each can
    // absorb only one SMS, so two real ₹20 payments on one day both import.
    const claimed = new Set<string>();

    for (const tx of parsed) {
      try {
        if (await this.isDuplicate(userId, tx, claimed)) {
          skipped++;
          continue;
        }

        const categoryId = this.categorizer.getCategoryId(tx.merchant) || undefined;

        await this.prisma.transaction.create({
          data: {
            userId,
            merchant: tx.merchant,
            amount: tx.amount,
            date: tx.date,
            type: tx.type,
            source: tx.source,
            upiRef: tx.upiRef ?? undefined,
            description: null,
            categoryId,
            bankId: this.matchBank(banks, tx.bank),
          },
        });

        imported++;

        // Track ATM transactions to prompt cash-in-hand on mobile
        if (tx.isAtm && tx.type === TransactionType.DEBIT) {
          atmTransactions.push({
            amount: tx.amount,
            date: tx.date.toISOString(),
            rawSms: tx.rawSms,
          });
        }
      } catch (e) {
        // A unique-constraint hit means this exact transaction already exists
        // (e.g. a race with a parallel sync) — that's a skip, not a failure.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') skipped++;
        else failed++;
      }
    }

    // Update last SMS sync timestamp
    await this.prisma.user.update({
      where: { clerkId },
      data: { smsSyncedAt: new Date() },
    });

    return { imported, skipped, failed, atmTransactions };
  }

  private matchBank(banks: { id: string; name: string }[], hint: string | null): string | undefined {
    if (!hint) return undefined;
    const h = hint.toLowerCase();
    const bank = banks.find(b => {
      const n = b.name.trim().toLowerCase();
      return n === h || n.includes(h) || h.includes(n);
    });
    return bank?.id;
  }

  // Three-tier deduplication
  private async isDuplicate(userId: string, tx: ParsedSmsTransaction, claimed: Set<string>): Promise<boolean> {
    // Tier 1: the very same SMS read again (same merchant, amount and exact
    // timestamp — the transaction table's unique key).
    const sameSms = await this.prisma.transaction.findFirst({
      where: { userId, merchant: tx.merchant, amount: tx.amount, date: tx.date },
      select: { id: true },
    });
    if (sameSms) return true;

    // Tier 2: UPI / reference number match — most reliable across sources
    if (tx.upiRef) {
      const existing = await this.prisma.transaction.findUnique({
        where: { userId_upiRef: { userId, upiRef: tx.upiRef } },
        select: { id: true },
      });
      if (existing) return true;
    }

    // Tier 3: same amount + type on the same day, but only against entries
    // that did NOT come from SMS (typed in manually or from a statement). Two
    // SMS for the same amount on one day are two real payments, not duplicates.
    const dayStart = new Date(tx.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(tx.date);
    dayEnd.setHours(23, 59, 59, 999);

    const sameDay = await this.prisma.transaction.findMany({
      where: {
        userId,
        amount: tx.amount,
        type: tx.type,
        source: { not: ImportSource.SMS },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });
    const match = sameDay.find(r => !claimed.has(r.id));
    if (match) {
      claimed.add(match.id);
      return true;
    }
    return false;
  }

  // Return the last SMS sync date so mobile knows where to start reading from
  async getLastSyncDate(clerkId: string): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { smsSyncedAt: true },
    });
    return user?.smsSyncedAt ?? null;
  }
}
