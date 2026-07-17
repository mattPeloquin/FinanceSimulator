import { describe, it, expect } from 'vitest';
import {
  buildWithdrawalFloorSeries,
  buildWithdrawalFloorPctSeries,
  buildSpecificWithdrawalFloorSeries,
  buildGiftingSeries,
  scaledGiftAmount,
  giftingUsesPercentMode,
  buildGiftOverlaySeries,
  buildSpendingOverTimeSeries,
  buildBaseWithdrawalSchedule,
  buildMajorEventsSeries,
  buildGlideRequiredBalances,
  glideSpendAmount,
  getDynamicAdjustment,
  resolveAdjustment,
  limitBoostForDrawdown,
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

describe('glideSpendAmount', () => {
  it('recycles the fraction of the surplus when the balance is far above the target', () => {
    // Surplus $500k, half recycled = $250k; the $2M remaining balance is well
    // above the $1M target so neither cap binds.
    expect(glideSpendAmount(500_000, 2_000_000, 0.5, 1_000_000)).toBe(250_000);
  });

  it('returns 0 when there is no surplus above the glide path', () => {
    expect(glideSpendAmount(0, 2_000_000, 0.5, 1_000_000)).toBe(0);
    expect(glideSpendAmount(-100_000, 2_000_000, 0.5, 1_000_000)).toBe(0);
  });

  it('never spends the remaining balance below the glide target', () => {
    // Fraction of surplus would be $50k, but only $30k of headroom remains
    // above the $850k target — glide stops at the target instead.
    expect(glideSpendAmount(50_000, 880_000, 1, 850_000)).toBe(30_000);
    // Already at the target: glide spends nothing even with surplus vs path.
    expect(glideSpendAmount(50_000, 850_000, 1, 850_000)).toBe(0);
  });

  it('is capped by the money actually left when the target is 0', () => {
    expect(glideSpendAmount(1_000_000, 20_000, 1, 0)).toBe(20_000);
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

  it('applies the change % only to extra when extra is non-zero', () => {
    const series = [
      { changeRate: -0.1, extra: 50_000 },
      { changeRate: -0.1, extra: 50_000 },
      { changeRate: -0.1, extra: 50_000 },
    ];
    const amounts = buildBaseWithdrawalSchedule(100_000, series, 3);
    // Core base stays flat; extra fades: 50k, 45k, 40.5k.
    expect(amounts[0]).toBeCloseTo(150_000, 3);
    expect(amounts[1]).toBeCloseTo(145_000, 3);
    expect(amounts[2]).toBeCloseTo(140_500, 3);
  });

  it('leaves the base untouched during go-go years, then compounds it when extra hits 0', () => {
    const series = [
      { changeRate: -0.1, extra: 50_000 },
      { changeRate: -0.1, extra: 50_000 },
      { changeRate: -0.01, extra: 0 },
      { changeRate: -0.01, extra: 0 },
    ];
    const amounts = buildBaseWithdrawalSchedule(100_000, series, 4);
    expect(amounts[0]).toBeCloseTo(150_000, 3);
    expect(amounts[1]).toBeCloseTo(145_000, 3);
    // Base was never reduced during go-go; first zero-extra year starts the fade.
    expect(amounts[2]).toBeCloseTo(99_000, 3);
    expect(amounts[3]).toBeCloseTo(98_010, 3);
  });

  it('resets the extra fade when the extra amount changes', () => {
    const series = [
      { changeRate: -0.1, extra: 50_000 },
      { changeRate: -0.1, extra: 50_000 },
      { changeRate: -0.1, extra: 20_000 },
      { changeRate: -0.1, extra: 20_000 },
    ];
    const amounts = buildBaseWithdrawalSchedule(100_000, series, 4);
    expect(amounts[0]).toBeCloseTo(150_000, 3);
    expect(amounts[1]).toBeCloseTo(145_000, 3);
    // New extra starts fresh, then takes one step of its tier's rate (j > 0).
    expect(amounts[2]).toBeCloseTo(118_000, 3);
    expect(amounts[3]).toBeCloseTo(116_200, 3);
  });

  it('clamps negative amounts to zero when base is non-negative', () => {
    const series = [{ changeRate: 0, extra: -50_000 }];
    expect(buildBaseWithdrawalSchedule(10_000, series, 1)[0]).toBe(0);
  });
});

describe('buildGiftingSeries', () => {
  const blankPct = { triggerPct: null, targetPct: null };

  it('returns zero entries when tiers are empty', () => {
    expect(buildGiftingSeries([], 3, toDollars)).toEqual([
      { amount: 0, balanceThreshold: 0, ...blankPct },
      { amount: 0, balanceThreshold: 0, ...blankPct },
      { amount: 0, balanceThreshold: 0, ...blankPct },
    ]);
  });

  it('applies a single tier across the full horizon', () => {
    expect(buildGiftingSeries([{ amount: 25, balance: 2000 }], 3, toDollars)).toEqual([
      { amount: 25_000, balanceThreshold: 2_000_000, ...blankPct },
      { amount: 25_000, balanceThreshold: 2_000_000, ...blankPct },
      { amount: 25_000, balanceThreshold: 2_000_000, ...blankPct },
    ]);
  });

  it('walks intermediate tiers then fills with the final tier', () => {
    const tiers = [
      { amount: 30, balance: 2500, years: 2 },
      { amount: 20, balance: 2000, years: 1 },
      { amount: 10, balance: 1500 },
    ];
    expect(buildGiftingSeries(tiers, 5, toDollars)).toEqual([
      { amount: 30_000, balanceThreshold: 2_500_000, ...blankPct },
      { amount: 30_000, balanceThreshold: 2_500_000, ...blankPct },
      { amount: 20_000, balanceThreshold: 2_000_000, ...blankPct },
      { amount: 10_000, balanceThreshold: 1_500_000, ...blankPct },
      { amount: 10_000, balanceThreshold: 1_500_000, ...blankPct },
    ]);
  });

  it('stops assigning intermediate tiers at the horizon', () => {
    const tiers = [{ amount: 25, balance: 2000, years: 10 }, { amount: 10, balance: 1000 }];
    expect(buildGiftingSeries(tiers, 3, toDollars)).toEqual([
      { amount: 25_000, balanceThreshold: 2_000_000, ...blankPct },
      { amount: 25_000, balanceThreshold: 2_000_000, ...blankPct },
      { amount: 25_000, balanceThreshold: 2_000_000, ...blankPct },
    ]);
  });

  it('copies trigger and target percent fields onto each year', () => {
    const tiers = [
      { amount: 10, balance: 0, years: 1, triggerPct: 10, targetPct: 40 },
      { amount: 20, balance: 500, triggerPct: null, targetPct: 25 },
    ];
    expect(buildGiftingSeries(tiers, 3, toDollars)).toEqual([
      { amount: 10_000, balanceThreshold: 0, triggerPct: 10, targetPct: 40 },
      { amount: 20_000, balanceThreshold: 500_000, triggerPct: null, targetPct: 25 },
      { amount: 20_000, balanceThreshold: 500_000, triggerPct: null, targetPct: 25 },
    ]);
  });
});

describe('scaledGiftAmount', () => {
  const legacyGift = { amount: 50_000, balanceThreshold: 2_000_000, triggerPct: null, targetPct: null };

  it('uses legacy Balance > when both percent fields are blank', () => {
    expect(giftingUsesPercentMode(legacyGift)).toBe(false);
    expect(scaledGiftAmount(legacyGift, 2_000_001, 1_000_000)).toBe(50_000);
    expect(scaledGiftAmount(legacyGift, 2_000_000, 1_000_000)).toBe(0);
  });

  it('pays nothing below the trigger and full gift at/above the target', () => {
    const gift = { amount: 40_000, balanceThreshold: 0, triggerPct: 20, targetPct: 60 };
    // remainingNeed 1_000_000 → trigger 1.2M, target 1.6M
    expect(scaledGiftAmount(gift, 1_199_999, 1_000_000)).toBe(0);
    expect(scaledGiftAmount(gift, 1_200_000, 1_000_000)).toBe(0); // at trigger, scale = 0
    expect(scaledGiftAmount(gift, 1_400_000, 1_000_000)).toBeCloseTo(20_000, 6);
    expect(scaledGiftAmount(gift, 1_600_000, 1_000_000)).toBe(40_000);
    expect(scaledGiftAmount(gift, 2_000_000, 1_000_000)).toBe(40_000);
  });

  it('scales the gift linearly halfway between trigger and target', () => {
    const gift = { amount: 40_000, balanceThreshold: 0, triggerPct: 0, targetPct: 100 };
    // remainingNeed 1_000_000 → trigger 1M, target 2M; mid = 1.5M → half gift
    expect(scaledGiftAmount(gift, 1_500_000, 1_000_000)).toBeCloseTo(20_000, 6);
  });

  it('treats blank trigger as 0% and blank target as a step at the trigger', () => {
    const triggerOnly = { amount: 10_000, balanceThreshold: 0, triggerPct: 50, targetPct: null };
    expect(scaledGiftAmount(triggerOnly, 1_499_999, 1_000_000)).toBe(0);
    expect(scaledGiftAmount(triggerOnly, 1_500_000, 1_000_000)).toBe(10_000);

    const targetOnly = { amount: 10_000, balanceThreshold: 0, triggerPct: null, targetPct: 100 };
    expect(scaledGiftAmount(targetOnly, 1_000_000, 1_000_000)).toBe(0);
    expect(scaledGiftAmount(targetOnly, 1_500_000, 1_000_000)).toBeCloseTo(5_000, 6);
  });

  it('pays the full gift when remaining plan need is zero and balance is positive', () => {
    const gift = { amount: 25_000, balanceThreshold: 0, triggerPct: 10, targetPct: 50 };
    expect(scaledGiftAmount(gift, 1, 0)).toBe(25_000);
    expect(scaledGiftAmount(gift, 0, 0)).toBe(0);
  });

  it('scales across a negative-to-positive percent band', () => {
    const gift = { amount: 40_000, balanceThreshold: 0, triggerPct: -20, targetPct: 20 };
    // remainingNeed 1_000_000 → trigger 800k, target 1.2M; mid = 1M → half gift
    expect(scaledGiftAmount(gift, 799_999, 1_000_000)).toBe(0);
    expect(scaledGiftAmount(gift, 1_000_000, 1_000_000)).toBeCloseTo(20_000, 6);
    expect(scaledGiftAmount(gift, 1_200_000, 1_000_000)).toBe(40_000);
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

describe('limitBoostForDrawdown', () => {
  it('leaves the boost unchanged when drawdown is blank (null)', () => {
    expect(limitBoostForDrawdown(50_000, 2_000_000, 2_400_000, null, 100_000)).toBe(50_000);
  });

  it('does not alter non-positive boosts', () => {
    expect(limitBoostForDrawdown(0, 2_000_000, 2_400_000, 0.01, 100_000)).toBe(0);
    expect(limitBoostForDrawdown(-10_000, 2_000_000, 2_400_000, 0.01, 100_000)).toBe(-10_000);
  });

  it('allows end at start when drawdown is 0% and spending leaves room', () => {
    // minEnd = start; maxWd = postGrowth - start = 400k; without boost 100k → room 300k
    expect(limitBoostForDrawdown(50_000, 2_000_000, 2_400_000, 0, 100_000)).toBe(50_000);
  });

  it('trims the boost so ending balance respects a 1% drawdown floor', () => {
    // minEnd = 2M * 0.99 = 1.98M; maxWd = 2.4M - 1.98M = 420k; without = 400k → room 20k
    expect(limitBoostForDrawdown(50_000, 2_000_000, 2_400_000, 0.01, 400_000)).toBe(20_000);
  });

  it('requires growth when drawdown is negative (−1%)', () => {
    // minEnd = 2M * 1.01 = 2.02M; maxWd = 2.4M - 2.02M = 380k; without = 370k → room 10k
    expect(limitBoostForDrawdown(50_000, 2_000_000, 2_400_000, -0.01, 370_000)).toBe(10_000);
  });

  it('zeros the boost when spending without boost already uses all headroom', () => {
    expect(limitBoostForDrawdown(50_000, 2_000_000, 2_400_000, 0, 500_000)).toBe(0);
  });
});
