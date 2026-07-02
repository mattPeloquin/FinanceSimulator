import { describe, it, expect } from 'vitest';
import { buildWithdrawalFloorSeries } from '../src/core/withdrawal.js';
import { toDollars } from '../src/state/scenario.js';

describe('buildWithdrawalFloorSeries', () => {
  it('returns zeros when tiers are empty', () => {
    expect(buildWithdrawalFloorSeries([], 3, toDollars)).toEqual([0, 0, 0]);
  });

  it('applies a single tier across the full horizon', () => {
    expect(buildWithdrawalFloorSeries([{ amount: 100 }], 4, toDollars)).toEqual([
      100_000, 100_000, 100_000, 100_000,
    ]);
  });

  it('walks intermediate tiers then fills with the final tier', () => {
    const tiers = [{ amount: 120, years: 2 }, { amount: 80, years: 1 }, { amount: 60 }];
    expect(buildWithdrawalFloorSeries(tiers, 5, toDollars)).toEqual([
      120_000, 120_000, 80_000, 60_000, 60_000,
    ]);
  });

  it('stops assigning intermediate tiers at the horizon', () => {
    const tiers = [{ amount: 100, years: 10 }, { amount: 50 }];
    expect(buildWithdrawalFloorSeries(tiers, 3, toDollars)).toEqual([
      100_000, 100_000, 100_000,
    ]);
  });
});
