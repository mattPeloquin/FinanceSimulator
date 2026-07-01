import { describe, it, expect } from 'vitest';
import {
  defaultScenario,
  buildSimParams,
  validateScenario,
  parseCurrency,
  formatCurrency,
  parseSpecificWithdrawals,
  migrateScenario,
  MONEY_SCALE,
} from '../src/state/scenario.js';
import { getSampleYears, computeProfiles } from '../src/core/history.js';

describe('currency helpers', () => {
  it('parses comma-separated strings as $000s', () => {
    expect(parseCurrency('4,000')).toBe(4000);
    expect(parseCurrency('80')).toBe(80);
    expect(parseCurrency('')).toBe(0);
  });
  it('formats numbers with separators', () => {
    expect(formatCurrency(4000)).toBe('4,000');
  });
});

describe('migrateScenario', () => {
  it('converts v1 dollar fields to $000s', () => {
    const v1 = { startBalance: 4000000, baseWithdrawal: 80000, numYears: 40 };
    const v2 = migrateScenario(v1, 1);
    expect(v2.startBalance).toBe(4000);
    expect(v2.baseWithdrawal).toBe(80);
    expect(v2.numYears).toBe(40);
  });
  it('leaves v2 scenarios unchanged', () => {
    const s = { startBalance: 4000, baseWithdrawal: 80 };
    expect(migrateScenario(s, 2)).toEqual(s);
  });
});

describe('buildSimParams', () => {
  it('converts percentages to decimals and shapes engine params', () => {
    const s = defaultScenario();
    s.randomSeed = '7';
    const p = buildSimParams(s, { years: [] });
    expect(p.seed).toBe(7);
    expect(p.allocation.usLgGrowth).toBeCloseTo(0.35, 6);
    expect(p.portfolio.start).toBe(4000 * MONEY_SCALE);
    expect(p.portfolio.floorPenalty).toBeCloseTo(0.5, 6);
    expect(p.dynConfig.high.adj).toBe(200 * MONEY_SCALE);
  });

  it('uses a random seed when none is provided', () => {
    const s = defaultScenario();
    s.randomSeed = '';
    const p = buildSimParams(s, { years: [] });
    expect(Number.isInteger(p.seed)).toBe(true);
    expect(p.seed).toBeGreaterThanOrEqual(0);
  });

  it('parses specific withdrawals as thousands of dollars', () => {
    const s = defaultScenario();
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '80\n85\n90';
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.specificWithdrawals).toEqual([80000, 85000, 90000]);
  });
});

describe('parseSpecificWithdrawals', () => {
  it('splits on common spreadsheet delimiters', () => {
    expect(parseSpecificWithdrawals('80\n85\n90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80\t85\t90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80;85;90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80|85|90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80, 85, 90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80,85,90')).toEqual([80000, 85000, 90000]);
  });

  it('preserves thousand separators inside a single value', () => {
    expect(parseSpecificWithdrawals('1,234')).toEqual([1234000]);
  });

  it('parses negative values as deposits', () => {
    expect(parseSpecificWithdrawals('-50\n80')).toEqual([-50000, 80000]);
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

  it('flags a horizon or simulation count above the caps', () => {
    const s = defaultScenario();
    s.numYears = 101;
    s.numSimulations = 100001;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('horizon'))).toBe(true);
    expect(errors.some((e) => e.includes('simulations'))).toBe(true);
  });

  it('flags dynamic adjustment triggers that are not strictly increasing', () => {
    const s = defaultScenario();
    s.dynLowRet = 5;
    s.dynMedRet = 5; // equal to low -> invalid
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Dynamic adjustment'))).toBe(true);
  });

  it('ignores trigger ordering when dynamic adjustments are disabled', () => {
    const s = defaultScenario();
    s.enableDynamicAdjustments = false;
    s.dynLowRet = 5;
    s.dynMedRet = 5;
    expect(validateScenario(s, range)).toEqual([]);
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
