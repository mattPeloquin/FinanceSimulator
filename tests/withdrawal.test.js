import { describe, it, expect } from 'vitest';
import {
  buildWithdrawalFloorSeries,
  getDynamicAdjustment,
  resolveAdjustment,
} from '../src/core/withdrawal.js';
import { toDollars } from '../src/state/scenario.js';

const defaultDynConfig = {
  low: { ret: -15, bal: 1_000_000, adj: -50_000 },
  med: { ret: 5, bal: 3_000_000, adj: 0 },
  high: { ret: 20, bal: 5_000_000, adj: 50_000 },
};

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

describe('getDynamicAdjustment', () => {
  it('clamps at low and high return anchors', () => {
    expect(getDynamicAdjustment(-20, defaultDynConfig)).toBe(-50_000);
    expect(getDynamicAdjustment(25, defaultDynConfig)).toBe(50_000);
  });

  it('interpolates between low and expected anchors', () => {
    // -15% -> -50k, 5% -> 0; -5% is halfway -> -25k
    expect(getDynamicAdjustment(-5, defaultDynConfig)).toBeCloseTo(-25_000, 3);
  });

  it('interpolates between expected and high anchors', () => {
    // 5% -> 0, 20% -> +50k; 12.5% is halfway -> +25k
    expect(getDynamicAdjustment(12.5, defaultDynConfig)).toBeCloseTo(25_000, 3);
  });
});

describe('resolveAdjustment', () => {
  it('uses low adjustment when balance is below the low override', () => {
    expect(resolveAdjustment(900_000, 20, defaultDynConfig)).toBe(-50_000);
  });

  it('floors bad market years when balance is above Expected', () => {
    expect(resolveAdjustment(3_500_000, -15, defaultDynConfig)).toBe(0);
  });

  it('does not cap good market years when balance is above Expected', () => {
    expect(resolveAdjustment(3_500_000, 20, defaultDynConfig)).toBe(50_000);
  });

  it('floors bad market years when balance is above High', () => {
    expect(resolveAdjustment(6_000_000, -15, defaultDynConfig)).toBe(50_000);
  });

  it('uses market interpolation when balance is in the middle band', () => {
    expect(resolveAdjustment(2_000_000, -5, defaultDynConfig)).toBeCloseTo(-25_000, 3);
  });

  it('ignores disabled balance overrides (null threshold)', () => {
    const noOverrides = {
      ...defaultDynConfig,
      low: { ...defaultDynConfig.low, bal: null },
      med: { ...defaultDynConfig.med, bal: null },
      high: { ...defaultDynConfig.high, bal: null },
    };
    expect(resolveAdjustment(900_000, -15, noOverrides)).toBe(-50_000);
    expect(resolveAdjustment(6_000_000, -15, noOverrides)).toBe(-50_000);
  });
});
