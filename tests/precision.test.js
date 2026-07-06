import { describe, it, expect } from 'vitest';
import { roundPct1, formatPct1 } from '../src/core/precision.js';
import { formatPercent } from '../src/ui/format.js';
import {
  getSampleYears,
  normalizeHistoricalYear,
  profilesToScenarioFields,
  computeProfiles,
} from '../src/core/history.js';
import { historicalData } from '../src/data/historicalData.js';

describe('roundPct1', () => {
  it('rounds to one decimal place', () => {
    expect(roundPct1(10.456)).toBe(10.5);
    expect(roundPct1(10.44)).toBe(10.4);
    expect(roundPct1(-2.35)).toBe(-2.4);
  });

  it('returns 0 for non-numeric input', () => {
    expect(roundPct1('')).toBe(0);
    expect(roundPct1(NaN)).toBe(0);
  });
});

describe('formatPct1', () => {
  it('formats with one decimal and strips trailing .0', () => {
    expect(formatPct1(10.5)).toBe('10.5');
    expect(formatPct1(10)).toBe('10');
    expect(formatPct1(10.04)).toBe('10');
  });
});

describe('formatPercent', () => {
  it('defaults to one decimal as a fraction input', () => {
    expect(formatPercent(0.0734)).toBe('7.3%');
    expect(formatPercent(0.10)).toBe('10%');
  });

  it('supports explicit digit override', () => {
    expect(formatPercent(0.0734, 2)).toBe('7.34%');
  });
});

describe('normalizeHistoricalYear', () => {
  it('rounds all asset return fields to one decimal', () => {
    const normalized = normalizeHistoricalYear({
      us_lg_growth: 12.34,
      us_lg_value: 5.56,
      us_sm_mid: 1.11,
      ex_us: -2.25,
      bond: 3.99,
      cash: 0.01,
      inflation: 2.46,
    });
    expect(normalized).toEqual({
      us_lg_growth: 12.3,
      us_lg_value: 5.6,
      us_sm_mid: 1.1,
      ex_us: -2.3,
      bond: 4,
      cash: 0,
      inflation: 2.5,
    });
  });
});

describe('getSampleYears', () => {
  it('returns year records normalized to one decimal', () => {
    const custom = {
      2000: {
        us_lg_growth: 10.456,
        us_lg_value: 5.04,
        us_sm_mid: 1,
        ex_us: 2,
        bond: 3,
        cash: 4,
        inflation: 2.55,
      },
    };
    const years = getSampleYears(2000, 2000, custom);
    expect(years).toHaveLength(1);
    expect(years[0].us_lg_growth).toBe(10.5);
    expect(years[0].us_lg_value).toBe(5);
    expect(years[0].inflation).toBe(2.5);
  });

  it('leaves one-decimal source values unchanged', () => {
    const years = getSampleYears(1928, 1928);
    expect(years[0].us_lg_value).toBe(historicalData[1928].us_lg_value);
  });
});

describe('profilesToScenarioFields', () => {
  it('maps computed profiles to one-decimal scenario fields', () => {
    const profiles = computeProfiles(getSampleYears(1960, 2025));
    const fields = profilesToScenarioFields(profiles);
    for (const value of Object.values(fields)) {
      expect(value).toBe(roundPct1(value));
      expect(String(value)).toMatch(/^-?\d+(\.\d)?$/);
    }
  });
});
