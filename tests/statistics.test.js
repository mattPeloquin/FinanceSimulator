import { describe, it, expect } from 'vitest';
import {
  rankByWithdrawn,
  rankByReturn,
  percentileIndex,
  percentileValue,
  closestHistogramBin,
  successRate,
  goalSuccessRate,
  legacyGoalSuccessRate,
  withdrawalPlanRatioPercentile,
  spendingTailRate,
  meetsWithdrawalTarget,
  withdrawalTargetSuccessRate,
  onTargetBlendAlpha,
  onTargetScore,
  meetsOnTargetBlend,
  weightedYearHitRateFromSeries,
  onTargetYearlyRawCurve,
  onTargetYearWeights,
  mean,
  median,
  stdDev,
  summarizeReturns,
  buildHistogram,
  irrFromPath,
  meanYearlyWithdrawals,
  spendOnlyLifetimeTotals,
  spendOnlyMedianYearly,
  withdrawalMetricLabels,
  yearWeights,
  earlyWeightRawCurve,
  weightPreviewSeries,
  earlyWeightSlotFromStrengthPct,
  earlyWeightStrengthFromSlot,
  weightedWithdrawalScore,
  weightedScheduleScore,
  isEarlyWeightingActive,
} from '../src/core/statistics.js';

function makeSummary(arrs) {
  return {
    numSimulations: arrs.totalWithdrawn.length,
    avgReturn: Float64Array.from(arrs.avgReturn),
    finalBalance: Float64Array.from(arrs.finalBalance),
    totalWithdrawn: Float64Array.from(arrs.totalWithdrawn),
    medianYearlyWithdrawal: Float64Array.from(
      arrs.medianYearlyWithdrawal ?? arrs.totalWithdrawn,
    ),
    horizonYears: Int32Array.from(
      arrs.horizonYears ?? arrs.totalWithdrawn.map(() => 1),
    ),
    depletionYear: Float64Array.from(arrs.depletionYear ?? []),
    allYearsWithdrawals: arrs.allYearsWithdrawals
      ? Float64Array.from(arrs.allYearsWithdrawals)
      : undefined,
  };
}

describe('rankByWithdrawn', () => {
  it('sorts by total withdrawn asc, tie-broken by final balance asc', () => {
    const summary = makeSummary({
      avgReturn: [0, 0, 0],
      finalBalance: [50, 10, 30],
      totalWithdrawn: [100, 100, 90],
    });
    expect(Array.from(rankByWithdrawn(summary))).toEqual([2, 1, 0]);
  });

  it('sorts by median yearly withdrawal when that metric is selected', () => {
    const summary = makeSummary({
      avgReturn: [0, 0, 0],
      finalBalance: [10, 20, 30],
      totalWithdrawn: [300, 200, 100],
      medianYearlyWithdrawal: [30, 20, 25],
    });
    expect(Array.from(rankByWithdrawn(summary, 'medianYearly'))).toEqual([1, 2, 0]);
  });

  it('tie-breaks median-yearly ranks by total withdrawn then final balance', () => {
    const summary = makeSummary({
      avgReturn: [0, 0, 0],
      finalBalance: [50, 10, 30],
      totalWithdrawn: [100, 90, 100],
      medianYearlyWithdrawal: [20, 20, 20],
    });
    expect(Array.from(rankByWithdrawn(summary, 'medianYearly'))).toEqual([1, 2, 0]);
  });

  it('sorts by mean yearly withdrawal (total / horizon) when that metric is selected', () => {
    // Means: 300/30=10, 200/10=20, 150/10=15 — differs from both total order
    // (2, 1, 0) and median order.
    const summary = makeSummary({
      avgReturn: [0, 0, 0],
      finalBalance: [10, 20, 30],
      totalWithdrawn: [300, 200, 150],
      medianYearlyWithdrawal: [30, 5, 5],
      horizonYears: [30, 10, 10],
    });
    expect(Array.from(rankByWithdrawn(summary, 'meanYearly'))).toEqual([0, 2, 1]);
  });

  it('mean-yearly ranking matches total ranking at a fixed horizon', () => {
    const summary = makeSummary({
      avgReturn: [0, 0, 0],
      finalBalance: [50, 10, 30],
      totalWithdrawn: [100, 100, 90],
      medianYearlyWithdrawal: [1, 2, 3],
      horizonYears: [20, 20, 20],
    });
    expect(Array.from(rankByWithdrawn(summary, 'meanYearly'))).toEqual(
      Array.from(rankByWithdrawn(summary, 'total')),
    );
  });
});

