import { describe, it, expect } from 'vitest';
import {
  defaultScenario,
  buildSimParams,
  validateScenario,
  parseCurrency,
  formatCurrency,
} from '../src/state/scenario.js';
import { getSampleYears, computeProfiles } from '../src/core/history.js';

describe('currency helpers', () => {
  it('parses comma-separated strings', () => {
    expect(parseCurrency('4,000,000')).toBe(4000000);
    expect(parseCurrency('80000')).toBe(80000);
    expect(parseCurrency('')).toBe(0);
  });
  it('formats numbers with separators', () => {
    expect(formatCurrency(4000000)).toBe('4,000,000');
  });
});

describe('buildSimParams', () => {
  it('converts percentages to decimals and shapes engine params', () => {
    const s = defaultScenario();
    s.randomSeed = '7';
    const p = buildSimParams(s, { years: [] });
    expect(p.seed).toBe(7);
    expect(p.allocation.usLgGrowth).toBeCloseTo(0.35, 6);
    expect(p.portfolio.start).toBe(4000000);
    expect(p.portfolio.floorPenalty).toBeCloseTo(0.5, 6);
    expect(p.dynConfig.high.adj).toBe(200000);
  });

  it('uses a random seed when none is provided', () => {
    const s = defaultScenario();
    s.randomSeed = '';
    const p = buildSimParams(s, { years: [] });
    expect(Number.isInteger(p.seed)).toBe(true);
    expect(p.seed).toBeGreaterThanOrEqual(0);
  });
});

describe('validateScenario', () => {
  const range = { minYear: 1900, maxYear: 2025 };

  it('passes for the default scenario (resampling)', () => {
    const s = defaultScenario();
    expect(validateScenario(s, range)).toEqual([]);
  });

  it('flags allocations that do not sum to 100', () => {
    const s = defaultScenario();
    s.cashAllocation = 20; // total becomes 110
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('100%'))).toBe(true);
  });

  it('flags incomplete log-normal profiles', () => {
    const s = defaultScenario();
    s.distMethod = 'lognormal';
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Log-normal'))).toBe(true);
  });
});

describe('history helpers', () => {
  it('returns the right number of sample years', () => {
    const years = getSampleYears(2000, 2009);
    expect(years.length).toBe(10);
  });

  it('computes profiles with finite mean and stddev', () => {
    const records = getSampleYears(1928, 2025);
    const profiles = computeProfiles(records);
    expect(Number.isFinite(profiles.us_lg_growth.mean)).toBe(true);
    expect(profiles.us_lg_growth.stdDev).toBeGreaterThan(0);
    expect(Number.isFinite(profiles.inflation.mean)).toBe(true);
  });
});
