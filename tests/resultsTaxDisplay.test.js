import { describe, it, expect } from 'vitest';
import { spendingCardValues, percentileSpendingValues } from '../src/ui/results.js';

describe('spendingCardValues', () => {
  const result = {
    medianWithdrawn: 1_200_000,
    medianYearlyWithdrawn: 40_000,
    meanYearlyWithdrawn: 40_000,
    medianNetSpend: 1_000_000,
    medianYearlyNetSpend: 33_333,
    meanYearlyNetSpend: 33_333,
    plannedWithdrawn: 900_000,
    plannedMedianYearly: 30_000,
    plannedMeanYearly: 30_000,
    plannedGrossTotal: 1_080_000,
    plannedGrossMedianYearly: 36_000,
    plannedGrossMeanYearly: 36_000,
  };

  it('returns gross figures when tax is off', () => {
    const v = spendingCardValues(result, { taxActive: false });
    expect(v.total).toBe(1_200_000);
    expect(v.medianYearly).toBe(40_000);
  });

  it('returns net headline figures when tax is on', () => {
    const v = spendingCardValues(result, { taxActive: true });
    expect(v.total).toBe(1_000_000);
    expect(v.grossTotal).toBe(1_200_000);
    expect(v.plannedGrossTotal).toBe(1_080_000);
  });
});

describe('percentileSpendingValues', () => {
  const percentile = {
    totalWithdrawn: 120_000,
    totalNetSpend: 100_000,
    medianYearlyWithdrawal: 12_000,
    medianYearlyNetSpend: 10_000,
    horizonYears: 10,
    path: { withdrawals: [12_000] },
  };

  it('uses net when tax is active', () => {
    const v = percentileSpendingValues(percentile, { taxActive: true });
    expect(v.total).toBe(100_000);
    expect(v.medianYearly).toBe(10_000);
    expect(v.meanYearly).toBeCloseTo(10_000, 6);
  });

  it('uses gross when tax is off', () => {
    const v = percentileSpendingValues(percentile, { taxActive: false });
    expect(v.total).toBe(120_000);
    expect(v.meanYearly).toBeCloseTo(12_000, 6);
  });
});
