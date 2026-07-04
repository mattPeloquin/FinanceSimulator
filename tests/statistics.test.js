import { describe, it, expect } from 'vitest';
import {
  rankByWithdrawn,
  rankByReturn,
  percentileIndex,
  percentileValue,
  closestHistogramBin,
  successRate,
  goalSuccessRate,
  withdrawalTargetSuccessRate,
  mean,
  median,
  stdDev,
  summarizeReturns,
  buildHistogram,
} from '../src/core/statistics.js';

function makeSummary(arrs) {
  return {
    numSimulations: arrs.totalWithdrawn.length,
    avgReturn: Float64Array.from(arrs.avgReturn),
    finalBalance: Float64Array.from(arrs.finalBalance),
    totalWithdrawn: Float64Array.from(arrs.totalWithdrawn),
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
});

describe('withdrawalTargetSuccessRate', () => {
  it('counts runs within 5% of planned total or above it', () => {
    const totalWithdrawn = Float64Array.from([950, 960, 1000, 800]); // planned = 1000 -> min 950
    expect(withdrawalTargetSuccessRate(totalWithdrawn, 1000)).toBe(0.75);
  });

  it('returns null when the planned total is not positive', () => {
    const totalWithdrawn = Float64Array.from([100, 200]);
    expect(withdrawalTargetSuccessRate(totalWithdrawn, 0)).toBeNull();
    expect(withdrawalTargetSuccessRate(totalWithdrawn, -100)).toBeNull();
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
