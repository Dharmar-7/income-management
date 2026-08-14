import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TakeoutParserService } from './takeout-parser.service';
import { CategorizerService } from './categorizer.service';
import { StatementParserService, ParsedStatementTxn } from './statement-parser.service';
import { StatementTxnDto } from './dto/commit-statement.dto';

export interface ImportSummary {
  imported: number;
  skipped: number;   // duplicates
  failed: number;    // rows that couldn't be parsed
  total: number;
}

// A parsed statement row plus the category we suggest for it (sent to the app for review).
export interface ReviewableStatementTxn extends ParsedStatementTxn {
  categoryId?: string;
}

@Injectable()
export class ImportService {
  constructor(
    private prisma: PrismaService,
    private parser: TakeoutParserService,
    private categorizer: CategorizerService,
    private statementParser: StatementParserService,
  ) {}

  // Resolve internal DB userId from Clerk ID
  private async resolveUserId(clerkId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found. Please log in again.');
    return user.id;
  }

  async importTakeout(fileBuffer: Buffer, clerkId: string): Promise<ImportSummary> {
    // 1. Resolve Clerk ID → internal DB user ID
    const userId = await this.resolveUserId(clerkId);

    // 2. Parse the raw JSON into clean transaction objects
    const transactions = this.parser.parse(fileBuffer);

    const total = transactions.length;

    // 3. Build the rows to insert and resolve categories
    const rows = transactions.map((tx) => ({
      userId,
      merchant: tx.merchant,
      amount: tx.amount,
      date: tx.date,
      type: tx.type,
      description: tx.description ?? undefined,
      source: tx.source,
      upiRef: tx.upiRef ?? undefined,
      categoryId: this.categorizer.getCategoryId(tx.merchant) || undefined,
    }));

    // 4. Insert all rows — skipDuplicates uses ON CONFLICT DO NOTHING at the DB level
    //    and returns only the count of rows actually inserted (not skipped ones).
    const result = await this.prisma.transaction.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const imported = result.count;
    const skipped = total - imported;
    const failed = 0;

    return { imported, skipped, failed, total };
  }

  // ── Bank statement (PDF / photo) ──────────────────────────────────────────────

  // Step 1: read the uploaded file and return parsed rows for the user to review.
  // Nothing is written to the DB here.
  async parseStatement(
    fileBuffer: Buffer,
    mimetype: string,
    clerkId: string,
    password?: string,
  ): Promise<{ transactions: ReviewableStatementTxn[]; count: number }> {
    await this.resolveUserId(clerkId); // ensure the user exists before doing work
    const parsed = await this.statementParser.parse(fileBuffer, mimetype, password);
    const transactions = parsed.map((t) => ({
      ...t,
      categoryId: this.categorizer.getCategoryId(t.merchant) || undefined,
    }));
    return { transactions, count: transactions.length };
  }

  // Step 2: insert the rows the user kept. Dedup is handled by skipDuplicates.
  // The whole batch can be tagged with one bank (colour-coded in the list).
  async commitStatement(clerkId: string, txns: StatementTxnDto[], bankId?: string): Promise<ImportSummary> {
    const userId = await this.resolveUserId(clerkId);
    const total = txns.length;

    const rows = txns.map((t) => ({
      userId,
      merchant: (t.merchant?.trim() || 'Bank transaction').slice(0, 200),
      amount: t.amount,
      date: new Date(t.date),
      type: t.type,
      description: t.description?.trim() || undefined,
      source: ImportSource.STATEMENT,
      upiRef: t.upiRef?.trim() || undefined,
      categoryId: t.categoryId || undefined,
      bankId: bankId || undefined,
    }));

    const result = await this.prisma.transaction.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const imported = result.count;
    return { imported, skipped: total - imported, failed: 0, total };
  }
}
