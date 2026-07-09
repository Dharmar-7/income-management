import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CashService } from './cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashFlow } from '@prisma/client';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
function makeMockPrisma() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
    },
    cashTransaction: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    // spendCash mirrors "SPENT" entries as DEBIT transactions
    transaction: {
      create: jest.fn().mockResolvedValue({ id: 'mirror-tx' }),
    },
  };
  // Mirror PrismaService.resolveUserId so existing user.findUnique mocks still drive behaviour
  prisma.resolveUserId = jest.fn(async (clerkId: string) => {
    const u = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
    if (!u) throw new NotFoundException('User not found.');
    return u.id;
  });
  return prisma;
}

describe('CashService', () => {
  let service: CashService;
  let prisma: ReturnType<typeof makeMockPrisma>;

  const CLERK_ID = 'clerk_abc123';
  const MOCK_USER = { id: 'internal-user-id' };

  beforeEach(async () => {
    prisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CashService>(CashService);
  });

  // ─── User not found (shared guard) ───────────────────────────────────────

  describe('when user does not exist', () => {
    it('throws NotFoundException on getBalance', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getBalance(CLERK_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException on addCash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.addCash(CLERK_ID, { amount: 500, source: 'ATM', date: '2026-05-09' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('returns balance = totalIn - totalOut', async () => {
      prisma.cashTransaction.groupBy.mockResolvedValue([
        { flow: CashFlow.IN, _sum: { amount: 5000 } },
        { flow: CashFlow.OUT, _sum: { amount: 1500 } },
      ]);

      const result = await service.getBalance(CLERK_ID);

      expect(result.balance).toBe(3500);
      expect(result.totalIn).toBe(5000);
      expect(result.totalOut).toBe(1500);
    });

    it('returns zero balance for a new user with no transactions', async () => {
      prisma.cashTransaction.groupBy.mockResolvedValue([]);

      const result = await service.getBalance(CLERK_ID);

      expect(result.balance).toBe(0);
      expect(result.totalIn).toBe(0);
      expect(result.totalOut).toBe(0);
    });

    it('sums IN and OUT in a single grouped query', async () => {
      prisma.cashTransaction.groupBy.mockResolvedValue([
        { flow: CashFlow.IN, _sum: { amount: 1000 } },
        { flow: CashFlow.OUT, _sum: { amount: 200 } },
      ]);

      await service.getBalance(CLERK_ID);

      expect(prisma.cashTransaction.groupBy).toHaveBeenCalledTimes(1);
      const arg = prisma.cashTransaction.groupBy.mock.calls[0][0];
      expect(arg.by).toEqual(['flow']);
      expect(arg.where.userId).toBe(MOCK_USER.id);
    });
  });

  // ─── getHistory ───────────────────────────────────────────────────────────

  describe('getHistory', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('returns paginated cash transactions', async () => {
      const fakeEntries = [
        { id: 'c-1', amount: 2000, flow: CashFlow.IN },
        { id: 'c-2', amount: 500, flow: CashFlow.OUT },
      ];
      prisma.cashTransaction.findMany.mockResolvedValue(fakeEntries);
      prisma.cashTransaction.count.mockResolvedValue(2);

      const result = await service.getHistory(CLERK_ID, 1, 20);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('calculates totalPages correctly', async () => {
      prisma.cashTransaction.findMany.mockResolvedValue([]);
      prisma.cashTransaction.count.mockResolvedValue(45);

      const result = await service.getHistory(CLERK_ID, 1, 20);

      expect(result.meta.totalPages).toBe(3);
    });
  });

  // ─── addCash ──────────────────────────────────────────────────────────────

  describe('addCash', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('creates a CashTransaction with flow = IN', async () => {
      const created = { id: 'c-1', amount: 2000, flow: CashFlow.IN };
      prisma.cashTransaction.create.mockResolvedValue(created);

      const result = await service.addCash(CLERK_ID, {
        amount: 2000, source: 'ATM', date: '2026-05-09',
      });

      expect(result).toEqual(created);
      const createData = prisma.cashTransaction.create.mock.calls[0][0].data;
      expect(createData.flow).toBe(CashFlow.IN);
      expect(createData.amount).toBe(2000);
      expect(createData.userId).toBe(MOCK_USER.id);
    });

    it('trims whitespace from note', async () => {
      prisma.cashTransaction.create.mockResolvedValue({ id: 'c-1' });

      await service.addCash(CLERK_ID, {
        amount: 500, source: 'PERSON', date: '2026-05-09', note: '  Birthday gift  ',
      });

      const createData = prisma.cashTransaction.create.mock.calls[0][0].data;
      expect(createData.note).toBe('Birthday gift');
    });

    it('stores null note when note is empty', async () => {
      prisma.cashTransaction.create.mockResolvedValue({ id: 'c-1' });

      await service.addCash(CLERK_ID, {
        amount: 500, source: 'OTHER', date: '2026-05-09', note: '',
      });

      const createData = prisma.cashTransaction.create.mock.calls[0][0].data;
      expect(createData.note).toBeNull();
    });
  });

  // ─── spendCash ────────────────────────────────────────────────────────────

  describe('spendCash', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('creates a CashTransaction with flow = OUT when balance is sufficient', async () => {
      // Balance = 5000 - 0 = 5000
      prisma.cashTransaction.groupBy.mockResolvedValue([
        { flow: CashFlow.IN, _sum: { amount: 5000 } },
        { flow: CashFlow.OUT, _sum: { amount: 0 } },
      ]);

      const created = { id: 'c-2', amount: 500, flow: CashFlow.OUT };
      prisma.cashTransaction.create.mockResolvedValue(created);

      const result = await service.spendCash(CLERK_ID, {
        amount: 500, source: 'SPENT', date: '2026-05-09',
      });

      expect(result).toEqual(created);
      const createData = prisma.cashTransaction.create.mock.calls[0][0].data;
      expect(createData.flow).toBe(CashFlow.OUT);
    });

    it('throws BadRequestException when spending more than balance', async () => {
      // Balance = 200
      prisma.cashTransaction.groupBy.mockResolvedValue([
        { flow: CashFlow.IN, _sum: { amount: 200 } },
        { flow: CashFlow.OUT, _sum: { amount: 0 } },
      ]);

      await expect(
        service.spendCash(CLERK_ID, { amount: 500, source: 'SPENT', date: '2026-05-09' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cash balance is zero', async () => {
      prisma.cashTransaction.groupBy.mockResolvedValue([]);

      await expect(
        service.spendCash(CLERK_ID, { amount: 100, source: 'SPENT', date: '2026-05-09' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows spending exactly the full balance', async () => {
      // Balance = exactly 500
      prisma.cashTransaction.groupBy.mockResolvedValue([
        { flow: CashFlow.IN, _sum: { amount: 500 } },
        { flow: CashFlow.OUT, _sum: { amount: 0 } },
      ]);

      prisma.cashTransaction.create.mockResolvedValue({ id: 'c-3' });

      await expect(
        service.spendCash(CLERK_ID, { amount: 500, source: 'SPENT', date: '2026-05-09' }),
      ).resolves.not.toThrow();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('deletes the cash transaction and returns a message', async () => {
      prisma.cashTransaction.findUnique.mockResolvedValue({ id: 'c-1', userId: MOCK_USER.id });
      prisma.cashTransaction.delete.mockResolvedValue({});

      const result = await service.remove(CLERK_ID, 'c-1');
      expect(result).toEqual({ message: 'Deleted.' });
    });

    it('throws NotFoundException when cash transaction does not exist', async () => {
      prisma.cashTransaction.findUnique.mockResolvedValue(null);

      await expect(service.remove(CLERK_ID, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('calls delete with the correct id', async () => {
      prisma.cashTransaction.findUnique.mockResolvedValue({ id: 'c-1' });
      prisma.cashTransaction.delete.mockResolvedValue({});

      await service.remove(CLERK_ID, 'c-1');

      expect(prisma.cashTransaction.delete).toHaveBeenCalledWith({ where: { id: 'c-1' } });
    });
  });
});
