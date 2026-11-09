import { Prisma, ImportSource, TransactionType } from '@prisma/client';
import { ImportService } from './import.service';
import { StatementTxnDto } from './dto/commit-statement.dto';

const CLERK_ID = 'clerk_1';
const USER_ID = 'user-1';
const DAY = '2026-11-05T00:00:00.000Z';

function row(over: Partial<StatementTxnDto> = {}): StatementTxnDto {
  return { amount: 20, merchant: 'TEA STALL', type: TransactionType.DEBIT, date: DAY, ...over };
}

function existing(over: Record<string, unknown> = {}) {
  return {
    id: 'tx-old', merchant: 'TEA STALL', amount: 20, date: new Date(DAY),
    type: TransactionType.DEBIT, source: ImportSource.SMS, upiRef: null, ...over,
  };
}

function makeMockPrisma() {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockImplementation(({ data }) => Promise.resolve({ count: data.length })),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

const p2002 = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });

describe('ImportService.commitStatement', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: ImportService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new ImportService(prisma as any, {} as any, {} as any, {} as any);
  });

  it('imports clean rows and reports no skipped rows', async () => {
    const res = await service.commitStatement(CLERK_ID, [row(), row({ merchant: 'SWIGGY', amount: 300 })]);
    expect(res).toMatchObject({ imported: 2, skipped: 0, total: 2, skippedRows: [] });
  });

  it('lists a row whose merchant, amount and date already exist, with the match', async () => {
    prisma.transaction.findMany.mockResolvedValue([existing()]);
    const res = await service.commitStatement(CLERK_ID, [row(), row({ merchant: 'SWIGGY' })]);

    expect(res.imported).toBe(1);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0]).toMatchObject({
      reason: 'same-entry',
      transaction: { merchant: 'TEA STALL' },
      existing: { id: 'tx-old', source: ImportSource.SMS },
    });
  });

  it('lists a row whose UPI ref already belongs to another transaction', async () => {
    prisma.transaction.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.upiRef ? [existing({ id: 'tx-sms', merchant: 'UPI Payment', upiRef: '412345678901' })] : []),
    );
    const res = await service.commitStatement(CLERK_ID, [row({ upiRef: '412345678901' })]);

    expect(res.imported).toBe(0);
    expect(res.skippedRows[0]).toMatchObject({ reason: 'same-ref', existing: { id: 'tx-sms', merchant: 'UPI Payment' } });
  });

  it('flags a row repeated within the same statement (first one imports)', async () => {
    const res = await service.commitStatement(CLERK_ID, [row(), row()]);

    expect(res.imported).toBe(1);
    expect(res.skippedRows).toEqual([expect.objectContaining({ reason: 'repeat-in-file', existing: null })]);
  });

  it('only sends clean rows to createMany', async () => {
    prisma.transaction.findMany.mockResolvedValue([existing()]);
    await service.commitStatement(CLERK_ID, [row(), row({ merchant: 'SWIGGY' })]);
    const data = prisma.transaction.createMany.mock.calls[0][0].data;
    expect(data.map((d: { merchant: string }) => d.merchant)).toEqual(['SWIGGY']);
  });

  it('tags rows with the chosen bank', async () => {
    await service.commitStatement(CLERK_ID, [row()], 'bank-iob');
    expect(prisma.transaction.createMany.mock.calls[0][0].data[0].bankId).toBe('bank-iob');
  });

  describe('force (add anyway)', () => {
    it('nudges the time forward until the merchant/amount/date is free', async () => {
      prisma.transaction.create
        .mockRejectedValueOnce(p2002())
        .mockRejectedValueOnce(p2002())
        .mockResolvedValue({});
      const res = await service.commitStatement(CLERK_ID, [row()], undefined, true);

      expect(res).toMatchObject({ imported: 1, failed: 0, skippedRows: [] });
      const lastDate: Date = prisma.transaction.create.mock.calls[2][0].data.date;
      expect(lastDate.getTime() - new Date(DAY).getTime()).toBe(2000);
    });

    it('moves a clashing UPI ref into the description', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: 'tx-sms' });
      await service.commitStatement(CLERK_ID, [row({ upiRef: '412345678901', description: 'Tea' })], undefined, true);

      const data = prisma.transaction.create.mock.calls[0][0].data;
      expect(data.upiRef).toBeUndefined();
      expect(data.description).toBe('Tea · Ref: 412345678901');
    });

    it('keeps a UPI ref that is not taken', async () => {
      await service.commitStatement(CLERK_ID, [row({ upiRef: '412345678901' })], undefined, true);
      expect(prisma.transaction.create.mock.calls[0][0].data.upiRef).toBe('412345678901');
    });

    it('counts a row as failed on a non-duplicate error', async () => {
      prisma.transaction.create.mockRejectedValue(new Error('db down'));
      const res = await service.commitStatement(CLERK_ID, [row()], undefined, true);
      expect(res).toMatchObject({ imported: 0, failed: 1 });
    });
  });
});
