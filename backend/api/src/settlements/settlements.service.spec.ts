import { BadRequestException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';

// reopen(): undo the latest return on a settled tab.
function setup(opts: { status: string; lastReturn: { id: string; transactionId: string | null } | null }) {
  const settlement = {
    id: 's1', userId: 'u1', personName: 'Ravi', direction: 'SENT', status: opts.status,
    amount: 1000, transferredAt: new Date('2026-11-01'), settledAt: null,
    originalTxId: null, repaymentTxId: null, note: null,
  };
  const prisma: any = {
    resolveUserId: jest.fn().mockResolvedValue('u1'),
    settlement: {
      findFirst: jest.fn().mockResolvedValue({ ...settlement, entries: [] }),
      findUnique: jest.fn().mockResolvedValue({ settledAt: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    settlementEntry: {
      count: jest.fn().mockResolvedValue(2),
      findFirst: jest.fn().mockResolvedValue(opts.lastReturn),
      delete: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([{ kind: 'PRINCIPAL', _sum: { amount: 1000 } }]),
    },
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { svc: new SettlementsService(prisma), prisma };
}

describe('SettlementsService.reopen', () => {
  it('removes the latest return, restores its transaction, and recomputes to PENDING', async () => {
    const { svc, prisma } = setup({ status: 'SETTLED', lastReturn: { id: 'e2', transactionId: 't9' } });
    await svc.reopen('clerk', 's1');

    expect(prisma.settlementEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { settlementId: 's1', kind: 'REPAYMENT' },
    }));
    // SENT tab: a return was money coming in → back to CREDIT.
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 't9', userId: 'u1' }, data: { type: 'CREDIT' },
    });
    expect(prisma.settlementEntry.delete).toHaveBeenCalledWith({ where: { id: 'e2' } });
    expect(prisma.settlement.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', settledAt: null }),
    }));
  });

  it('refuses tabs that are not settled', async () => {
    const { svc, prisma } = setup({ status: 'PENDING', lastReturn: null });
    await expect(svc.reopen('clerk', 's1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.settlementEntry.delete).not.toHaveBeenCalled();
  });

  it('refuses when there is no return to undo', async () => {
    const { svc } = setup({ status: 'SETTLED', lastReturn: null });
    await expect(svc.reopen('clerk', 's1')).rejects.toThrow('no return to undo');
  });
});
