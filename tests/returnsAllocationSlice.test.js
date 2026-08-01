import { describe, it, expect } from 'vitest';
import {
  canonicalizeDistMethod,
  normalizeReturnsAllocationSlice,
  defaultReturnsAllocationSlice,
  isValidYearRange,
  buildSamplesAndProfiles,
  YEAR_RANGE,
} from '../src/state/returnsAllocationSlice.js';

describe('returnsAllocationSlice', () => {
  it('canonicalizes historical → resampling', () => {
    expect(canonicalizeDistMethod('historical')).toBe('resampling');
    expect(canonicalizeDistMethod('resampling')).toBe('resampling');
    expect(canonicalizeDistMethod('lognormal')).toBe('lognormal');
    expect(canonicalizeDistMethod('nope', 'lognormal')).toBe('lognormal');
  });

  it('normalizes a slice and rewrites legacy distMethod', () => {
    const slice = normalizeReturnsAllocationSlice({
      startYear: 1980,
      endYear: 2000,
      distMethod: 'historical',
      allocation: { usLgGrowthAllocation: 40, bondAllocation: 60 },
    });
    expect(slice.distMethod).toBe('resampling');
    expect(slice.allocation.usLgGrowthAllocation).toBe(40);
    expect(slice.allocation.cashAllocation).toBe(0);
    expect(slice.allocationOverTimeTiers.length).toBeGreaterThan(0);
  });

  it('validates year range against dataset bounds', () => {
    expect(isValidYearRange(YEAR_RANGE.minYear, YEAR_RANGE.maxYear)).toBe(true);
    expect(isValidYearRange(YEAR_RANGE.maxYear + 1, YEAR_RANGE.maxYear + 2)).toBe(false);
    expect(isValidYearRange(2000, 1990)).toBe(false);
  });

  it('builds samples and profiles for a valid range', () => {
    const base = defaultReturnsAllocationSlice({ startYear: 1990, endYear: 1995 });
    const { samples, profiles } = buildSamplesAndProfiles(base, { forceProfiles: true });
    expect(samples.years.length).toBeGreaterThan(0);
    expect(profiles).toBeTruthy();
    expect(profiles.usLgGrowthMean).toBeTypeOf('number');
  });
});
