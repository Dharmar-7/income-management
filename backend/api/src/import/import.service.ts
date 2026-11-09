import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportSource, Prisma, TransactionType } from '@prisma/client';
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

// Why a statement row wasn't imported, so the user can check it and add it anyway.
//   same-ref       — another transaction already has this UPI/reference number
//   same-entry     — same merchant, amount and date already in Transactions
//   repeat-in-file — the same row appears earlier in this statement
export type SkipReason = 'same-ref' | 'same-entry' | 'repeat-in-file';

export interface SkippedStatementRow {
  transaction: StatementTxnDto;
  reason: SkipReason;
  existing: {
    id: string;
    merchant: string;
    amount: number;
    date: Date;
    type: TransactionType;
    source: ImportSource;
  } | null;
}

type ExistingTxn = NonNullable<SkippedStatementRow['existing']> & { upiRef: string | null };

export interface StatementCommitSummary extends ImportSummary {
  skippedRows: SkippedStatementRow[];
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

  // Step 2: insert the rows the user kept. Rows that clash with an existing
  // transaction (or repeat within the file) are NOT silently dropped: they come
  // back in `skippedRows` with the reason and the matching transaction, so the
  // user can check them and re-send the real ones with `force`.
  // The whole batch can be tagged with one bank (colour-coded in the list).
  async commitStatement(
    clerkId: string,
    txns: StatementTxnDto[],
    bankId?: string,
    force = false,
  ): Promise<StatementCommitSummary> {
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

    if (force) return this.insertForced(rows, total);

    const select = { id: true, merchant: true, amount: true, date: true, type: true, source: true, upiRef: true };
    const refs = [...new Set(rows.map(r => r.upiRef).filter((r): r is string => !!r))];
    const dates = [...new Set(rows.map(r => r.date.getTime()))].map(ms => new Date(ms));
    // Two indexed lookups cover both unique keys: (userId, upiRef) and
    // (userId, merchant, amount, date).
    const [byRef, byDate] = await Promise.all([
      refs.length
        ? this.prisma.transaction.findMany({ where: { userId, upiRef: { in: refs } }, select })
        : Promise.resolve([] as ExistingTxn[]),
      this.prisma.transaction.findMany({ where: { userId, date: { in: dates } }, select }),
    ]);
    const key = (r: { merchant: string; amount: number; date: Date }) => `${r.merchant}|${r.amount}|${r.date.getTime()}`;
    const refMap = new Map<string, ExistingTxn>(byRef.map(e => [e.upiRef as string, e]));
    const keyMap = new Map<string, ExistingTxn>(byDate.map(e => [key(e), e]));

    const clean: typeof rows = [];
    const skippedRows: SkippedStatementRow[] = [];
    const seenKeys = new Set<string>();
    const seenRefs = new Set<string>();
    rows.forEach((r, i) => {
      const k = key(r);
      const refHit = r.upiRef ? refMap.get(r.upiRef) : undefined;
      const keyHit = keyMap.get(k);
      let reason: SkipReason | null = null;
      let existing: ExistingTxn | undefined;
      if (refHit) { reason = 'same-ref'; existing = refHit; }
      else if (keyHit) { reason = 'same-entry'; existing = keyHit; }
      else if (seenKeys.has(k) || (r.upiRef && seenRefs.has(r.upiRef))) reason = 'repeat-in-file';

      seenKeys.add(k);
      if (r.upiRef) seenRefs.add(r.upiRef);

      if (!reason) { clean.push(r); return; }
      skippedRows.push({
        transaction: txns[i],
        reason,
        existing: existing
          ? { id: existing.id, merchant: existing.merchant, amount: existing.amount, date: existing.date, type: existing.type, source: existing.source }
          : null,
      });
    });

    const result = clean.length
      ? await this.prisma.transaction.createMany({ data: clean, skipDuplicates: true }) // guards a race
      : { count: 0 };

    const imported = result.count;
    return { imported, skipped: total - imported, failed: 0, total, skippedRows };
  }

  // "Add anyway" for rows the user confirmed are real. A UPI/reference number
  // can belong to only one transaction, so a clashing ref is kept in the
  // description instead; a same merchant/amount/date clash (statements have no
  // time of day) is resolved by nudging the time forward by a second.
  private async insertForced(rows: Prisma.TransactionCreateManyInput[], total: number): Promise<StatementCommitSummary> {
    let imported = 0;
    let failed = 0;
    for (const row of rows) {
      const data = { ...row, date: new Date(row.date as Date) };
      if (data.upiRef) {
        const taken = await this.prisma.transaction.findUnique({
          where: { userId_upiRef: { userId: data.userId, upiRef: data.upiRef } },
          select: { id: true },
        });
        if (taken) {
          data.description = [data.description, `Ref: ${data.upiRef}`].filter(Boolean).join(' · ');
          data.upiRef = undefined;
        }
      }
      let saved = false;
      for (let attempt = 0; attempt < 60 && !saved; attempt++) {
        try {
          await this.prisma.transaction.create({ data });
          saved = true;
        } catch (e) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) break;
          data.date = new Date(data.date.getTime() + 1000);
        }
      }
      if (saved) imported++;
      else failed++;
    }
    return { imported, skipped: 0, failed, total, skippedRows: [] };
  }
}
