import { describe, it, expect } from 'vitest';
import {
  buildWithdrawalFloorSeries,
  buildWithdrawalFloorPctSeries,
  buildSpecificWithdrawalFloorSeries,
  buildGiftingSeries,
  buildGiftOverlaySeries,
  buildSpendingOverTimeSeries,
  buildBaseWithdrawalSchedule,
  buildMajorEventsSeries,
  buildGlideRequiredBalances,
  getDynamicAdjustment,
  resolveAdjustment,
} from '../src/core/withdrawal.js';
import { toDollars } from '../src/state/scenario.js';
import {
  buildMarketAdjPreviewSeries,
  buildMarketAdjAnchorPoints,
} from '../src/ui/charts/withdrawalAdjPreview.js';

const defaultDynConfig = {
  low: { ret: -15, adj: -50_000 },
  med: { ret: 5, adj: 0 },
  high: { ret: 20, adj: 50_000 },
  noCutBal: 3_000_000,
};

describe('buildGlideRequiredBalances', () => {
  it('returns an empty array for an empty plan', () => {
    expect(buildGlideRequiredBalances([], 100_000, 0.05)).toEqual([]);
  });

  it('at a 0% glide rate the required balance is the remaining plan plus the target', () => {
    const required = buildGlideRequiredBalances([100, 100, 100], 50, 0);
    expect(required).toEqual([350, 250, 150]);
  });

  it('discounts future requirements at the glide rate', () => {
    const required = buildGlideRequiredBalances([100, 100], 110, 0.1);
    // Final year needs plan + target; the year before needs its plan plus
    // the discounted final-year requirement: 100 + 210 / 1.1.
    expect(required[1]).toBeCloseTo(210, 9);
    expect(required[0]).toBeCloseTo(100 + 210 / 1.1, 9);
  });

  it('planned deposits (negative plan entries) reduce the required balance', () => {
    const required = buildGlideRequiredBalances([-100, 100], 0, 0);
    expect(required).toEqual([0, 100]);
  });

  it('satisfies the engine recurrence: withdrawing the plan and growing at the rate walks the path to the target', () => {
    const plan = [120, 80, 100, 90];
    const rate = 0.07;
    const target = 250;
    const required = buildGlideRequiredBalances(plan, target, rate);
    let balance = required[0];
    for (let j = 0; j < plan.length; j++) {
      expect(balance).toBeCloseTo(required[j], 9);
      balance = (balance - plan[j]) * (j < plan.length - 1 ? 1 + rate : 1);
    }
    expect(balance).toBeCloseTo(target, 9);
  });
});

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

describe('buildSpendingOverTimeSeries', () => {
  const dollars = (k) => k;

  it('returns zero entries when tiers are empty', () => {
    expect(buildSpendingOverTimeSeries([], 3, dollars)).toEqual([
      { changeRate: 0, extra: 0 },
      { changeRate: 0, extra: 0 },
      { changeRate: 0, extra: 0 },
    ]);
  });

  it('applies a single tier across the full horizon', () => {
    expect(buildSpendingOverTimeSeries([{ changePct: -2, extra: 50_000 }], 3, dollars)).toEqual([
      { changeRate: -0.02, extra: 50_000 },
      { changeRate: -0.02, extra: 50_000 },
      { changeRate: -0.02, extra: 50_000 },
    ]);
  });

  it('walks intermediate tiers then fills with the final tier', () => {
    const tiers = [
      { changePct: -2, extra: 50_000, years: 2 },
      { changePct: -1, extra: 10_000, years: 1 },
      { changePct: 0, extra: 0 },
    ];
    expect(buildSpendingOverTimeSeries(tiers, 5, dollars)).toEqual([
      { changeRate: -0.02, extra: 50_000 },
      { changeRate: -0.02, extra: 50_000 },
      { changeRate: -0.01, extra: 10_000 },
      { changeRate: 0, extra: 0 },
      { changeRate: 0, extra: 0 },
    ]);
  });
});