describe('meanYearlyWithdrawals', () => {
  it('divides each total by its per-run horizon', () => {
    const out = meanYearlyWithdrawals(
      Float64Array.from([300, 200, 0]),
      Int32Array.from([30, 10, 25]),
    );
    expect(Array.from(out)).toEqual([10, 20, 0]);
  });

  it('accepts a fixed scalar horizon and guards zero', () => {
    expect(Array.from(meanYearlyWithdrawals(Float64Array.from([100, 50]), 25))).toEqual([4, 2]);
    expect(Array.from(meanYearlyWithdrawals(Float64Array.from([100]), 0))).toEqual([0]);
  });
});

describe('spendOnlyLifetimeTotals / spendOnlyMedianYearly', () => {
  it('floors deposit years at $0 so inflows do not reduce lifetime spend', () => {
    // 2 runs × 3 years. Run 0: 40k, −100k deposit, 40k → spend 80k.
    // Run 1: 40k, 40k, 40k → spend 120k.
    const allYears = Float64Array.from([
      40_000, -100_000, 40_000,
      40_000, 40_000, 40_000,
    ]);
    const horizons = Int32Array.from([3, 3]);
    const totals = spendOnlyLifetimeTotals(allYears, horizons, 3);
    expect(Array.from(totals)).toEqual([80_000, 120_000]);
    const medians = spendOnlyMedianYearly(allYears, horizons, 3);
    expect(Array.from(medians)).toEqual([40_000, 40_000]);
  });
});

describe('withdrawalMetricLabels', () => {
  it('labels each metric with total as the secondary for yearly metrics', () => {
    expect(withdrawalMetricLabels('total')).toEqual({ primary: 'Total', secondary: 'Median / Year' });
    expect(withdrawalMetricLabels('medianYearly')).toEqual({ primary: 'Median / Year', secondary: 'Total' });
    expect(withdrawalMetricLabels('meanYearly')).toEqual({ primary: 'Mean / Year', secondary: 'Total' });
  });

  it('uses early-weighted primary labels when strength is above 0', () => {
    expect(withdrawalMetricLabels('total', { strengthPct: 50 })).toEqual({
      primary: 'Early-weighted Spending',
      secondary: 'Total',
    });
    expect(withdrawalMetricLabels('meanYearly', { strengthPct: 50 })).toEqual({
      primary: 'Early-weighted Mean / Year',
      secondary: 'Total',
    });
  });
});

describe('early weight slot helpers', () => {
  it('maps slots to blend strengths and snaps legacy percents', () => {
    expect(earlyWeightStrengthFromSlot(0)).toBe(0);
    expect(earlyWeightStrengthFromSlot(2)).toBe(50);
    expect(earlyWeightStrengthFromSlot(4)).toBe(100);
    expect(earlyWeightSlotFromStrengthPct(50)).toBe(2);
    expect(earlyWeightSlotFromStrengthPct(60)).toBe(2);
    expect(earlyWeightSlotFromStrengthPct(90)).toBe(4);
  });
});

