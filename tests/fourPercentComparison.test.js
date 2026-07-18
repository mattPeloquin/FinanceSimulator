import { describe, it, expect } from 'vitest';
import {
  CLASSIC_FOUR_PERCENT_RATE,
  buildClassicFourPercentParams,
  buildFourPercentComparison,
  isClassicFourPercentEquivalent,
} from '../src/core/fourPercentComparison.js';

function baseParams(overrides = {}) {
  const numYears = overrides.numYears ?? 30;
  const start = overrides.start ?? 1_000_000;
  const { portfolio: portfolioOverrides, dynConfig: dynOverrides, ...rest } = overrides;
  return {
    numYears,
    maxYears: numYears,
    numSimulations: 100,
    seed: 42,
    samples: { startYear: 1970, endYear: 2020, years: [] },
    withdrawalMetric: 'total',
    portfolio: {
      strategy: 'base',
      start,
      base: 50_000,
      specificWithdrawals: new Array(numYears).fill(0),
      floorBalance: 800_000,
      floorPenalty: 0.1,
      ceilingBalance: 1_500_000,
      ceilingBonus: 0.05,
      glideTarget: 200_000,
      glideFraction: 0.25,
      withdrawalFloorSeries: new Array(numYears).fill(20_000),
      spendingOverTimeSeries: Array.from({ length: numYears }, () => ({
        changeRate: 0.01,
        extra: 5_000,
      })),
      giftingSeries: Array.from({ length: numYears }, () => ({
        amount: 1_000,
        balanceThreshold: 900_000,
      })),
      majorEventsSeries: new Array(numYears).fill(0),
      maxConsecutiveMinWithdrawals: 3,
      minWithdrawalPlanRecoveryYears: 2,
      ...portfolioOverrides,
    },
    dynConfig: {
      enabled: true,
      low: { ret: -0.1, adj: -5_000 },
      med: { ret: 0.05, adj: 0 },
      high: { ret: 0.15, adj: 5_000 },
      ...dynOverrides,
    },
    ...rest,
  };
}

function flatFourPercentParams(start = 1_000_000, numYears = 20) {
  return buildClassicFourPercentParams({
    numYears,
    maxYears: numYears,
    withdrawalMetric: 'total',
    dynConfig: { enabled: false },
    portfolio: {
      strategy: 'base',
      start,
      base: start * CLASSIC_FOUR_PERCENT_RATE,
      floorBalance: 0,
      floorPenalty: 0,
      ceilingBalance: Infinity,
      ceilingBonus: 0,
      glideTarget: null,
      spendingOverTimeSeries: Array.from({ length: numYears }, () => ({ changeRate: 0, extra: 0 })),
      withdrawalFloorSeries: new Array(numYears).fill(0),
      giftingSeries: Array.from({ length: numYears }, () => ({ amount: 0, balanceThreshold: 0 })),
      majorEventsSeries: new Array(numYears).fill(0),
      maxConsecutiveMinWithdrawals: 0,
    },
  });
}

describe('buildClassicFourPercentParams', () => {
  it('forces a flat real 4% base with dynamics and extras off', () => {
    const params = baseParams();
    const classic = buildClassicFourPercentParams(params);

    expect(classic.portfolio.strategy).toBe('base');
    expect(classic.portfolio.base).toBeCloseTo(params.portfolio.start * CLASSIC_FOUR_PERCENT_RATE);
    expect(classic.dynConfig.enabled).toBe(false);
    expect(classic.portfolio.glideTarget).toBeNull();
    expect(classic.portfolio.floorBalance).toBe(0);
    expect(classic.portfolio.floorPenalty).toBe(0);
    expect(classic.portfolio.ceilingBalance).toBe(Infinity);
    expect(classic.portfolio.ceilingBonus).toBe(0);
    expect(classic.portfolio.maxConsecutiveMinWithdrawals).toBe(0);
    expect(classic.portfolio.spendingOverTimeSeries.every((e) => e.changeRate === 0 && e.extra === 0)).toBe(true);
    expect(classic.portfolio.withdrawalFloorSeries.every((v) => v === 0)).toBe(true);
    expect(classic.portfolio.giftingSeries.every((e) => e.amount === 0)).toBe(true);
    expect(classic.portfolio.majorEventsSeries.every((v) => v === 0)).toBe(true);
  });

  it('preserves seed and samples by reference for fair path matching', () => {
    const params = baseParams();
    const classic = buildClassicFourPercentParams(params);
    expect(classic.seed).toBe(params.seed);
    expect(classic.samples).toBe(params.samples);
    expect(classic.numSimulations).toBe(params.numSimulations);
    expect(classic.numYears).toBe(params.numYears);
  });

  it('inherits advisor fee and withdrawal tax from the user portfolio', () => {
    const taxSeries = Array.from({ length: 30 }, () => ({
      taxRate: 0.2,
      applyToGifts: true,
      spendBrackets: [],
    }));
    const params = baseParams({
      portfolio: {
        advisorFeeRate: 0.01,
        withdrawalTaxSeries: taxSeries,
      },
    });
    const classic = buildClassicFourPercentParams(params);
    expect(classic.portfolio.advisorFeeRate).toBe(0.01);
    expect(classic.portfolio.withdrawalTaxSeries).toBe(taxSeries);
    expect(classic.portfolio.withdrawalTaxSeries[0].taxRate).toBe(0.2);
  });
});

