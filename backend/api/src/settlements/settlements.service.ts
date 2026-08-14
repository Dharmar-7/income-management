import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSettlementDto, AddEntryDto, SettleDto } from './dto/create-settlement.dto';
import {
  naturalTxType, settlementStatus, outstanding,
  type Direction, type Leg,
} from './settlement.util';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class SettlementsService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string) {
    return this.prisma.resolveUserId(clerkId);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async findAll(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const settlements = await this.prisma.settlement.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { transferredAt: 'desc' }],
      include: { entries: { orderBy: { occurredAt: 'asc' } } },
    });

    const txMap = await this.loadTxSnippets(settlements);
    return settlements.map(s => this.enrich(s, txMap));
  }

  private async getOne(userId: string, id: string) {
    const s = await this.prisma.settlement.findFirst({
      where: { id, userId },
      include: { entries: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!s) throw new NotFoundException('Settlement not found');
    const txMap = await this.loadTxSnippets([s]);
    return this.enrich(s, txMap);
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(clerkId: string, dto: CreateSettlementDto) {
    const userId = await this.resolveUserId(clerkId);

    // Accept the new principals[] shape, or fall back to the legacy single-leg
    // shape older app builds still send.
    let principals = dto.principals;
    if (!principals || principals.length === 0) {
      if (dto.amount == null) {
        throw new BadRequestException('Add at least one transaction or amount.');
      }
      principals = [{ amount: dto.amount, transactionId: dto.originalTxId, occurredAt: dto.transferredAt }];
    }

    // Resolve each linked transaction first (a partial share splits the tx).
    const resolved = [] as { amount: number; occurredAt?: string; note?: string; transactionId: string | null }[];
    for (const p of principals) {
      const transactionId = p.transactionId
        ? await this.attachTransaction(userId, p.transactionId, p.amount)
        : null;
      resolved.push({ amount: p.amount, occurredAt: p.occurredAt, note: p.note, transactionId });
    }

    const totalPrincipal = round2(resolved.reduce((sum, r) => sum + r.amount, 0));
    const dates = resolved.map(r => (r.occurredAt ? new Date(r.occurredAt) : new Date()));
    const transferredAt = dates.reduce((a, b) => (a < b ? a : b));

    const settlement = await this.prisma.settlement.create({
      data: {
        userId,
        personName: dto.personName.trim(),
        direction: dto.direction,
        amount: totalPrincipal,
        status: settlementStatus(totalPrincipal, 0),
        transferredAt,
        note: dto.note?.trim() || null,
        entries: {
          create: resolved.map(r => ({
            kind: 'PRINCIPAL' as const,
            amount: r.amount,
            occurredAt: r.occurredAt ? new Date(r.occurredAt) : new Date(),
            transactionId: r.transactionId,
            note: r.note ?? null,
          })),
        },
      },
    });

    return this.getOne(userId, settlement.id);
  }

  // ── Entries (add another send / record a return) ────────────────────────────

  async addEntry(clerkId: string, id: string, dto: AddEntryDto) {
    const userId = await this.resolveUserId(clerkId);
    const settlement = await this.assertOwner(userId, id);
    await this.ensureEntries(settlement);

    const transactionId = dto.transactionId
      ? await this.attachTransaction(userId, dto.transactionId, dto.amount)
      : null;

    await this.prisma.settlementEntry.create({
      data: {
        settlementId: id,
        kind: dto.kind,
        amount: dto.amount,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        transactionId,
        note: dto.note ?? null,
      },
    });

    await this.recompute(id, settlement.direction as Direction);
    return this.getOne(userId, id);
  }

  async removeEntry(clerkId: string, id: string, entryId: string) {
    const userId = await this.resolveUserId(clerkId);
    const settlement = await this.assertOwner(userId, id);
    await this.ensureEntries(settlement);

    const entry = await this.prisma.settlementEntry.findFirst({
      where: { id: entryId, settlementId: id },
    });
    if (!entry) throw new NotFoundException('Entry not found');

    if (entry.transactionId) {
      await this.restoreTx(userId, entry.transactionId, settlement.direction as Direction, entry.kind as Leg);
    }
    await this.prisma.settlementEntry.delete({ where: { id: entryId } });

    await this.recompute(id, settlement.direction as Direction);
    return this.getOne(userId, id);
  }

  // Quick "settle in full" — records a REPAYMENT for the whole outstanding balance.
  async settle(clerkId: string, id: string, dto: SettleDto) {
    const userId = await this.resolveUserId(clerkId);
    const settlement = await this.assertOwner(userId, id);
    await this.ensureEntries(settlement);

    const { totalPrincipal, totalRepaid } = await this.totals(id);
    const bal = outstanding(totalPrincipal, totalRepaid);
    const amount = dto.amount ?? (bal > 0 ? bal : 0);
    if (amount <= 0) throw new BadRequestException('Nothing left to settle on this tab.');

    const transactionId = dto.repaymentTxId
      ? await this.attachTransaction(userId, dto.repaymentTxId, amount)
      : null;

    await this.prisma.settlementEntry.create({
      data: {
        settlementId: id,
        kind: 'REPAYMENT',
        amount,
        occurredAt: dto.settledAt ? new Date(dto.settledAt) : new Date(),
        transactionId,
      },
    });

    await this.recompute(id, settlement.direction as Direction);
    return this.getOne(userId, id);
  }

  // Delete the whole tab — restore every linked transaction to its natural type.
  async cancel(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const settlement = await this.prisma.settlement.findFirst({
      where: { id, userId },
      include: { entries: true },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');

    const dir = settlement.direction as Direction;
    const restores: Promise<unknown>[] = [];
    for (const e of settlement.entries) {
      if (e.transactionId) restores.push(this.restoreTx(userId, e.transactionId, dir, e.kind as Leg));
    }
    // Legacy links that were never migrated to entries.
    if (settlement.originalTxId) restores.push(this.restoreTx(userId, settlement.originalTxId, dir, 'PRINCIPAL'));
    if (settlement.repaymentTxId) restores.push(this.restoreTx(userId, settlement.repaymentTxId, dir, 'REPAYMENT'));
    await Promise.all(restores);

    await this.prisma.settlement.delete({ where: { id } }); // cascades entries
    return { ok: true };
  }

  // Finds pending settlements a given transaction could settle (used by the
  // transactions screen's "link this to a settlement" helper).
  async getSuggestions(clerkId: string, txId: string) {
    const userId = await this.resolveUserId(clerkId);
    const tx = await this.prisma.transaction.findFirst({ where: { id: txId, userId } });
    if (!tx) return [];

    // A CREDIT could return money you SENT; a DEBIT could repay money you RECEIVED.
    const matchDirection = tx.type === 'CREDIT' ? 'SENT' : 'RECEIVED';
    const windowMs = 3 * 24 * 60 * 60 * 1000;

    return this.prisma.settlement.findMany({
      where: {
        userId,
        direction: matchDirection,
        status: 'PENDING',
        transferredAt: {
          gte: new Date(tx.date.getTime() - windowMs),
          lte: new Date(tx.date.getTime() + windowMs),
        },
      },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async assertOwner(userId: string, id: string) {
    const s = await this.prisma.settlement.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException('Settlement not found');
    return s;
  }

  // Migrate a legacy 1:1 settlement into entries the first time it's mutated, so
  // all downstream logic can treat every settlement uniformly. Idempotent.
  private async ensureEntries(settlement: {
    id: string; amount: number; status: string; transferredAt: Date;
    settledAt: Date | null; originalTxId: string | null; repaymentTxId: string | null;
  }) {
    const count = await this.prisma.settlementEntry.count({ where: { settlementId: settlement.id } });
    if (count > 0) return;

    const creates: any[] = [
      {
        kind: 'PRINCIPAL',
        amount: settlement.amount,
        occurredAt: settlement.transferredAt,
        transactionId: settlement.originalTxId ?? null,
      },
    ];
    if (settlement.status === 'SETTLED') {
      creates.push({
        kind: 'REPAYMENT',
        amount: settlement.amount,
        occurredAt: settlement.settledAt ?? settlement.transferredAt,
        transactionId: settlement.repaymentTxId ?? null,
      });
    }

    await this.prisma.settlement.update({
      where: { id: settlement.id },
      data: { originalTxId: null, repaymentTxId: null, entries: { create: creates } },
    });
  }

  private async totals(id: string) {
    const grouped = await this.prisma.settlementEntry.groupBy({
      by: ['kind'],
      where: { settlementId: id },
      _sum: { amount: true },
    });
    const sum = (k: string) => grouped.find(g => g.kind === k)?._sum.amount ?? 0;
    return { totalPrincipal: round2(sum('PRINCIPAL')), totalRepaid: round2(sum('REPAYMENT')) };
  }

  private async recompute(id: string, _direction: Direction) {
    const { totalPrincipal, totalRepaid } = await this.totals(id);
    const status = settlementStatus(totalPrincipal, totalRepaid);
    const cur = await this.prisma.settlement.findUnique({ where: { id }, select: { settledAt: true } });
    await this.prisma.settlement.update({
      where: { id },
      data: {
        amount: totalPrincipal,
        status,
        settledAt: status === 'SETTLED' ? (cur?.settledAt ?? new Date()) : null,
      },
    });
  }

  // Attach a transaction to a leg and return the id to store on the entry.
  //  - Whole transaction on the tab → re-type it TRANSFER, return its id.
  //  - Only PART of it is the other person's (share < tx amount) → split: the
  //    original keeps the remainder as your real expense/income, and a new
  //    TRANSFER row for the settled share is created and linked instead.
  private async attachTransaction(userId: string, txId: string, share: number): Promise<string> {
    const tx = await this.prisma.transaction.findFirst({ where: { id: txId, userId } });
    if (!tx) throw new NotFoundException(`Transaction ${txId} not found`);

    const EPS = 0.005;
    if (share >= tx.amount - EPS) {
      // Whole transaction belongs on the tab.
      await this.prisma.transaction.update({ where: { id: txId }, data: { type: 'TRANSFER' as any } });
      return txId;
    }

    // Partial: carve the settled share off into its own TRANSFER row. The " · split"
    // suffix keeps the (user, merchant, amount, date) unique key distinct even
    // when the two halves are equal. upiRef is intentionally not copied (unique).
    const child = await this.prisma.transaction.create({
      data: {
        userId,
        amount: round2(share),
        merchant: `${tx.merchant} · split`.slice(0, 200),
        description: tx.description ? `${tx.description} (settled share)` : 'Settled share',
        date: tx.date,
        type: 'TRANSFER' as any,
        source: tx.source,
        categoryId: tx.categoryId ?? null,
        bankId: tx.bankId ?? null,
      },
    });
    await this.prisma.transaction.update({
      where: { id: txId },
      data: { amount: round2(tx.amount - share) },
    });
    return child.id;
  }

  private async restoreTx(userId: string, txId: string, direction: Direction, kind: Leg) {
    const type = naturalTxType(direction, kind);
    await this.prisma.transaction.updateMany({ where: { id: txId, userId }, data: { type: type as any } });
  }

  // Fetch snippet data for every transaction linked across a set of settlements.
  private async loadTxSnippets(settlements: any[]) {
    const ids = new Set<string>();
    for (const s of settlements) {
      for (const e of s.entries ?? []) if (e.transactionId) ids.add(e.transactionId);
      if (s.originalTxId) ids.add(s.originalTxId);
      if (s.repaymentTxId) ids.add(s.repaymentTxId);
    }
    const map = new Map<string, any>();
    if (ids.size > 0) {
      const txs = await this.prisma.transaction.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, merchant: true, amount: true, date: true, type: true },
      });
      txs.forEach(t => map.set(t.id, t));
    }
    return map;
  }

  // Normalise a settlement (entries-based OR legacy) into the shape the app renders.
  private enrich(s: any, txMap: Map<string, any>) {
    type ViewEntry = {
      id: string; kind: 'PRINCIPAL' | 'REPAYMENT'; amount: number;
      occurredAt: Date; note: string | null; transaction: any | null;
    };

    let entries: ViewEntry[];
    if ((s.entries ?? []).length > 0) {
      entries = s.entries.map((e: any) => ({
        id: e.id, kind: e.kind, amount: e.amount, occurredAt: e.occurredAt, note: e.note,
        transaction: e.transactionId ? txMap.get(e.transactionId) ?? null : null,
      }));
    } else {
      // Legacy 1:1 settlement synthesised into entries for a uniform UI.
      entries = [{
        id: `legacy-p-${s.id}`, kind: 'PRINCIPAL', amount: s.amount,
        occurredAt: s.transferredAt, note: null,
        transaction: s.originalTxId ? txMap.get(s.originalTxId) ?? null : null,
      }];
      if (s.status === 'SETTLED') {
        entries.push({
          id: `legacy-r-${s.id}`, kind: 'REPAYMENT', amount: s.amount,
          occurredAt: s.settledAt ?? s.transferredAt, note: null,
          transaction: s.repaymentTxId ? txMap.get(s.repaymentTxId) ?? null : null,
        });
      }
    }
    entries.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const totalPrincipal = round2(entries.filter(e => e.kind === 'PRINCIPAL').reduce((n, e) => n + e.amount, 0));
    const totalRepaid = round2(entries.filter(e => e.kind === 'REPAYMENT').reduce((n, e) => n + e.amount, 0));

    return {
      id: s.id,
      personName: s.personName,
      direction: s.direction,
      status: s.status,
      note: s.note,
      transferredAt: s.transferredAt,
      settledAt: s.settledAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      amount: totalPrincipal, // back-compat: "amount" = total sent/received
      totalPrincipal,
      totalRepaid,
      outstanding: outstanding(totalPrincipal, totalRepaid),
      entries,
    };
  }
}