describe('yearWeights', () => {
  it('returns all ones at strength 0', () => {
    expect(Array.from(yearWeights(5, { strengthPct: 0 }))).toEqual([1, 1, 1, 1, 1]);
  });

  it('rescales so mean weight is 1 at full strength', () => {
    const w = yearWeights(10, {
      strengthPct: 100,
      earlyEmphasisPct: 30,
      lateFloorPct: 40,
    });
    const meanW = Array.from(w).reduce((a, b) => a + b, 0) / w.length;
    expect(meanW).toBeCloseTo(1, 10);
    expect(w[0]).toBeGreaterThan(w[w.length - 1]);
  });

  it('raw curve lands on late floor and emphasis steepens the front', () => {
    const gentle = earlyWeightRawCurve(30, { earlyEmphasisPct: 0, lateFloorPct: 40 });
    const steep = earlyWeightRawCurve(30, { earlyEmphasisPct: 100, lateFloorPct: 40 });
    expect(gentle[0]).toBeCloseTo(1, 10);
    expect(gentle[29]).toBeCloseTo(0.05 + 0.95 * 0.4, 10);
    expect(steep[29]).toBeCloseTo(gentle[29], 10);
    // Mid-horizon: steeper emphasis is lower than gentle (more weight early).
    expect(steep[10]).toBeLessThan(gentle[10]);
    expect(steep[0] / steep[10]).toBeGreaterThan(gentle[0] / gentle[10]);
  });

  it('weightPreviewSeries reports late-share on the raw curve', () => {
    const preview = weightPreviewSeries(20, { earlyEmphasisPct: 30, lateFloorPct: 40 });
    expect(preview.weights.length).toBe(20);
    // lateFloorPct 40 → 5% + 95%×0.40 = 43% of year 1 on the raw curve.
    expect(preview.rawLateSharePct).toBe(43);
    expect(preview.year1Weight).toBeGreaterThan(preview.yearLastWeight);
  });
});

describe('weightedWithdrawalScore', () => {
  it('clamps deposit years to zero so early inflows do not inflate rank', () => {
    const maxYears = 4;
    // One run: deposit in year 1, then normal withdrawals.
    const matrix = Float64Array.from([-50_000, 40_000, 40_000, 40_000]);
    const weighting = { strengthPct: 100, earlyEmphasisPct: 50, lateFloorPct: 40 };
    const score = weightedWithdrawalScore(matrix, maxYears, 0, 4, weighting);
    const noDeposit = weightedWithdrawalScore(
      Float64Array.from([0, 40_000, 40_000, 40_000]),
      maxYears,
      0,
      4,
      weighting,
    );
    expect(score).toBeCloseTo(noDeposit, 8);
  });

  it('matches unweighted total at strength 0 via schedule helper', () => {
    const schedule = [10, 20, 30];
    expect(weightedScheduleScore(schedule, { strengthPct: 0 })).toBe(60);
    expect(isEarlyWeightingActive({ strengthPct: 0 })).toBe(false);
  });
});

describe('rankByWithdrawn with early weighting', () => {
  it('matches unweighted ranking at strength 0; early weight can reorder equal-lifetime paths', () => {
    const maxYears = 3;
    // Run 0: late-heavy but higher lifetime total; run 1: early-heavy; run 2: low.
    const allYearsWithdrawals = Float64Array.from([
      10, 10, 100, // total 120
      70, 20, 10, // total 100
      20, 20, 20, // total 60
    ]);
    const summary = makeSummary({
      avgReturn: [0, 0, 0],
      finalBalance: [1, 2, 3],
      totalWithdrawn: [120, 100, 60],
      horizonYears: [3, 3, 3],
      allYearsWithdrawals,
    });
    const weighting = { strengthPct: 100, earlyEmphasisPct: 80, lateFloorPct: 20 };
    expect(Array.from(rankByWithdrawn(summary, 'total'))).toEqual([2, 1, 0]);
    expect(Array.from(rankByWithdrawn(summary, 'total', { strengthPct: 0 }))).toEqual([2, 1, 0]);
    const s0 = weightedWithdrawalScore(allYearsWithdrawals, maxYears, 0, 3, weighting);
    const s1 = weightedWithdrawalScore(allYearsWithdrawals, maxYears, 1, 3, weighting);
    expect(s1).toBeGreaterThan(s0);
    // Early-heavy run 1 outranks late-heavy run 0 despite lower lifetime total.
    expect(Array.from(rankByWithdrawn(summary, 'total', weighting))).toEqual([2, 0, 1]);
  });

  it('renormalizes weights for shorter horizons', () => {
    // Layout is 2 runs × 4 years (maxYears inferred from the packed array).
    const allYearsWithdrawals = Float64Array.from([
      50, 50, NaN, NaN, // horizon 2
      10, 10, 10, 10, // horizon 4
    ]);
    const summary = makeSummary({
      avgReturn: [0, 0],
      finalBalance: [0, 0],
      totalWithdrawn: [100, 40],
      horizonYears: [2, 4],
      allYearsWithdrawals,
    });
    const ranks = Array.from(
      rankByWithdrawn(summary, 'total', {
        strengthPct: 100,
        earlyEmphasisPct: 50,
        lateFloorPct: 40,
      }),
    );
    // Shorter high-early path should outrank the longer low path under early weight.
    expect(ranks[0]).toBe(1);
    expect(ranks[1]).toBe(0);
  });
});

