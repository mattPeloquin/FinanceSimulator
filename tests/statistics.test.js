import { describe, it, expect } from 'vitest';
import {
  rankByWithdrawn,
  rankByReturn,
  percentileIndex,
  percentileValue,
  closestHistogramBin,
  successRate,
  goalSuccessRate,
  meetsWithdrawalTarget,
  withdrawalTargetSuccessRate,
  mean,
  median,
  stdDev,
  summarizeReturns,
  buildHistogram,
  irrFromPath,
  meanYearlyWithdrawals,
  withdrawalMetricLabels,
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

describe('withdrawalMetricLabels', () => {
  it('labels each metric with total as the secondary for yearly metrics', () => {
    expect(withdrawalMetricLabels('total')).toEqual({ primary: 'Total Withdrawn', secondary: 'Median / Year' });
    expect(withdrawalMetricLabels('medianYearly')).toEqual({ primary: 'Median / Year', secondary: 'Total Withdrawn' });
    expect(withdrawalMetricLabels('meanYearly')).toEqual({ primary: 'Mean / Year', secondary: 'Total Withdrawn' });
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

describe('goalSuccessRate', () => {
  it('counts only runs that both survived and met the ending balance target', () => {
    const finalBalance = Float64Array.from([500, 2000, 1500, 50]);
    const depletionYear = Float64Array.from([41, 41, 20, 41]); // numYears = 40
    // idx0: survived but below target; idx1: survived and above target;
    // idx2: depleted (ignored regardless of balance); idx3: survived but below target.
    expect(goalSuccessRate(finalBalance, depletionYear, 40, 1000)).toBe(0.25);
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
