import { describe, it, expect } from 'vitest';
import { niceBalanceLogFloor, timelinePointDetails } from '../src/ui/charts/timeline.js';
import { formatWithdrawnLine } from '../src/ui/charts/withdrawalTooltipFormat.js';

describe('niceBalanceLogFloor', () => {
  it('returns the hard minimum for missing or tiny starts', () => {
    expect(niceBalanceLogFloor(0)).toBe(1000);
    expect(niceBalanceLogFloor(-1)).toBe(1000);
    expect(niceBalanceLogFloor(5_000)).toBe(1000);
    expect(niceBalanceLogFloor(10_000)).toBe(1000);
  });

  it('snaps near start÷10 down to a 1–2–2.5–5 nice value', () => {
    expect(niceBalanceLogFloor(1_000_000)).toBe(100_000);
    expect(niceBalanceLogFloor(2_000_000)).toBe(200_000);
    expect(niceBalanceLogFloor(1_500_000)).toBe(100_000);
    expect(niceBalanceLogFloor(800_000)).toBe(50_000);
    expect(niceBalanceLogFloor(250_000)).toBe(25_000);
    expect(niceBalanceLogFloor(50_000)).toBe(5_000);
    expect(niceBalanceLogFloor(35_000)).toBe(2_500);
  });

  it('never exceeds start÷10', () => {
    for (const start of [25_000, 75_000, 110_000, 333_000, 1_234_567]) {
      expect(niceBalanceLogFloor(start)).toBeLessThanOrEqual(start / 10 + 1e-9);
    }
  });
});

describe('timelinePointDetails', () => {
  const path = {
    balances: [1_000_000, 950_000, 900_000],
    withdrawals: [40_000, 45_000],
    unadjustedWithdrawals: [50_000, 50_000],
    returns: [-0.01, 0.02],
  };

  it('returns balance-only details at year 0', () => {
    expect(timelinePointDetails(path, 0, 'balance')).toEqual({
      bal: 1_000_000,
      wd: null,
      unadj: null,
      ret: null,
    });
  });

  it('pairs balance years with that year\'s withdrawal vs plan', () => {
    expect(timelinePointDetails(path, 1, 'balance')).toEqual({
      bal: 950_000,
      wd: 40_000,
      unadj: 50_000,
      ret: -0.01,
    });
  });

  it('exposes withdrawal-chart details with end-of-year balance', () => {
    expect(timelinePointDetails(path, 0, 'withdrawal')).toEqual({
      wd: 40_000,
      unadj: 50_000,
      bal: 950_000,
      ret: -0.01,
    });
    expect(formatWithdrawnLine(40_000, 50_000)).toBe('Withdrawn: 40 (Delta: -10)');
  });
});