describe('rankByReturn', () => {
  it('sorts indices by average return ascending', () => {
    const summary = makeSummary({
      avgReturn: [0.05, -0.02, 0.1],
      finalBalance: [0, 0, 0],
      totalWithdrawn: [0, 0, 0],
    });
    expect(Array.from(rankByReturn(summary))).toEqual([1, 0, 2]);
  });
});

describe('irrFromPath', () => {
  // NPV of the cash-flow convention irrFromPath solves, for cross-checking roots.
  function npvAt(r, start, withdrawals, finalBalance) {
    let v = -start;
    for (let t = 0; t < withdrawals.length; t++) v += withdrawals[t] / (1 + r) ** (t + 1);
    return v + finalBalance / (1 + r) ** withdrawals.length;
  }

  it('matches the hand-computed root for a simple two-year annuity', () => {
    // -1000 + 500/(1+r) + 600/(1+r)^2 = 0  =>  r = (-500 + sqrt(2,650,000)) rearranged
    expect(irrFromPath(1000, [500, 600], 0, 0.05)).toBeCloseTo(0.0639411, 5);
  });

  it('equals the geometric mean return when there are no intermediate flows', () => {
    expect(irrFromPath(1000, [0, 0, 0], 1331, 0)).toBeCloseTo(0.1, 9);
    expect(irrFromPath(1000, [0, 0], 810, 0.2)).toBeCloseTo(-0.1, 9);
  });

  it('converges with a deposit (negative withdrawal) year in the flows', () => {
    const r = irrFromPath(1000, [-200, 300, 300], 800, 0.05);
    expect(Number.isFinite(r)).toBe(true);
    expect(npvAt(r, 1000, [-200, 300, 300], 800)).toBeCloseTo(0, 4);
  });

  it('finds the root even from a far-off guess', () => {
    expect(irrFromPath(1000, [500, 600], 0, 5)).toBeCloseTo(0.0639411, 5);
  });

  it('returns NaN when there are no positive inflows', () => {
    expect(irrFromPath(1000, [0, -50], 0, 0)).toBeNaN();
  });

  it('returns 0 for a zero-year horizon', () => {
    expect(irrFromPath(1000, [], 500, 0)).toBe(0);
  });
});

describe('percentileIndex', () => {
  it('matches floor(n * p)', () => {
    expect(percentileIndex(1000, 0.1)).toBe(100);
    expect(percentileIndex(50000, 0.5)).toBe(25000);
  });
});

describe('successRate', () => {
  it('counts simulations not depleted within the horizon', () => {
    const depletion = Float64Array.from([41, 10, 41, 5]); // numYears = 40 -> 41 means survived
    expect(successRate(depletion, 40)).toBe(0.5);
  });

  it('supports per-run horizon arrays', () => {
    const depletion = Float64Array.from([26, 20, 31, 10]);
    const horizons = Int32Array.from([25, 25, 30, 25]);
    expect(successRate(depletion, horizons)).toBe(0.5);
  });
});

