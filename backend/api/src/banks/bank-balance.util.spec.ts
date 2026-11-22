import { happenedAfter, isDateOnly, istDayStart, moneyDirection, trackedBalance } from './bank-balance.util';

// Anchor: balance typed at 21 Nov 2026, 10:00 IST (04:30 UTC).
const anchor = new Date('2026-11-21T04:30:00.000Z');

describe('moneyDirection', () => {
  it('treats expenses and investments as money out, income and refunds as money in', () => {
    expect(moneyDirection('DEBIT')).toBe(-1);
    expect(moneyDirection('INVESTMENT')).toBe(-1);
    expect(moneyDirection('CREDIT')).toBe(1);
    expect(moneyDirection('REFUND')).toBe(1);
  });
  it('uses the settlement direction for transfers, and 0 when unknown', () => {
    expect(moneyDirection('TRANSFER', 'DEBIT')).toBe(-1);
    expect(moneyDirection('TRANSFER', 'CREDIT')).toBe(1);
    expect(moneyDirection('TRANSFER')).toBe(0);
  });
});

describe('happenedAfter', () => {
  const created = (iso: string) => new Date(iso);

  it('timed (SMS) rows: compares the exact moment', () => {
    expect(happenedAfter({ date: new Date('2026-11-21T05:00:00.000Z'), createdAt: created('2026-11-21T05:01:00Z') }, anchor)).toBe(true);
    // Paid at 9:00 IST but synced after the anchor: already in the typed balance.
    expect(happenedAfter({ date: new Date('2026-11-21T03:30:00.000Z'), createdAt: created('2026-11-21T05:00:00Z') }, anchor)).toBe(false);
  });

  it('date-only rows: later days count, earlier days never do', () => {
    expect(happenedAfter({ date: new Date('2026-11-22T00:00:00.000Z'), createdAt: created('2026-11-22T06:00:00Z') }, anchor)).toBe(true);
    expect(happenedAfter({ date: new Date('2026-11-20T00:00:00.000Z'), createdAt: created('2026-11-21T06:00:00Z') }, anchor)).toBe(false);
  });

  it('date-only rows on the anchor day: count only if entered after the anchor', () => {
    const sameDay = new Date('2026-11-21T00:00:00.000Z');
    expect(happenedAfter({ date: sameDay, createdAt: created('2026-11-21T06:00:00Z') }, anchor)).toBe(true);
    expect(happenedAfter({ date: sameDay, createdAt: created('2026-11-21T03:00:00Z') }, anchor)).toBe(false);
  });

  it('uses the India date for the anchor day (late-night IST anchor)', () => {
    // 21 Nov 23:30 IST = 21 Nov 18:00 UTC. A 22 Nov manual entry is the next day.
    const lateAnchor = new Date('2026-11-21T18:00:00.000Z');
    expect(happenedAfter({ date: new Date('2026-11-22T00:00:00.000Z'), createdAt: created('2026-11-21T18:30:00Z') }, lateAnchor)).toBe(true);
  });
});

describe('helpers', () => {
  it('detects date-only values', () => {
    expect(isDateOnly(new Date('2026-11-21T00:00:00.000Z'))).toBe(true);
    expect(isDateOnly(new Date('2026-11-21T04:30:00.000Z'))).toBe(false);
  });
  it('finds the start of the IST day', () => {
    expect(istDayStart(anchor).toISOString()).toBe('2026-11-20T18:30:00.000Z');
  });
});

describe('trackedBalance', () => {
  it('adds money in, subtracts money out, and skips unknown transfers', () => {
    const r = trackedBalance(10000, [
      { amount: 1500, direction: -1 },
      { amount: 20000, direction: 1 },
      { amount: 999, direction: 0 },
      { amount: 0.1, direction: -1 },
    ]);
    expect(r).toEqual({ current: 28499.9, change: 18499.9, counted: 3, unknown: 1 });
  });
});
