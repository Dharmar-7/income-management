import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, ImportSource } from '@prisma/client';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────
// jest.fn() creates a function that records calls and returns undefined by default.
// .mockResolvedValue() makes it return a Promise that resolves to the given value.
function makeMockPrisma() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    category: {
      findMany: jest.fn(),
    },
    loanPayment: { updateMany: jest.fn() },
    savingContribution: { updateMany: jest.fn() },
    settlementEntry: { updateMany: jest.fn() },
    settlement: { updateMany: jest.fn() },
    // Array form of $transaction: the ops are already-invoked mock calls, so just await them.
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  // Mirror PrismaService.resolveUserId so existing user.findUnique mocks still drive behaviour
  prisma.resolveUserId = jest.fn(async (clerkId: string) => {
    const u = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
    if (!u) throw new NotFoundException('User not found.');
    return u.id;
  });
  return prisma;
}

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: ReturnType<typeof makeMockPrisma>;

  const MOCK_USER = { id: 'internal-user-id' };
  const CLERK_ID = 'clerk_abc123';

  beforeEach(async () => {
    prisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  // ─── resolveUserId (tested indirectly via other methods) ──────────────────

  describe('when the user does not exist', () => {
    it('throws NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.findAll(CLERK_ID, {
          page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('filters by source (e.g. only SMS transactions)', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.findAll(CLERK_ID, {
        page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc', source: ImportSource.SMS,
      });

      expect(prisma.transaction.findMany.mock.calls[0][0].where.source).toBe(ImportSource.SMS);
      expect(prisma.transaction.count.mock.calls[0][0].where.source).toBe(ImportSource.SMS);
    });

    it('does not filter by source when none is given', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.findAll(CLERK_ID, { page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc' });

      expect(prisma.transaction.findMany.mock.calls[0][0].where).not.toHaveProperty('source');
    });

    it('returns paginated transactions with meta', async () => {
      const fakeTransactions = [
        { id: 'tx-1', merchant: 'Swiggy', amount: 450, type: TransactionType.DEBIT },
        { id: 'tx-2', merchant: 'Amazon', amount: 1200, type: TransactionType.DEBIT },
      ];
      prisma.transaction.findMany.mockResolvedValue(fakeTransactions);
      prisma.transaction.count.mockResolvedValue(2);

      const result = await service.findAll(CLERK_ID, {
        page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc',
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('calculates totalPages correctly', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(45);

      const result = await service.findAll(CLERK_ID, {
        page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc',
      });

      // 45 items / 20 per page = 3 pages (ceil)
      expect(result.meta.totalPages).toBe(3);
    });

    it('passes userId in the where clause (not clerkId)', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.findAll(CLERK_ID, {
        page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc',
      });

      // The query should use the internal userId, not the Clerk ID
      const whereClause = prisma.transaction.findMany.mock.calls[0][0].where;
      expect(whereClause.userId).toBe(MOCK_USER.id);
    });

    it('includes search filter when provided', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.findAll(CLERK_ID, {
        page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc', search: 'swiggy',
      });

      const whereClause = prisma.transaction.findMany.mock.calls[0][0].where;
      expect(whereClause.merchant).toEqual({ contains: 'swiggy', mode: 'insensitive' });
    });

    it('includes type filter when provided', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.findAll(CLERK_ID, {
        page: 1, limit: 20, sortBy: 'date', sortOrder: 'desc',
        type: TransactionType.DEBIT,
      });

      const whereClause = prisma.transaction.findMany.mock.calls[0][0].where;
      expect(whereClause.type).toBe(TransactionType.DEBIT);
    });
  });

  // ─── getSummary ───────────────────────────────────────────────────────────

  describe('getSummary', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('returns correct summary structure', async () => {
      prisma.transaction.groupBy.mockResolvedValue([
        { type: TransactionType.CREDIT, _sum: { amount: 50000 } },
        { type: TransactionType.DEBIT, _sum: { amount: 30000 } },
      ]);

      const result = await service.getSummary(CLERK_ID, 4, 2026);

      expect(result.totalIncome).toBe(50000);
      expect(result.totalExpenses).toBe(30000);
      expect(result.netSavings).toBe(20000);
      expect(result.month).toBe(4);
      expect(result.year).toBe(2026);
    });

    it('handles zero amounts (new user with no transactions)', async () => {
      prisma.transaction.groupBy.mockResolvedValue([]);

      const result = await service.getSummary(CLERK_ID, 4, 2026);

      expect(result.totalIncome).toBe(0);
      expect(result.totalExpenses).toBe(0);
      expect(result.netSavings).toBe(0);
    });

    it('calculates negative netSavings when expenses exceed income', async () => {
      prisma.transaction.groupBy.mockResolvedValue([
        { type: TransactionType.CREDIT, _sum: { amount: 10000 } },
        { type: TransactionType.DEBIT, _sum: { amount: 15000 } },
      ]);

      const result = await service.getSummary(CLERK_ID, 4, 2026);
      expect(result.netSavings).toBe(-5000);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('calls prisma.update with userId in the where clause (ownership check)', async () => {
      const updatedTx = { id: 'tx-1', description: 'Team lunch', category: null };
      prisma.transaction.update.mockResolvedValue(updatedTx);

      await service.update(CLERK_ID, 'tx-1', { description: 'Team lunch' });

      const updateArgs = prisma.transaction.update.mock.calls[0][0];
      // The where clause must include userId to prevent updating another user's transaction
      expect(updateArgs.where).toEqual({ id: 'tx-1', userId: MOCK_USER.id });
    });

    it('returns the updated transaction', async () => {
      const updatedTx = {
        id: 'tx-1',
        description: 'Updated note',
        category: { name: 'Food & Dining', icon: '🍽️' },
      };
      prisma.transaction.update.mockResolvedValue(updatedTx);

      const result = await service.update(CLERK_ID, 'tx-1', { description: 'Updated note' });
      expect(result).toEqual(updatedTx);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('creates a transaction with source = MANUAL', async () => {
      const created = { id: 'tx-new', merchant: 'Local Shop', source: ImportSource.MANUAL };
      prisma.transaction.create.mockResolvedValue(created);

      const result = await service.create(CLERK_ID, {
        merchant: 'Local Shop',
        amount: 200,
        type: TransactionType.DEBIT,
        date: '2026-05-09',
      });

      expect(result).toEqual(created);
      const createData = prisma.transaction.create.mock.calls[0][0].data;
      expect(createData.source).toBe(ImportSource.MANUAL);
    });

    it('trims whitespace from merchant name', async () => {
      prisma.transaction.create.mockResolvedValue({ id: 'tx-new' });

      await service.create(CLERK_ID, {
        merchant: '  Kirana Store  ',
        amount: 150,
        type: TransactionType.DEBIT,
        date: '2026-05-09',
      });

      const createData = prisma.transaction.create.mock.calls[0][0].data;
      expect(createData.merchant).toBe('Kirana Store');
    });

    it('throws ConflictException on Prisma P2002 (duplicate)', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      prisma.transaction.create.mockRejectedValue(p2002);

      await expect(
        service.create(CLERK_ID, {
          merchant: 'Shop', amount: 100,
          type: TransactionType.DEBIT, date: '2026-05-09',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('uses the internal userId (not clerkId) in the create data', async () => {
      prisma.transaction.create.mockResolvedValue({ id: 'tx-new' });

      await service.create(CLERK_ID, {
        merchant: 'Shop', amount: 100,
        type: TransactionType.DEBIT, date: '2026-05-09',
      });

      const createData = prisma.transaction.create.mock.calls[0][0].data;
      expect(createData.userId).toBe(MOCK_USER.id);
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('deletes a MANUAL transaction and returns a message', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
      prisma.transaction.delete.mockResolvedValue({});

      const result = await service.remove(CLERK_ID, 'tx-1');
      expect(result).toEqual({ message: 'Transaction deleted.' });
      expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: 'tx-1' } });
    });

    it('deletes imported (SMS / statement) transactions too', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: 'tx-sms' });
      prisma.transaction.delete.mockResolvedValue({});

      await service.remove(CLERK_ID, 'tx-sms');
      expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: 'tx-sms' } });
    });

    it('only looks the transaction up within the current user', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
      await service.remove(CLERK_ID, 'tx-1');
      expect(prisma.transaction.findUnique.mock.calls[0][0].where).toEqual({ id: 'tx-1', userId: MOCK_USER.id });
    });

    it('unlinks loan payments, saving contributions and settlements in the same DB transaction', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
      await service.remove(CLERK_ID, 'tx-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const unlink = { data: { transactionId: null }, where: { transactionId: 'tx-1' } };
      expect(prisma.loanPayment.updateMany).toHaveBeenCalledWith(unlink);
      expect(prisma.savingContribution.updateMany).toHaveBeenCalledWith(unlink);
      expect(prisma.settlementEntry.updateMany).toHaveBeenCalledWith(unlink);
      expect(prisma.settlement.updateMany).toHaveBeenCalledWith({ where: { originalTxId: 'tx-1' }, data: { originalTxId: null } });
      expect(prisma.settlement.updateMany).toHaveBeenCalledWith({ where: { repaymentTxId: 'tx-1' }, data: { repaymentTxId: null } });
    });

    it('throws NotFoundException when transaction does not exist', async () => {
      prisma.transaction.findUnique.mockResolvedValue(null);

      await expect(service.remove(CLERK_ID, 'missing-id')).rejects.toThrow(NotFoundException);
      expect(prisma.transaction.delete).not.toHaveBeenCalled();
    });
  });

  // ─── getHistory (compact rows for on-device analysis) ─────────────────────

  describe('getHistory', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
      prisma.transaction.findMany.mockResolvedValue([]);
    });

    it('runs one query, scoped to the user, selecting only the compact fields', async () => {
      await service.getHistory(CLERK_ID, 12);

      expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
      const args = prisma.transaction.findMany.mock.calls[0][0];
      expect(args.where.userId).toBe(MOCK_USER.id);
      expect(args.select).toEqual({ id: true, amount: true, merchant: true, date: true, type: true, categoryId: true });
      expect(args.take).toBe(TransactionsService.HISTORY_CAP);
      expect(args.orderBy).toEqual({ date: 'desc' });
    });

    it('starts the window at the 1st of the month, N months back', async () => {
      const res = await service.getHistory(CLERK_ID, 3);
      const now = new Date();
      expect(res.from).toEqual(new Date(now.getFullYear(), now.getMonth() - 3, 1));
      expect(res.months).toBe(3);
    });

    it('clamps the window to 1–24 months', async () => {
      expect((await service.getHistory(CLERK_ID, 100)).months).toBe(24);
      expect((await service.getHistory(CLERK_ID, -5)).months).toBe(1);
      expect((await service.getHistory(CLERK_ID, NaN)).months).toBe(12);
    });

    it('flags truncation only when the row cap is hit', async () => {
      expect((await service.getHistory(CLERK_ID, 12)).truncated).toBe(false);
      prisma.transaction.findMany.mockResolvedValue(new Array(TransactionsService.HISTORY_CAP).fill({}));
      expect((await service.getHistory(CLERK_ID, 12)).truncated).toBe(true);
    });
  });
});