describe('legacyGoalSuccessRate', () => {
  it('counts runs that survived and met the ending balance target', () => {
    const finalBalance = Float64Array.from([500, 2000, 1500, 50]);
    const depletionYear = Float64Array.from([41, 41, 20, 41]); // numYears = 40
    // idx0: survived but below target; idx1: survived and above target;
    // idx2: depleted; idx3: survived but below target.
    expect(legacyGoalSuccessRate(finalBalance, depletionYear, 40, 1000)).toBe(0.25);
  });

  it('ignores on-plan spending (unlike the joint goalSuccessRate)', () => {
    const finalBalance = Float64Array.from([2000, 2000, 2000]);
    const depletionYear = Float64Array.from([41, 41, 41]);
    const totalWithdrawn = Float64Array.from([500, 500, 500]); // well below plan
    expect(legacyGoalSuccessRate(finalBalance, depletionYear, 40, 1000)).toBe(1);
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 1000, totalWithdrawn, 1000, 0.05)).toBe(0);
  });
});

describe('withdrawalPlanRatioPercentile', () => {
  it('returns actual/plan at the requested percentile', () => {
    // Ratios: 0.7, 0.85, 0.9, 1.0, 1.2 — P20 (index floor(5*0.2)=1) = 0.85
    const actual = Float64Array.from([700, 850, 900, 1000, 1200]);
    expect(withdrawalPlanRatioPercentile(actual, 1000, 0.2)).toBeCloseTo(0.85, 6);
  });

  it('returns null when every plan benchmark is non-positive', () => {
    expect(withdrawalPlanRatioPercentile(
      Float64Array.from([100, 200]),
      Float64Array.from([0, 0]),
      0.05,
    )).toBeNull();
  });
});

describe('spendingTailRate', () => {
  it('matches withdrawalTargetSuccessRate for the RT floor', () => {
    const actual = Float64Array.from([800, 850, 1000]);
    expect(spendingTailRate(actual, 1000, 0.2)).toBe(1);
    expect(spendingTailRate(actual, 1000, 0.05)).toBe(1 / 3);
  });
});

describe('goalSuccessRate', () => {
  it('counts only runs that both survived and met the ending balance target', () => {
    const finalBalance = Float64Array.from([500, 2000, 1500, 50]);
    const depletionYear = Float64Array.from([41, 41, 20, 41]); // numYears = 40
    // idx0: survived but below target; idx1: survived and above target;
    // idx2: depleted (ignored regardless of balance); idx3: survived but below target.
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 1000)).toBe(0.25);
  });

  it('is at most each of the separate legacy and on-plan rates', () => {
    const finalBalance = Float64Array.from([2000, 2000, 50, 2000]);
    const depletionYear = Float64Array.from([41, 41, 10, 41]); // one depleted
    const totalWithdrawn = Float64Array.from([900, 700, 100, 1000]); // planned 1000, RT 0.2 → min 800
    const joint = goalSuccessRate(finalBalance, depletionYear, 40, 1000, totalWithdrawn, 1000, 0.2);
    const legacy = legacyGoalSuccessRate(finalBalance, depletionYear, 40, 1000);
    const onPlan = spendingTailRate(totalWithdrawn, 1000, 0.2);
    expect(joint).toBeLessThanOrEqual(legacy);
    expect(joint).toBeLessThanOrEqual(onPlan);
  });

  it('returns 0 for an empty set', () => {
    expect(goalSuccessRate(Float64Array.from([]), Float64Array.from([]), 40, 1000)).toBe(0);
  });

  it('treats a target of 0 as "just don\'t deplete"', () => {
    const finalBalance = Float64Array.from([0, 100]);
    const depletionYear = Float64Array.from([41, 41]);
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 0)).toBe(1);
  });

  it('requires on-plan spending when planned total and tolerance are provided', () => {
    const finalBalance = Float64Array.from([2000, 2000, 2000]);
    const depletionYear = Float64Array.from([41, 41, 41]);
    const totalWithdrawn = Float64Array.from([900, 850, 1000]); // planned = 1000, tolerance 0.2 -> min 800
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 1000, totalWithdrawn, 1000, 0.2)).toBe(1);
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 1000, totalWithdrawn, 1000, 0.05)).toBe(1 / 3);
  });

  it('skips the on-plan check when planned total is not positive', () => {
    const finalBalance = Float64Array.from([2000]);
    const depletionYear = Float64Array.from([41]);
    const totalWithdrawn = Float64Array.from([0]);
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 0, totalWithdrawn, 0, 0.2)).toBe(1);
  });
});

