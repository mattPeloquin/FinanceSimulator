import { describe, it, expect } from 'vitest';
import {
  rankByWithdrawn,
  rankByReturn,
  percentileIndex,
  successRate,
  mean,
  median,
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

describe('mean / median', () => {
  it('computes mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('computes median for odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
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
});
