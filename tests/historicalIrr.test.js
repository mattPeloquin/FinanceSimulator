import { describe, it, expect } from 'vitest';
import {
  HISTORICAL_IRR_PERCENTILES,
  portfolioRealReturn,
  rollingAnnualizedRealReturns,
  historicalIrrBand,
} from '../src/core/historicalIrr.js';
import { getSampleYears } from '../src/core/history.js';

// Year record shorthand: growth-only portfolio unless more columns are given.
const yr = (us_lg_growth, inflation = 0, rest = {}) => ({ us_lg_growth, inflation, ...rest });

describe('portfolioRealReturn', () => {
  it('weights each asset class and deflates by inflation', () => {
    const record = { us_lg_growth: 10, bond: 5, inflation: 2 };
    const allocation = { usLgGrowth: 0.6, bond: 0.4 };
    // Nominal: 0.6*10% + 0.4*5% = 8%; real: 1.08/1.02 - 1.
    expect(portfolioRealReturn(record, allocation)).toBeCloseTo(1.08 / 1.02 - 1, 12);
  });

  it('treats missing data columns and allocation weights as zero', () => {
    expect(portfolioRealReturn({ inflation: 0 }, { usLgGrowth: 1 })).toBe(0);
    expect(portfolioRealReturn(yr(10), {})).toBe(0);
    // No inflation column: nominal return is the real return.
    expect(portfolioRealReturn({ us_lg_growth: 10 }, { usLgGrowth: 1 })).toBeCloseTo(0.1, 12);
  });
});

describe('rollingAnnualizedRealReturns', () => {
  it('computes one annualized return per rolling window', () => {
    const records = [yr(10), yr(10), yr(21)];
    const returns = rollingAnnualizedRealReturns(records, { usLgGrowth: 1 }, 2);
    // Windows: 1.1*1.1 -> 10% and 1.1*1.21 -> ~15.36% annualized.
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.1, 10);
    expect(returns[1]).toBeCloseTo(Math.sqrt(1.1 * 1.21) - 1, 10);
  });

  it('deflates each year by its own inflation', () => {
    const records = [yr(10, 10), yr(10, 10)];
    const returns = rollingAnnualizedRealReturns(records, { usLgGrowth: 1 }, 2);
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(0, 10);
  });

  it('is empty when the horizon exceeds the selection and wrap is off', () => {
    expect(rollingAnnualizedRealReturns([yr(10)], { usLgGrowth: 1 }, 2)).toEqual([]);
  });

  it('wraps around the selection when wrap is on, one window per starting year', () => {
    const records = [yr(10), yr(20), yr(30)];
    const returns = rollingAnnualizedRealReturns(records, { usLgGrowth: 1 }, 4, { wrap: true });
    expect(returns).toHaveLength(3);
    // Window starting at index 1 covers years 1,2,0,1: 1.2*1.3*1.1*1.2.
    expect(returns[1]).toBeCloseTo((1.2 * 1.3 * 1.1 * 1.2) ** (1 / 4) - 1, 10);
  });
});

describe('historicalIrrBand', () => {
  const allocation = { usLgGrowth: 1 };

  it('reduces the windows to their P5 and P60', () => {
    // Ten 1-year windows with distinct returns 1%..10%: P5 -> index
    // floor(10*0.05)=0 (1%), P60 -> index floor(10*0.6)=6 (7%).
    const records = Array.from({ length: 10 }, (_, i) => yr(i + 1));
    const band = historicalIrrBand(records, allocation, 1);
    expect(band.windows).toBe(10);
    expect(band.low).toBeCloseTo(0.01, 10);
    expect(band.high).toBeCloseTo(0.07, 10);
  });

  it('matches the app-wide P5–P60 outcome band by default', () => {
    expect(HISTORICAL_IRR_PERCENTILES).toEqual({ low: 0.05, high: 0.6 });
  });

  it('is computed from the selected records only, not the full dataset', () => {
    const calm = [yr(5), yr(5), yr(5)];
    const volatile = [yr(-20), yr(5), yr(40)];
    const calmBand = historicalIrrBand(calm, allocation, 2);
    const volatileBand = historicalIrrBand(volatile, allocation, 2);
    expect(calmBand.low).toBeCloseTo(0.05, 10);
    expect(calmBand.high).toBeCloseTo(0.05, 10);
    expect(volatileBand.low).toBeLessThan(calmBand.low);
    expect(volatileBand.low).toBeCloseTo(Math.sqrt(0.8 * 1.05) - 1, 10);
  });

  it('spans one window per possible start year of a real year selection', () => {
    const records = getSampleYears(1950, 2000);
    const horizon = 30;
    const band = historicalIrrBand(records, { usLgGrowth: 0.6, bond: 0.4 }, horizon);
    expect(band.windows).toBe(2000 - 1950 + 1 - horizon + 1);
    expect(band.low).toBeLessThanOrEqual(band.high);
    expect(band.low).toBeGreaterThan(-0.2);
    expect(band.high).toBeLessThan(0.25);
  });

  it('wraps around a selection shorter than the horizon instead of vanishing', () => {
    // 2 selected years, 35-year horizon: still 2 windows, flagged as wrapped.
    const records = [yr(5), yr(5)];
    const band = historicalIrrBand(records, allocation, 35);
    expect(band.wrapped).toBe(true);
    expect(band.windows).toBe(2);
    expect(band.low).toBeCloseTo(0.05, 10);
    expect(band.high).toBeCloseTo(0.05, 10);

    const unwrapped = historicalIrrBand(getSampleYears(1950, 2000), allocation, 30);
    expect(unwrapped.wrapped).toBe(false);
  });

  it('returns null when the band cannot be computed', () => {
    const records = [yr(10), yr(10)];
    expect(historicalIrrBand(records, null, 1)).toBeNull();
    expect(historicalIrrBand(records, allocation, 0)).toBeNull();
    expect(historicalIrrBand(null, allocation, 1)).toBeNull();
    expect(historicalIrrBand([], allocation, 1)).toBeNull();
  });

  it('supports custom percentiles', () => {
    const records = Array.from({ length: 10 }, (_, i) => yr(i + 1));
    const band = historicalIrrBand(records, allocation, 1, { low: 0.1, high: 0.9 });
    expect(band.low).toBeCloseTo(0.02, 10);
    expect(band.high).toBeCloseTo(0.1, 10);
  });
});
