import { Prisma, ImportSource, TransactionType } from '@prisma/client';
import { SmsSyncService } from './sms-sync.service';
import { SmsParserService, RawSms } from './sms-parser.service';

const CLERK_ID = 'clerk_1';
const USER_ID = 'user-1';
const DAY = new Date('2026-05-09T10:00:00.000Z').getTime();

function sms(body: string, offsetMin = 0, address = 'VM-IOBCHN-S'): RawSms {
  return { body, date: DAY + offsetMin * 60_000, address };
}

function makeMockPrisma() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: USER_ID }),
      update: jest.fn().mockResolvedValue({}),
    },
    bank: { findMany: jest.fn().mockResolvedValue([]) },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('SmsSyncService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: SmsSyncService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    const categorizer = { getCategoryId: jest.fn().mockReturnValue(null) };
    service = new SmsSyncService(prisma as any, new SmsParserService(), categorizer as any);
  });

  it('imports two same-amount SMS on the same day as two transactions', async () => {
    const res = await service.sync(CLERK_ID, [
      sms('Rs.20 debited from A/c XX1234 to tea@ybl. UPI Ref 412345678901', 0),
      sms('Rs.20 debited from A/c XX1234 to tea@ybl. UPI Ref 412345678902', 240),
    ]);
    expect(res).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
  });

  it('only matches same-day amounts against manual/statement entries, not other SMS', async () => {
    await service.sync(CLERK_ID, [sms('Rs.20 debited from A/c XX1234 via UPI', 0)]);
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.source).toEqual({ not: ImportSource.SMS });
    expect(where).toMatchObject({ userId: USER_ID, amount: 20, type: TransactionType.DEBIT });
  });

  it('lets one manual entry absorb only one SMS', async () => {
    prisma.transaction.findMany.mockResolvedValue([{ id: 'manual-1' }]);
    const res = await service.sync(CLERK_ID, [
      sms('Rs.20 debited from A/c XX1234 via UPI', 0),
      sms('Rs.20 debited from A/c XX1234 via UPI', 240),
    ]);
    expect(res).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('skips the same SMS read again', async () => {
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-old' });
    const res = await service.sync(CLERK_ID, [sms('Rs.20 debited from A/c XX1234 via UPI')]);
    expect(res).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('skips a transaction whose UPI ref already exists', async () => {
    prisma.transaction.findUnique.mockResolvedValue({ id: 'tx-old' });
    const res = await service.sync(CLERK_ID, [sms('Rs.20 debited from A/c XX1234. UPI Ref 412345678901')]);
    expect(res).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('counts a unique-constraint race as skipped, not failed', async () => {
    prisma.transaction.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const res = await service.sync(CLERK_ID, [sms('Rs.20 debited from A/c XX1234 via UPI')]);
    expect(res).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
  });

  it('links the transaction to the matching bank by name', async () => {
    prisma.bank.findMany.mockResolvedValue([{ id: 'bank-tmb', name: 'TMB' }, { id: 'bank-iob', name: 'IOB Savings' }]);
    await service.sync(CLERK_ID, [
      sms('Rs.20 debited from A/c XX1234 via UPI', 0, 'VM-IOBCHN-S'),
      sms('Rs.30 debited from A/c XX5678 via UPI', 5, 'JD-TMBANK'),
    ]);
    expect(prisma.transaction.create.mock.calls[0][0].data.bankId).toBe('bank-iob');
    expect(prisma.transaction.create.mock.calls[1][0].data.bankId).toBe('bank-tmb');
  });

  it('leaves bankId unset when no bank matches', async () => {
    prisma.bank.findMany.mockResolvedValue([{ id: 'bank-tmb', name: 'TMB' }]);
    await service.sync(CLERK_ID, [sms('Rs.20 debited from A/c XX1234 via UPI', 0, 'AX-OTHERB')]);
    expect(prisma.transaction.create.mock.calls[0][0].data.bankId).toBeUndefined();
  });

  it('returns ATM debits so the app can offer to add cash', async () => {
    const res = await service.sync(CLERK_ID, [sms('Rs.2,000 withdrawn from A/c XX1234 at ATM')]);
    expect(res.atmTransactions).toEqual([expect.objectContaining({ amount: 2000 })]);
  });

  it('records the sync time', async () => {
    await service.sync(CLERK_ID, []);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkId: CLERK_ID },
      data: { smsSyncedAt: expect.any(Date) },
    });
  });
});
