import { naturalTxType, outstanding, settlementStatus } from './settlement.util';

describe('naturalTxType', () => {
  it('maps SENT legs (you lent, then got it back)', () => {
    expect(naturalTxType('SENT', 'PRINCIPAL')).toBe('DEBIT');
    expect(naturalTxType('SENT', 'REPAYMENT')).toBe('CREDIT');
  });
  it('maps RECEIVED legs (you borrowed, then paid back)', () => {
    expect(naturalTxType('RECEIVED', 'PRINCIPAL')).toBe('CREDIT');
    expect(naturalTxType('RECEIVED', 'REPAYMENT')).toBe('DEBIT');
  });
});

describe('outstanding + settlementStatus', () => {
  it('is pending until repayments cover principal', () => {
    // Three sends totalling 1000, nothing back yet.
    expect(outstanding(1000, 0)).toBe(1000);
    expect(settlementStatus(1000, 0)).toBe('PENDING');
  });

  it('settles when a single return covers all the sends', () => {
    expect(outstanding(1000, 1000)).toBe(0);
    expect(settlementStatus(1000, 1000)).toBe('SETTLED');
  });

  it('handles partial returns (still pending, correct balance)', () => {
    expect(outstanding(1000, 600)).toBe(400);
    expect(settlementStatus(1000, 600)).toBe('PENDING');
  });

  it('settles across multiple returns that add up', () => {
    expect(settlementStatus(1000, 400 + 600)).toBe('SETTLED');
  });

  it('treats overpayment as settled', () => {
    expect(outstanding(1000, 1200)).toBe(-200);
    expect(settlementStatus(1000, 1200)).toBe('SETTLED');
  });

  it('is not settled with zero principal', () => {
    expect(settlementStatus(0, 0)).toBe('PENDING');
  });

  it('tolerates floating-point drift', () => {
    expect(settlementStatus(0.3, 0.1 + 0.2)).toBe('SETTLED');
  });
});