describe('isClassicFourPercentEquivalent', () => {
  it('detects a plan that is already a flat 4% rule', () => {
    const params = flatFourPercentParams(2_000_000, 25);
    expect(isClassicFourPercentEquivalent(params)).toBe(true);
  });

  it('rejects plans with dynamics or a different base rate', () => {
    expect(isClassicFourPercentEquivalent(baseParams())).toBe(false);
    const almost = buildClassicFourPercentParams(baseParams());
    almost.portfolio.base = almost.portfolio.start * 0.05;
    expect(isClassicFourPercentEquivalent(almost)).toBe(false);
  });

  it('still treats flat 4% as equivalent when fee or tax are set', () => {
    const withFee = flatFourPercentParams(2_000_000, 25);
    withFee.portfolio.advisorFeeRate = 0.01;
    expect(isClassicFourPercentEquivalent(withFee)).toBe(true);

    const withTax = flatFourPercentParams(2_000_000, 25);
    withTax.portfolio.withdrawalTaxSeries = Array.from({ length: 25 }, () => ({
      taxRate: 0.15,
      applyToGifts: true,
      spendBrackets: [],
    }));
    expect(isClassicFourPercentEquivalent(withTax)).toBe(true);
  });
});

describe('buildFourPercentComparison with withdrawal tax', () => {
  it('compares net spend on both sides when tax is active', () => {
    const params = flatFourPercentParams(1_000_000, 20);
    params.portfolio.withdrawalTaxSeries = Array.from({ length: 20 }, () => ({
      taxRate: 0.25,
      applyToGifts: true,
      spendBrackets: [],
    }));
    const userResult = {
      withdrawalMetric: 'total',
      medianBalance: 100_000,
      medianWithdrawn: 1_250_000,
      medianNetSpend: 1_000_000,
      meanYearlyWithdrawn: 62_500,
      meanYearlyNetSpend: 50_000,
      successRate: 0.9,
      withdrawalTaxActive: true,
    };
    const classicResult = {
      medianBalance: 200_000,
      medianWithdrawn: 1_000_000,
      medianNetSpend: 800_000,
      meanYearlyWithdrawn: 50_000,
      meanYearlyNetSpend: 40_000,
      successRate: 0.95,
      withdrawalTaxActive: true,
    };
    const comparison = buildFourPercentComparison(userResult, classicResult, params);
    expect(comparison.withdrawalTaxActive).toBe(true);
    expect(comparison.sharedCostsActive).toBe(true);
    // Net vs net: 1_000_000 - 800_000
    expect(comparison.totalWithdrawnDelta).toBeCloseTo(200_000, 3);
    expect(comparison.meanYearlyDelta).toBeCloseTo(10_000, 3);
    // Headline classic figure is net when tax is on
    expect(comparison.classicMedianWithdrawn).toBe(800_000);
  });
});

describe('buildFourPercentComparison', () => {
  it('leads with classic leftover and reports withdrawn / success deltas', () => {
    const params = baseParams();
    const userResult = {
      medianBalance: 400_000,
      medianWithdrawn: 1_800_000,
      medianYearlyWithdrawn: 60_000,
      meanYearlyWithdrawn: 60_000,
      successRate: 0.92,
      withdrawalMetric: 'total',
    };
    const classicResult = {
      medianBalance: 1_200_000,
      medianWithdrawn: 1_200_000,
      medianYearlyWithdrawn: 40_000,
      meanYearlyWithdrawn: 40_000,
      successRate: 0.97,
      withdrawalMetric: 'total',
    };

    const comparison = buildFourPercentComparison(userResult, classicResult, params);
    expect(comparison.equivalent).toBe(false);
    expect(comparison.classicLeftover).toBe(1_200_000);
    expect(comparison.leftoverDelta).toBe(800_000);
    expect(comparison.withdrawnDelta).toBe(600_000);
    expect(comparison.totalWithdrawnDelta).toBe(600_000);
    expect(comparison.meanYearlyDelta).toBe(20_000);
    expect(comparison.classicMeanYearlyWithdrawn).toBe(40_000);
    expect(comparison.userSuccessRate).toBe(0.92);
    expect(comparison.classicSuccessRate).toBe(0.97);
    expect(comparison.classicRate).toBe(CLASSIC_FOUR_PERCENT_RATE);
    // Year 1 plan = base ($50k) + first-year extra ($5k) on a $1M start → 5.5%.
    expect(comparison.userYear1Rate).toBeCloseTo(0.055, 5);
  });

  it('marks equivalent when the user params already match classic 4%', () => {
    const params = flatFourPercentParams();
    const comparison = buildFourPercentComparison(
      { medianBalance: 10, medianWithdrawn: 1, successRate: 1, withdrawalMetric: 'total' },
      { medianBalance: 10, medianWithdrawn: 1, successRate: 1, withdrawalMetric: 'total' },
      params,
    );
    expect(comparison.equivalent).toBe(true);
  });
});
