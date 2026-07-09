import { describe, it, expect } from 'vitest';
import {
  minAvailableYear,
  maxAvailableYear,
  clampYearToAvailableRange,
  normalizeYearRange,
} from '../src/data/historicalData.js';
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
