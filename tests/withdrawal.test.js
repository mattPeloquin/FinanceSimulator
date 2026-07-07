import { describe, it, expect } from 'vitest';
import {
  buildWithdrawalFloorSeries,
  buildWithdrawalFloorPctSeries,
  buildSpecificWithdrawalFloorSeries,
  buildGiftingSeries,
  buildGiftOverlaySeries,
  getDynamicAdjustment,
  resolveAdjustment,
} from '../src/core/withdrawal.js';
import { toDollars } from '../src/state/scenario.js';
import {
  buildMarketAdjPreviewSeries,
  buildMarketAdjAnchorPoints,
} from '../src/ui/charts/withdrawalAdjPreview.js';

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

describe('buildWithdrawalFloorPctSeries', () => {
  it('returns zeros when tiers are empty', () => {
    expect(buildWithdrawalFloorPctSeries([], 3)).toEqual([0, 0, 0]);
  });

  it('applies a single tier across the full horizon', () => {
    expect(buildWithdrawalFloorPctSeries([{ pct: 80 }], 4)).toEqual([80, 80, 80, 80]);
  });

  it('walks intermediate tiers then fills with the final tier', () => {
    const tiers = [{ pct: 90, years: 2 }, { pct: 75, years: 1 }, { pct: 60 }];
    expect(buildWithdrawalFloorPctSeries(tiers, 5)).toEqual([90, 90, 75, 60, 60]);
  });
});

describe('buildSpecificWithdrawalFloorSeries', () => {
  it('returns zeros when tiers are empty', () => {
    expect(buildSpecificWithdrawalFloorSeries([], [100_000, 90_000], 2)).toEqual([0, 0]);
  });

  it('converts each year list amount by the tier percentage', () => {
    const tiers = [{ pct: 80, years: 1 }, { pct: 60 }];
    const amounts = [100_000, 90_000, 90_000];
    expect(buildSpecificWithdrawalFloorSeries(tiers, amounts, 3)).toEqual([
      80_000, 54_000, 54_000,
    ]);
  });

  it('assigns zero floor to deposit years', () => {
    const tiers = [{ pct: 80 }];
    expect(buildSpecificWithdrawalFloorSeries(tiers, [-50_000, 100_000], 2)).toEqual([
      0, 80_000,
    ]);
  });
});

describe('buildGiftingSeries', () => {
  it('returns zero entries when tiers are empty', () => {
    expect(buildGiftingSeries([], 3, toDollars)).toEqual([
      { amount: 0, balanceThreshold: 0 },
      { amount: 0, balanceThreshold: 0 },
      { amount: 0, balanceThreshold: 0 },
    ]);
  });

  it('applies a single tier across the full horizon', () => {
    expect(buildGiftingSeries([{ amount: 25, balance: 2000 }], 3, toDollars)).toEqual([
      { amount: 25_000, balanceThreshold: 2_000_000 },
      { amount: 25_000, balanceThreshold: 2_000_000 },
      { amount: 25_000, balanceThreshold: 2_000_000 },
    ]);
  });

  it('walks intermediate tiers then fills with the final tier', () => {
    const tiers = [
      { amount: 30, balance: 2500, years: 2 },
      { amount: 20, balance: 2000, years: 1 },
      { amount: 10, balance: 1500 },
    ];
    expect(buildGiftingSeries(tiers, 5, toDollars)).toEqual([
      { amount: 30_000, balanceThreshold: 2_500_000 },
      { amount: 30_000, balanceThreshold: 2_500_000 },
      { amount: 20_000, balanceThreshold: 2_000_000 },
      { amount: 10_000, balanceThreshold: 1_500_000 },
      { amount: 10_000, balanceThreshold: 1_500_000 },
    ]);
  });

  it('stops assigning intermediate tiers at the horizon', () => {
    const tiers = [{ amount: 25, balance: 2000, years: 10 }, { amount: 10, balance: 1000 }];
    expect(buildGiftingSeries(tiers, 3, toDollars)).toEqual([
      { amount: 25_000, balanceThreshold: 2_000_000 },
      { amount: 25_000, balanceThreshold: 2_000_000 },
      { amount: 25_000, balanceThreshold: 2_000_000 },
    ]);
  });
});

describe('buildGiftOverlaySeries', () => {
  it('returns null for years with zero gift amount', () => {
    expect(buildGiftOverlaySeries([100_000, 90_000], [0, 25_000])).toEqual([null, 115_000]);
  });

  it('adds gift amount to the baseline withdrawal', () => {
    expect(buildGiftOverlaySeries([100_000], [50_000])).toEqual([150_000]);
  });

  it('uses zero baseline for deposit years', () => {
    expect(buildGiftOverlaySeries([-50_000, 80_000], [30_000, 20_000])).toEqual([30_000, 100_000]);
  });
});

describe('buildMarketAdjPreviewSeries', () => {
  const dynConfig = {
    low: { ret: -10, adj: -100_000 },
    med: { ret: 5, adj: -22_000 },
    high: { ret: 30, adj: 0 },
  };

  function yAtReturn(series, ret) {
    const match = series.find((p) => Math.abs(p.x - ret) < 1e-9);
    return match?.y;
  }

  it('hits exact anchor adjustments at each market trigger', () => {
    const series = buildMarketAdjPreviewSeries(dynConfig);
    expect(yAtReturn(series, -10)).toBe(-100_000);
    expect(yAtReturn(series, 5)).toBe(-22_000);
    expect(yAtReturn(series, 30)).toBe(0);
  });

  it('matches getDynamicAdjustment at anchor returns', () => {
    const series = buildMarketAdjPreviewSeries(dynConfig);
    for (const ret of [-10, 5, 30]) {
      expect(yAtReturn(series, ret)).toBe(getDynamicAdjustment(ret, dynConfig));
    }
  });

  it('exposes anchor dots at typed adjustment values', () => {
    expect(buildMarketAdjAnchorPoints(dynConfig)).toEqual([
      { x: -10, y: -100_000 },
      { x: 5, y: -22_000 },
      { x: 30, y: 0 },
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