describe('meetsWithdrawalTarget', () => {
  it('accepts withdrawals within tolerance of plan or above it', () => {
    expect(meetsWithdrawalTarget(800, 1000, 0.2)).toBe(true);
    expect(meetsWithdrawalTarget(799, 1000, 0.2)).toBe(false);
    expect(meetsWithdrawalTarget(1100, 1000, 0.2)).toBe(true);
  });

  it('treats non-positive planned totals as always on plan', () => {
    expect(meetsWithdrawalTarget(0, 0, 0.2)).toBe(true);
  });
});

describe('withdrawalTargetSuccessRate', () => {
  it('counts runs within a custom tolerance of planned benchmark or above it', () => {
    const actualWithdrawn = Float64Array.from([800, 850, 1000]); // planned = 1000, tolerance 0.2 -> min 800
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 1000, 0.2)).toBe(1);
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 1000, 0.05)).toBe(1 / 3);
  });

  it('works with median-yearly actuals and planned benchmark', () => {
    const actualWithdrawn = Float64Array.from([45, 50, 55]); // planned median = 50, tolerance 0.2 -> min 40
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 50, 0.2)).toBe(1);
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 50, 0.05)).toBe(2 / 3);
  });

  it('counts runs within 5% of planned total or above it', () => {
    const actualWithdrawn = Float64Array.from([950, 960, 1000, 800]); // planned = 1000 -> min 950
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 1000)).toBe(0.75);
  });

  it('returns null when the planned benchmark is not positive', () => {
    const actualWithdrawn = Float64Array.from([100, 200]);
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 0)).toBeNull();
    expect(withdrawalTargetSuccessRate(actualWithdrawn, -100)).toBeNull();
  });
});

describe('onTargetYearlyRawCurve (symmetrical end-weights)', () => {
  it('is flat when early and late emphasis are equal', () => {
    const raw = onTargetYearlyRawCurve(10, { earlyEmphasisPct: 100, lateFloorPct: 100 });
    for (let i = 0; i < raw.length; i++) expect(raw[i]).toBeCloseTo(1, 9);
  });

  it('front-loads when early > late and back-loads when late > early', () => {
    const front = onTargetYearlyRawCurve(5, { earlyEmphasisPct: 100, lateFloorPct: 20 });
    expect(front[0]).toBeGreaterThan(front[4]);
    const back = onTargetYearlyRawCurve(5, { earlyEmphasisPct: 20, lateFloorPct: 100 });
    expect(back[4]).toBeGreaterThan(back[0]);
    // Symmetry: reversing ends mirrors the curve.
    for (let i = 0; i < 5; i++) {
      expect(front[i]).toBeCloseTo(back[4 - i], 9);
    }
  });

  it('bends more toward the high end as Early and Late diverge', () => {
    // Midpoint of a linear 100→20 fade would be 60; a bent curve sits closer to 20.
    const mild = onTargetYearlyRawCurve(5, { earlyEmphasisPct: 60, lateFloorPct: 40 });
    const strong = onTargetYearlyRawCurve(5, { earlyEmphasisPct: 100, lateFloorPct: 0 });
    const mildMid = mild[2];
    const strongMid = strong[2];
    const mildLinearMid = (0.6 + 0.4) / 2;
    const strongLinearMid = (1.0 + 0.0) / 2;
    // Mild gap ≈ linear; strong gap pulls the midpoint below the linear average.
    expect(Math.abs(mildMid - mildLinearMid)).toBeLessThan(0.05);
    expect(strongMid).toBeLessThan(strongLinearMid - 0.15);
  });

  it('mean-rescales so average weight is 1', () => {
    const w = onTargetYearWeights(8, { earlyEmphasisPct: 100, lateFloorPct: 25 });
    const mean = Array.from(w).reduce((a, b) => a + b, 0) / w.length;
    expect(mean).toBeCloseTo(1, 9);
  });
});

