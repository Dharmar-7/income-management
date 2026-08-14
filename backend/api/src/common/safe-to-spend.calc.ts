/**
 * safe-to-spend.calc.ts
 * The pure maths behind "Safe to Spend" — kept side-effect free so it can be
 * unit-tested without a database.
 *
 * The model (the "Saved pot" flavour the user chose, not auto-boost):
 *  - There's a STABLE daily target = the cycle's discretionary money spread
 *    evenly across all its days (or a manual per-day cap the user set).
 *  - Spending less than the target on past days accumulates in a visible
 *    "saved pot" — it does NOT silently raise tomorrow's number.
 *  - Committed bills (EMIs, recurring) are carved out of the target and, for
 *    pacing, stripped out of "spent" so an EMI-day debit doesn't nuke the day.
 *
 * Accounting note: each bill is counted exactly once — bills whose date has
 * passed sit inside `netSpentSoFar` (so we subtract them back out via
 * `billsPaidSoFar`); bills still to come sit in `upcomingBills` (reserved).
 */
export interface SafeToSpendInputs {
  income: number;                    // CREDIT received across the cycle
  buffer: number;                    // safety buffer the user holds back
  manualDailyTarget: number | null;  // user's per-day cap; null/≤0 = auto
  allCycleBills: number;             // EMIs + recurring bills scheduled all cycle
  upcomingBills: number;             // subset still due today → cycle end (reserved)
  netSpentSoFar: number;             // (DEBIT − REFUND) from cycle start → now
  netSpentToday: number;             // (DEBIT − REFUND) today
  totalDays: number;                 // calendar days in the cycle
  dayIndex: number;                  // today's 1-based position in the cycle
}

export interface SafeToSpendResult {
  dailyTarget: number;   // stable per-day allowance
  safeToday: number;     // what's left of today's allowance (can go negative)
  spentToday: number;    // discretionary spend today
  savedPot: number;      // how far ahead of pace on completed days (can be negative = behind)
  leftThisCycle: number; // truly free money remaining until next salary
  daysLeft: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcSafeToSpend(i: SafeToSpendInputs): SafeToSpendResult {
  const totalDays = Math.max(1, i.totalDays);
  const dayIndex = Math.min(Math.max(1, i.dayIndex), totalDays);
  const daysLeft = totalDays - dayIndex + 1;

  // Bills whose scheduled date has already passed this cycle.
  const billsPaidSoFar = Math.max(0, i.allCycleBills - i.upcomingBills);

  // Strip already-paid bills out of spend so pacing reflects discretionary
  // spending only. Today's bills stay "upcoming" until day end, so today's
  // spend needs no bill subtraction.
  const discretionarySpentSoFar = Math.max(0, i.netSpentSoFar - billsPaidSoFar);
  const discretionarySpentToday = Math.max(0, i.netSpentToday);
  const discretionaryBeforeToday = Math.max(0, discretionarySpentSoFar - discretionarySpentToday);

  // Stable daily target: whole-cycle discretionary money spread evenly, unless
  // the user pinned a manual cap.
  const plannedDiscretionary = i.income - i.buffer - i.allCycleBills;
  const autoTarget = plannedDiscretionary > 0 ? plannedDiscretionary / totalDays : 0;
  const dailyTarget =
    i.manualDailyTarget != null && i.manualDailyTarget > 0 ? i.manualDailyTarget : autoTarget;

  const safeToday = dailyTarget - discretionarySpentToday;

  // Saved pot = target you were allowed on completed days − what you actually
  // spent on them. Positive = money banked for the future.
  const savedPot = dailyTarget * (dayIndex - 1) - discretionaryBeforeToday;

  // Free money left in the cycle (past bills already in spend, future bills reserved).
  const leftThisCycle = i.income - i.buffer - i.upcomingBills - i.netSpentSoFar;

  return {
    dailyTarget: round2(dailyTarget),
    safeToday: round2(safeToday),
    spentToday: round2(discretionarySpentToday),
    savedPot: round2(savedPot),
    leftThisCycle: round2(leftThisCycle),
    daysLeft,
  };
}
