import { describe, it, expect } from 'vitest';
import {
  getMiniChartSeries,
  toRealReturnPct,
  averageRealReturn,
  sparklineRange,
  sparklineZeroTopPct,
} from '../src/core/history.js';
import { formatPct1 } from '../src/core/precision.js';

describe('toRealReturnPct', () => {
  it('removes inflation from a nominal return', () => {
    // 10% nominal with 2% inflation → ~7.84% real
    expect(toRealReturnPct(10, 2)).toBeCloseTo(((1.1 / 1.02) - 1) * 100, 10);
  });

  it('handles deflation (negative inflation)', () => {
    expect(toRealReturnPct(5, -2)).toBeCloseTo(((1.05 / 0.98) - 1) * 100, 10);
  });
});

describe('averageRealReturn', () => {
  it('returns null for empty or mismatched series', () => {
    expect(averageRealReturn([], [])).toBeNull();
    expect(averageRealReturn(null, [1])).toBeNull();
    expect(averageRealReturn([1, 2], [1])).toBeNull();
  });

  it('averages year-by-year real returns', () => {
    const nominal = [10, -5];
    const inflation = [2, 1];
    const expected =
      (toRealReturnPct(10, 2) + toRealReturnPct(-5, 1)) / 2;
    expect(averageRealReturn(nominal, inflation)).toBeCloseTo(expected, 10);
  });

  it('is below the nominal average when inflation is positive', () => {
    const series = getMiniChartSeries(1960, 2025);
    const realAvg = averageRealReturn(series.us_lg_growth, series.inflation);
    const nominalAvg =
      series.us_lg_growth.reduce((a, b) => a + b, 0) / series.us_lg_growth.length;
    expect(realAvg).toBeLessThan(nominalAvg);
  });
});

describe('sparklineRange', () => {
  it('returns null for an empty asset series', () => {
    expect(sparklineRange([])).toBeNull();
  });

  it('includes zero and inflation when setting the Y extent', () => {
    expect(sparklineRange([10, -20], [3, 1])).toEqual({ min: -20, max: 10 });
    expect(sparklineRange([5, 8], [12, 2])).toEqual({ min: 0, max: 12 });
  });
});

describe('sparklineZeroTopPct', () => {
  it('centers when range is missing or flat', () => {
    expect(sparklineZeroTopPct(null)).toBe(50);
    expect(sparklineZeroTopPct({ min: 0, max: 0 })).toBe(50);
  });

  it('places zero proportionally between min and max', () => {
    // max 30 at top, min -10 at bottom → zero is 30/40 of the way down = 75% from top
    expect(sparklineZeroTopPct({ min: -10, max: 30 })).toBe(75);
    // All non-negative: zero sits on the bottom edge
    expect(sparklineZeroTopPct({ min: 0, max: 12 })).toBe(100);
  });
});

describe('allocation sparkline stats for year range', () => {
  it('computes real averages and sparkline min/max for each asset', () => {
    const series = getMiniChartSeries(1960, 2025);
    for (const key of ['us_lg_growth', 'us_lg_value', 'us_sm_mid', 'ex_us', 'bond', 'cash']) {
      const avg = averageRealReturn(series[key], series.inflation);
      const range = sparklineRange(series[key], series.inflation);
      expect(avg).not.toBeNull();
      expect(range).not.toBeNull();
      expect(range.max).toBeGreaterThanOrEqual(range.min);
      expect(formatPct1(avg)).toMatch(/^-?\d+(\.\d)?$/);
    }
  });

  it('changes when the selected year range changes', () => {
    const long = getMiniChartSeries(1960, 2025);
    const short = getMiniChartSeries(2000, 2010);
    expect(formatPct1(averageRealReturn(long.us_lg_growth, long.inflation))).not.toBe(
      formatPct1(averageRealReturn(short.us_lg_growth, short.inflation))
    );
  });
});