describe('on-plan blend scoring', () => {
  it('maps blend alpha from Plan RT endpoints', () => {
    expect(onTargetBlendAlpha('lifetime', 0.1)).toBe(0);
    expect(onTargetBlendAlpha('yearly', 0.1)).toBe(1);
    expect(onTargetBlendAlpha('blend', 0)).toBe(1);
    expect(onTargetBlendAlpha('blend', 0.35)).toBe(0);
    expect(onTargetBlendAlpha('blend', 0.175)).toBeCloseTo(0.5, 6);
  });

  it('lifetime mode matches meetsWithdrawalTarget', () => {
    expect(meetsOnTargetBlend(800, 1000, 0.2, { measure: 'lifetime', yearHitRate: 0 })).toBe(true);
    expect(meetsOnTargetBlend(799, 1000, 0.2, { measure: 'lifetime', yearHitRate: 1 })).toBe(false);
  });

  it('blend at RT 0% equals yearly; at RT 35% equals lifetime', () => {
    // lifetimeRatio 0.9, yearHitRate 0 → fail lifetime at RT 0, pass yearly? year=0 fails yearly
    expect(meetsOnTargetBlend(900, 1000, 0, { measure: 'blend', yearHitRate: 0 })).toBe(false);
    expect(meetsOnTargetBlend(900, 1000, 0, { measure: 'yearly', yearHitRate: 0 })).toBe(false);
    expect(meetsOnTargetBlend(900, 1000, 0, { measure: 'yearly', yearHitRate: 1 })).toBe(true);
    // At max RT, α=0 so only lifetime matters (0.9 >= 0.65)
    expect(meetsOnTargetBlend(900, 1000, 0.35, { measure: 'blend', yearHitRate: 0 })).toBe(true);
    expect(meetsOnTargetBlend(600, 1000, 0.35, { measure: 'blend', yearHitRate: 1 })).toBe(false);
  });

  it('surplus lifetime can offset some missed years when alpha is mid', () => {
    // r=0.175 → α=0.5, need score >= 0.825
    // lifetimeRatio=1.2, yearHitRate=0.5 → score = 0.5*0.5 + 0.5*1.2 = 0.85
    expect(onTargetScore(1.2, 0.5, 0.5)).toBeCloseTo(0.85, 6);
    expect(meetsOnTargetBlend(1200, 1000, 0.175, { measure: 'blend', yearHitRate: 0.5 })).toBe(true);
    // lifetimeRatio=1.0, yearHitRate=0.5 → score = 0.75 < 0.825
    expect(meetsOnTargetBlend(1000, 1000, 0.175, { measure: 'blend', yearHitRate: 0.5 })).toBe(false);
  });

  it('weights year hits with front-loaded or back-loaded curves', () => {
    const plan = [100, 100, 100, 100];
    // Miss only year 1.
    const actual = [50, 100, 100, 100];
    const flat = weightedYearHitRateFromSeries(actual, plan, 0.05, {
      earlyEmphasisPct: 100,
      lateFloorPct: 100,
    });
    const early = weightedYearHitRateFromSeries(actual, plan, 0.05, {
      earlyEmphasisPct: 100,
      lateFloorPct: 10,
    });
    const late = weightedYearHitRateFromSeries(actual, plan, 0.05, {
      earlyEmphasisPct: 10,
      lateFloorPct: 100,
    });
    expect(flat).toBeCloseTo(0.75, 6);
    // Front-loaded: missing year 1 hurts more than flat.
    expect(early).toBeLessThan(flat);
    // Back-loaded: missing year 1 hurts less than flat.
    expect(late).toBeGreaterThan(flat);
  });

  it('blend success rate uses yearly matrix when measure is yearly', () => {
    // 2 sims, 2 years. Plan 100/yr. Sim0 hits both; sim1 misses year 2.
    const maxYears = 2;
    const allYearsNetSpend = Float64Array.from([100, 100, 100, 50]);
    const actualWithdrawn = Float64Array.from([200, 150]);
    const context = {
      measure: 'yearly',
      yearlyEmphasisPct: 100,
      yearlyLateFloorPct: 100,
      allYearsNetSpend,
      maxYears,
      horizonYears: 2,
      targetByYearForHorizon: () => [100, 100],
    };
    // RT 0 → need yearHitRate >= 1; only sim0 passes
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 200, 0, context)).toBe(0.5);
    // lifetime measure would pass both (150/200 = 0.75 fails at RT0... 150 < 200)
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 200, 0, { ...context, measure: 'lifetime' })).toBe(0.5);
    // At RT 25%, lifetime min=150; both pass on lifetime
    expect(withdrawalTargetSuccessRate(actualWithdrawn, 200, 0.25, { measure: 'lifetime' })).toBe(1);
  });
});