describe('buildBaseWithdrawalSchedule', () => {
  it('matches single-tier compounding (1 + r) ** j', () => {
    const series = [
      { changeRate: -0.1, extra: 0 },
      { changeRate: -0.1, extra: 0 },
      { changeRate: -0.1, extra: 0 },
    ];
    const amounts = buildBaseWithdrawalSchedule(100_000, series, 3);
    expect(amounts[0]).toBeCloseTo(100_000, 3);
    expect(amounts[1]).toBeCloseTo(90_000, 3);
    expect(amounts[2]).toBeCloseTo(81_000, 3);
  });

  it('adds staged extra withdrawals per tier', () => {
    const series = [
      { changeRate: 0, extra: 50_000 },
      { changeRate: 0, extra: 50_000 },
      { changeRate: 0, extra: 0 },
      { changeRate: 0, extra: 0 },
    ];
    const amounts = buildBaseWithdrawalSchedule(100_000, series, 4);
    expect(amounts[0]).toBeCloseTo(150_000, 3);
    expect(amounts[1]).toBeCloseTo(150_000, 3);
    expect(amounts[2]).toBeCloseTo(100_000, 3);
  });

  it('compounds continuously across tiers with different rates', () => {
    const series = [
      { changeRate: 0.02, extra: 0 },
      { changeRate: 0.02, extra: 0 },
      { changeRate: -0.01, extra: 0 },
      { changeRate: -0.01, extra: 0 },
    ];
    const amounts = buildBaseWithdrawalSchedule(100_000, series, 4);
    expect(amounts[0]).toBeCloseTo(100_000, 3);
    expect(amounts[1]).toBeCloseTo(102_000, 3);
    expect(amounts[2]).toBeCloseTo(100_980, 3);
    expect(amounts[3]).toBeCloseTo(99_970.2, 1);
  });

  it('clamps negative amounts to zero when base is non-negative', () => {
    const series = [{ changeRate: 0, extra: -50_000 }];
    expect(buildBaseWithdrawalSchedule(10_000, series, 1)[0]).toBe(0);
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

describe('buildMajorEventsSeries', () => {
  it('returns zeros for an empty event list', () => {
    expect(buildMajorEventsSeries([], 4, toDollars)).toEqual([0, 0, 0, 0]);
  });

  it('places a one-time inflow on the start year', () => {
    expect(buildMajorEventsSeries([{ amount: 250, startYear: 3, years: null }], 5, toDollars)).toEqual([
      0, 0, 250_000, 0, 0,
    ]);
  });

  it('repeats an event for consecutive years', () => {
    expect(buildMajorEventsSeries([{ amount: 50, startYear: 2, years: 3 }], 6, toDollars)).toEqual([
      0, 50_000, 50_000, 50_000, 0, 0,
    ]);
  });

  it('sums overlapping events in the same year', () => {
    const events = [
      { amount: 100, startYear: 1, years: null },
      { amount: 25, startYear: 1, years: 2 },
    ];
    expect(buildMajorEventsSeries(events, 3, toDollars)).toEqual([
      125_000, 25_000, 0,
    ]);
  });

  it('clips events that extend past the horizon', () => {
    expect(buildMajorEventsSeries([{ amount: 10, startYear: 4, years: 5 }], 5, toDollars)).toEqual([
      0, 0, 0, 10_000, 10_000,
    ]);
  });

  it('supports negative outflow amounts', () => {
    expect(buildMajorEventsSeries([{ amount: -80, startYear: 1, years: null }], 2, toDollars)).toEqual([
      -80_000, 0,
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
  it('suppresses bad-market cuts when balance is above the no-cut threshold', () => {
    expect(resolveAdjustment(3_500_000, -15, defaultDynConfig)).toBe(0);
  });

  it('does not cap good market years when balance is above the no-cut threshold', () => {
    expect(resolveAdjustment(3_500_000, 20, defaultDynConfig)).toBe(50_000);
  });

  it('applies market cuts when balance is at or below the no-cut threshold', () => {
    expect(resolveAdjustment(2_000_000, -15, defaultDynConfig)).toBe(-50_000);
    expect(resolveAdjustment(3_000_000, -15, defaultDynConfig)).toBe(-50_000);
  });

  it('uses market interpolation when the no-cut rule is not triggered', () => {
    expect(resolveAdjustment(2_000_000, -5, defaultDynConfig)).toBeCloseTo(-25_000, 3);
  });

  it('ignores a disabled no-cut threshold (null)', () => {
    const noThreshold = { ...defaultDynConfig, noCutBal: null };
    expect(resolveAdjustment(900_000, -15, noThreshold)).toBe(-50_000);
    expect(resolveAdjustment(6_000_000, -15, noThreshold)).toBe(-50_000);
  });
});
