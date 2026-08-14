import { calcSafeToSpend, SafeToSpendInputs } from './safe-to-spend.calc';

// A clean 30-day cycle, ₹30,000 income, nothing else set.
const base: SafeToSpendInputs = {
  income: 30_000,
  buffer: 0,
  manualDailyTarget: null,
  allCycleBills: 0,
  upcomingBills: 0,
  netSpentSoFar: 0,
  netSpentToday: 0,
  totalDays: 30,
  dayIndex: 1,
};

describe('calcSafeToSpend', () => {
  it('spreads income evenly into a daily target on day 1', () => {
    const r = calcSafeToSpend(base);
    expect(r.dailyTarget).toBe(1000);
    expect(r.safeToday).toBe(1000);
    expect(r.savedPot).toBe(0);
    expect(r.daysLeft).toBe(30);
    expect(r.leftThisCycle).toBe(30_000);
  });

  it("subtracts today's spend from today's number", () => {
    const r = calcSafeToSpend({ ...base, netSpentToday: 200, netSpentSoFar: 200 });
    expect(r.safeToday).toBe(800);
    expect(r.spentToday).toBe(200);
    expect(r.savedPot).toBe(0); // today isn't a completed day yet
  });

  it('banks under-spend from completed days into the saved pot', () => {
    // Day 3, spent ₹500 total on the two completed days, nothing today.
    const r = calcSafeToSpend({ ...base, dayIndex: 3, netSpentSoFar: 500, netSpentToday: 0 });
    // Allowed 2 × 1000 = 2000 over completed days, spent 500 → 1500 banked.
    expect(r.savedPot).toBe(1500);
    expect(r.safeToday).toBe(1000);
    expect(r.leftThisCycle).toBe(29_500);
  });

  it('reserves upcoming bills out of the daily target and free money', () => {
    const r = calcSafeToSpend({ ...base, allCycleBills: 6000, upcomingBills: 6000 });
    // (30000 − 6000) / 30 = 800
    expect(r.dailyTarget).toBe(800);
    expect(r.leftThisCycle).toBe(24_000);
  });

  it('does not double-count a bill that was already paid this cycle', () => {
    // ₹5000 EMI already paid (in netSpentSoFar) + ₹200 real discretionary spend.
    const r = calcSafeToSpend({
      ...base,
      dayIndex: 10,
      allCycleBills: 5000,
      upcomingBills: 0, // EMI date has passed
      netSpentSoFar: 5200,
      netSpentToday: 0,
    });
    // discretionary so far = 5200 − 5000 = 200
    // target (full precision) = (30000 − 5000) / 30 = 833.333…, rounded for display.
    // pot uses full precision internally: 833.333… × 9 − 200 = 7500 − 200 = 7300.
    expect(r.dailyTarget).toBe(833.33);
    expect(r.savedPot).toBe(7300);
  });

  it('honours a manual daily cap over the auto target', () => {
    const r = calcSafeToSpend({ ...base, manualDailyTarget: 500, netSpentToday: 100, netSpentSoFar: 100, dayIndex: 2 });
    expect(r.dailyTarget).toBe(500);
    expect(r.safeToday).toBe(400);
    // day 2: completed day 1 allowed 500, spent (100 − today's 100)=0 → pot 500
    expect(r.savedPot).toBe(500);
  });

  it('goes negative when you overspend the day', () => {
    const r = calcSafeToSpend({ ...base, netSpentToday: 1500, netSpentSoFar: 1500 });
    expect(r.safeToday).toBe(-500);
  });

  it('falls back to a zero target when there is no income and no manual cap', () => {
    const r = calcSafeToSpend({ ...base, income: 0 });
    expect(r.dailyTarget).toBe(0);
    expect(r.safeToday).toBe(0);
  });
});