describe('mean / median', () => {
  it('computes mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('computes median for odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('stdDev', () => {
  it('computes population standard deviation', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });

  it('returns 0 when all values are identical', () => {
    expect(stdDev([0.05, 0.05, 0.05])).toBeCloseTo(0);
  });
});

describe('percentileValue', () => {
  it('returns the value at floor(n * p) in sorted order', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    expect(percentileValue(values, 0.05)).toBeCloseTo(0.1);
    expect(percentileValue(values, 0.95)).toBeCloseTo(1.0);
  });
});

describe('closestHistogramBin', () => {
  it('picks the bin whose center is nearest the reference value', () => {
    const labels = [0, 0.25, 0.5, 0.75];
    const binSize = 0.25;
    expect(closestHistogramBin(0.12, labels, binSize)).toBe(0);
    expect(closestHistogramBin(0.38, labels, binSize)).toBe(1);
    expect(closestHistogramBin(0.62, labels, binSize)).toBe(2);
  });

  it('returns 0 when binSize is zero', () => {
    expect(closestHistogramBin(0.05, [0.05], 0)).toBe(0);
  });
});

describe('summarizeReturns', () => {
  it('returns mean, median, min, max, and stdDev', () => {
    const values = Float64Array.from([0.02, 0.04, 0.06, 0.08, 0.1]);
    const summary = summarizeReturns(values);
    expect(summary.mean).toBeCloseTo(0.06);
    expect(summary.median).toBeCloseTo(0.06);
    expect(summary.min).toBeCloseTo(0.02);
    expect(summary.max).toBeCloseTo(0.1);
    expect(summary.stdDev).toBeCloseTo(stdDev(values));
    expect(summary.p5).toBeCloseTo(percentileValue(values, 0.05));
    expect(summary.p95).toBeCloseTo(percentileValue(values, 0.95));
  });

  it('returns zeros for an empty array', () => {
    expect(summarizeReturns([])).toEqual({
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      p5: 0,
      p95: 0,
    });
  });
});

describe('buildHistogram', () => {
  it('bins values into the requested number of bins', () => {
    const h = buildHistogram([0, 0.25, 0.5, 0.75, 1.0], 4);
    expect(h.bins.reduce((a, b) => a + b, 0)).toBe(5);
    expect(h.bins.length).toBe(4);
    expect(h.min).toBe(0);
    expect(h.max).toBe(1);
    // The max value is placed in the last bin.
    expect(h.bins[3]).toBeGreaterThanOrEqual(1);
  });

  it('returns a single bin when all values are identical', () => {
    const h = buildHistogram([0.05, 0.05, 0.05], 75);
    expect(h.labels).toEqual([0.05]);
    expect(h.bins).toEqual([3]);
    expect(Number.isNaN(h.labels[0])).toBe(false);
  });
});
