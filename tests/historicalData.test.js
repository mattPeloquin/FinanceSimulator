import { describe, it, expect } from 'vitest';
import {
  minAvailableYear,
  maxAvailableYear,
  clampYearToAvailableRange,
  normalizeYearRange,
} from '../src/data/historicalData.js';
import { rollingRealReturnBand } from '../src/core/history.js';

describe('historical year range helpers', () => {
  it('clamps years to the available data range', () => {
    expect(clampYearToAvailableRange(1850)).toBe(minAvailableYear);
    expect(clampYearToAvailableRange(2100)).toBe(maxAvailableYear);
    expect(clampYearToAvailableRange(1960)).toBe(1960);
  });

  it('falls back to min year for non-numeric input', () => {
    expect(clampYearToAvailableRange('')).toBe(minAvailableYear);
    expect(clampYearToAvailableRange('abc')).toBe(minAvailableYear);
  });

  it('normalizes start/end so both are in range and start <= end', () => {
    expect(normalizeYearRange(2020, 2010)).toEqual({ startYear: 2020, endYear: 2020 });
    expect(normalizeYearRange(1800, 2025)).toEqual({
      startYear: minAvailableYear,
      endYear: maxAvailableYear,
    });
  });
});

describe('rollingRealReturnBand', () => {
  const allocation = { usLgGrowth: 0.6, bond: 0.4 };

  it('computes an exact band from a hand-checkable dataset', () => {
    // Two 2-year windows over three years of 100% us_lg_growth, zero inflation.
    const data = {
      2000: { us_lg_growth: 10, bond: 0, inflation: 0 },
      2001: { us_lg_growth: 10, bond: 0, inflation: 0 },
      2002: { us_lg_growth: 21, bond: 0, inflation: 0 },
    };
    const band = rollingRealReturnBand({ usLgGrowth: 1 }, 2, data);
    expect(band.windows).toBe(2);
    // Windows: 1.1*1.1 -> 10% and 1.1*1.21 -> ~15.36% annualized.
    expect(band.low).toBeCloseTo(0.1, 10);
    expect(band.high).toBeCloseTo(Math.sqrt(1.1 * 1.21) - 1, 10);
  });

  it('spans one window per possible start year on the real dataset', () => {
    const horizon = 30;
    const band = rollingRealReturnBand(allocation, horizon);
    expect(band.windows).toBe(maxAvailableYear - minAvailableYear + 1 - horizon + 1);
    expect(band.low).toBeLessThan(band.high);
    expect(band.low).toBeGreaterThan(-0.2);
    expect(band.high).toBeLessThan(0.25);
  });

  it('returns null when the horizon exceeds the data or allocation is missing', () => {
    expect(rollingRealReturnBand(allocation, 500)).toBeNull();
    expect(rollingRealReturnBand(null, 30)).toBeNull();
  });
});
