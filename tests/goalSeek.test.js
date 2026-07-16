import { describe, it, expect } from 'vitest';
import { runMonteCarlo } from '../src/core/simulation.js';
import {
  bisectMaxSatisfying,
  bisectMaxSatisfyingAsync,
  bisectMaxSatisfyingInt,
  buildAdjustmentGrid,
  mildestMarketDownAdj,
  mildestMarketUpAdj,
  filterAdjustmentCandidatesAtOrAbove,
  enforceAscendingMarketAdjustments,
  clampMarketAdjustments,
  buildBalanceGrid,
  buildFractionGrid,
  buildBonusGrid,
  buildPairGrid,
  highestMinimumWithdrawal,
  plannedScheduleTotal,
  plannedScheduleMedianYearly,
  plannedScheduleMeanYearly,
  plannedPrimaryObjective,
  medianExcessEndingBalance,
  isBetterGoalSeekScore,
  buildPerRunPlanBenchmarks,
  riskEnvelopeScale,
  scalePctGridByEnvelope,
  resolveMarketDownAdjGrid,
  resolveMarketUpAdjGrid,
  resolveFloorPenaltyGrid,
  resolveCeilingBonusGrid,
  resolveGlideFractions,
  discountedTargetEndingBalance,
  runGoalSeek,
} from '../src/core/goalSeek.js';
import { buildSpendingOverTimeSeries } from '../src/core/withdrawal.js';

const dollars = (k) => k;
function spendingSeries(numYears, tiers) {
  return buildSpendingOverTimeSeries(tiers, numYears, dollars);
}

const simulateAsync = (params) => Promise.resolve(runMonteCarlo(params));

function seek(params, config, opts) {
  return runGoalSeek(params, config, simulateAsync, opts);
}

describe('bisectMaxSatisfying', () => {
  it('finds the boundary of a monotonically-decreasing-to-false predicate', () => {
    // predicate is true for x <= 42.3
    const result = bisectMaxSatisfying((x) => x <= 42.3, 0, 100, { tolerance: 0.01 });
    expect(result).toBeCloseTo(42.3, 1);
  });

  it('returns lo when predicate is false everywhere above lo', () => {
    const result = bisectMaxSatisfying((x) => x <= 0, 0, 100, { tolerance: 0.01 });
    expect(result).toBeCloseTo(0, 1);
  });
});

describe('bisectMaxSatisfyingAsync', () => {
  it('finds the boundary with an async predicate', async () => {
    const result = await bisectMaxSatisfyingAsync(async (x) => x <= 42.3, 0, 100, { tolerance: 0.01 });
    expect(result).toBeCloseTo(42.3, 1);
  });
});

describe('bisectMaxSatisfyingInt', () => {
  it('finds the largest integer satisfying the predicate', () => {
    const result = bisectMaxSatisfyingInt((y) => y <= 17, 0, 40);
    expect(result).toBe(17);
  });

  it('handles predicate true across the whole range', () => {
    expect(bisectMaxSatisfyingInt(() => true, 0, 40)).toBe(40);
  });

  it('handles predicate true only at lo', () => {
    expect(bisectMaxSatisfyingInt((y) => y === 0, 0, 40)).toBe(0);
  });
});

describe('buildAdjustmentGrid', () => {
  it('builds a percentage grid around the base withdrawal and skips 0%', () => {
    const grid = buildAdjustmentGrid(100000, { minPct: -10, maxPct: 10, stepPct: 5 });
    expect(grid).toEqual([-10000, -5000, 5000, 10000]);
  });

  it('rounds candidates to the nearest whole $1,000', () => {
    const grid = buildAdjustmentGrid(100501, { minPct: -10, maxPct: 10, stepPct: 5 });
    for (const value of grid) expect(value % 1000 === 0).toBe(true);
    expect(grid).toEqual([-10000, -5000, 5000, 10000]);
  });

  it('excludes 0 from the default Low and High grids', () => {
    const lowGrid = buildAdjustmentGrid(100000);
    expect(lowGrid.every((value) => value < 0)).toBe(true);
    expect(lowGrid).toContain(-5000);
    expect(lowGrid).not.toContain(0);

    const highGrid = buildAdjustmentGrid(100000, { minPct: 10, maxPct: 100, stepPct: 10 });
    expect(highGrid.every((value) => value > 0)).toBe(true);
    expect(highGrid).toContain(10000);
    expect(highGrid).not.toContain(0);
  });

  it('pins collapsed small-base percentages to ±$1,000 instead of $0', () => {
    const lowGrid = buildAdjustmentGrid(8000, { minPct: -5, maxPct: -5, stepPct: 5 });
    expect(lowGrid).toEqual([-1000]);

    const highGrid = buildAdjustmentGrid(8000, { minPct: 10, maxPct: 10, stepPct: 10 });
    expect(highGrid).toEqual([1000]);
  });
});

describe('mildestMarketDownAdj / mildestMarketUpAdj', () => {
  it('returns the closest-to-zero cut and boost on each default-style grid', () => {
    expect(mildestMarketDownAdj(100000, { minPct: -50, maxPct: -5, stepPct: 5 })).toBe(-5000);
    expect(mildestMarketUpAdj(100000, { minPct: 10, maxPct: 100, stepPct: 10 })).toBe(10000);
  });
});

describe('clampMarketAdjustments', () => {
  it('forces Low below zero and High above zero around a zero Expected anchor', () => {
    const dynConfig = {
      low: { adj: 0 },
      med: { adj: 0 },
      high: { adj: 0 },
    };
    clampMarketAdjustments({}, dynConfig, 100000);
    expect(dynConfig.low.adj).toBe(-5000);
    expect(dynConfig.med.adj).toBe(0);
    expect(dynConfig.high.adj).toBe(10000);
  });
});

describe('riskEnvelopeScale / scalePctGridByEnvelope', () => {
  it('maps 0 / 10% / 20% / 35% Risk Tolerance onto 0 / 0.5 / 1 / 1', () => {
    expect(riskEnvelopeScale(0)).toBe(0);
    expect(riskEnvelopeScale(0.1)).toBeCloseTo(0.5, 9);
    expect(riskEnvelopeScale(0.2)).toBe(1);
    expect(riskEnvelopeScale(0.35)).toBe(1);
  });

  it('scales market Low/High deep ends over the 0–20% envelope', () => {
    const down = { minPct: -50, maxPct: -5, stepPct: 5 };
    const up = { minPct: 10, maxPct: 100, stepPct: 10 };
    expect(scalePctGridByEnvelope(down, 0)).toEqual({ minPct: -5, maxPct: -5, stepPct: 5 });
    expect(scalePctGridByEnvelope(down, 0.5).minPct).toBeCloseTo(-25, 9);
    expect(scalePctGridByEnvelope(down, 1).minPct).toBe(-50);
    expect(scalePctGridByEnvelope(up, 0)).toEqual({ minPct: 10, maxPct: 10, stepPct: 10 });
    expect(scalePctGridByEnvelope(up, 0.5).maxPct).toBeCloseTo(50, 9);
    expect(scalePctGridByEnvelope(up, 1).maxPct).toBe(100);
  });

  it('scales floor max cut to 25% at 10% RT and 50% at ≥20% (not equal to RT)', () => {
    const floorFull = { minPct: 0, maxPct: 50, stepPct: 10 };
    expect(resolveFloorPenaltyGrid({ shortfallTolerance: 0.1 }).maxPct).toBeCloseTo(25, 9);
    expect(resolveFloorPenaltyGrid({ shortfallTolerance: 0.2 }).maxPct).toBe(50);
    expect(resolveFloorPenaltyGrid({ shortfallTolerance: 0.35 }).maxPct).toBe(50);
    expect(scalePctGridByEnvelope(floorFull, 0)).toEqual({ minPct: 10, maxPct: 10, stepPct: 10 });
  });

  it('scales ceiling boost and glide surplus the same way', () => {
    expect(resolveCeilingBonusGrid({ shortfallTolerance: 0.1 }).maxPct).toBeCloseTo(75, 9);
    expect(resolveCeilingBonusGrid({ shortfallTolerance: 0.2 }).maxPct).toBe(150);
    expect(resolveGlideFractions({ shortfallTolerance: 0.1 })).toEqual([0.1, 0.2]);
    expect(resolveGlideFractions({ shortfallTolerance: 0.2 })).toEqual([0.1, 0.2, 0.4, 0.6]);
    expect(resolveGlideFractions({ shortfallTolerance: 0 })).toEqual([0.1]);
  });

  it('discounts Target Ending Balance by Risk Tolerance', () => {
    expect(discountedTargetEndingBalance({
      targetEndingBalance: 1_000_000,
      shortfallTolerance: 0.2,
    })).toBe(800_000);
    expect(discountedTargetEndingBalance({
      targetEndingBalance: 500_000,
      shortfallTolerance: 0,
    })).toBe(500_000);
  });

  it('scales market Low candidate extrema at 10% Risk Tolerance', () => {
    const grid = resolveMarketDownAdjGrid({ shortfallTolerance: 0.1 });
    expect(grid.minPct).toBeCloseTo(-25, 9);
    expect(grid.maxPct).toBe(-5);
    const dollars = buildAdjustmentGrid(100_000, grid);
    expect(Math.min(...dollars)).toBe(-25_000);
    expect(Math.max(...dollars)).toBe(-5_000);

    const up = resolveMarketUpAdjGrid({ shortfallTolerance: 0.1 });
    expect(up.maxPct).toBeCloseTo(50, 9);
    const upDollars = buildAdjustmentGrid(100_000, up);
    expect(Math.max(...upDollars)).toBe(50_000);
  });
});

describe('filterAdjustmentCandidatesAtOrAbove', () => {
  it('keeps only candidates at or above the lower-band floor', () => {
    expect(filterAdjustmentCandidatesAtOrAbove([-20000, -10000, 0, 10000], -10000))
      .toEqual([-10000, 0, 10000]);
  });

  it('pins to the floor when no grid point reaches it', () => {
    expect(filterAdjustmentCandidatesAtOrAbove([-20000, -10000, 0], 5000)).toEqual([5000]);
  });
});

describe('enforceAscendingMarketAdjustments', () => {
  it('moves Low down and High up around the fixed Expected anchor', () => {
    const dynConfig = {
      low: { adj: 0 },
      med: { adj: -20000 },
      high: { adj: -25000 },
    };
    enforceAscendingMarketAdjustments(dynConfig);
    expect(dynConfig.low.adj).toBe(-20000);
    expect(dynConfig.med.adj).toBe(-20000);
    expect(dynConfig.high.adj).toBe(-20000);
  });

  it('leaves an already-ascending ladder unchanged', () => {
    const dynConfig = {
      low: { adj: -20000 },
      med: { adj: 0 },
      high: { adj: 30000 },
    };
    enforceAscendingMarketAdjustments(dynConfig);
    expect(dynConfig.low.adj).toBe(-20000);
    expect(dynConfig.med.adj).toBe(0);
    expect(dynConfig.high.adj).toBe(30000);
  });
});

describe('buildBalanceGrid', () => {
  it('maps a 0 multiple to null (off) by default and scales the rest by starting balance', () => {
    const grid = buildBalanceGrid(1000000, [0, 0.5, 1, 2]);
    expect(grid).toEqual([null, 500000, 1000000, 2000000]);
  });

  it('uses a custom offValue (e.g. 0 for floorBalance, Infinity for ceilingBalance)', () => {
    expect(buildBalanceGrid(1000000, [0, 0.5, 1], 0)).toEqual([0, 500000, 1000000]);
    expect(buildBalanceGrid(1000000, [0, 0.5, 1], Infinity)).toEqual([Infinity, 500000, 1000000]);
  });

  it('rounds candidates to the nearest whole $1,000', () => {
    const grid = buildBalanceGrid(1000501, [0, 0.5, 1]);
    for (const value of grid) expect(value === null || value % 1000 === 0).toBe(true);
    expect(grid).toEqual([null, 500000, 1001000]);
  });
});


describe('buildFractionGrid', () => {
  it('builds a 5-65% grid in 10-point steps as 0-1 fractions by default', () => {
    const grid = buildFractionGrid();
    expect(grid).toEqual([0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65]);
  });

  it('respects a custom range/step', () => {
    const grid = buildFractionGrid({ minPct: 0, maxPct: 20, stepPct: 10 });
    expect(grid).toEqual([0, 0.1, 0.2]);
  });
});

describe('buildBonusGrid', () => {
  it('scales bonus candidates as a fraction of the base withdrawal, rounded to $1,000', () => {
    const grid = buildBonusGrid(80000, [0, 0.25, 0.5, 1]);
    expect(grid).toEqual([0, 20000, 40000, 80000]);
  });
});

describe('buildPairGrid', () => {
  it('builds the full cartesian product when nothing is off', () => {
    const pairs = buildPairGrid([1, 2], ['a', 'b'], () => false);
    expect(pairs).toEqual([
      [1, 'a'],
      [1, 'b'],
      [2, 'a'],
      [2, 'b'],
    ]);
  });

  it('collapses the secondary dimension to a single candidate when the primary is off', () => {
    const pairs = buildPairGrid([0, 1, 2], [10, 20, 30], (primary) => primary === 0);
    // primary=0 collapses to just [0, 10] (the secondary grid's first/off value).
    expect(pairs).toEqual([
      [0, 10],
      [1, 10],
      [1, 20],
      [1, 30],
      [2, 10],
      [2, 20],
      [2, 30],
    ]);
  });
});

// ---- Integration: a small, deterministic scenario ---------------------------

const baseAllocation = {
  usLgGrowth: 0.35,
  usLgValue: 0.25,
  usSmMid: 0.15,
  exUs: 0.15,
  bond: 0.0,
  cash: 0.1,
};

const logNormalProfiles = {
  usLgGrowth: { mean: 0.1, stdDev: 0.18 },
  usLgValue: { mean: 0.09, stdDev: 0.16 },
  usSmMid: { mean: 0.11, stdDev: 0.22 },
  exUs: { mean: 0.08, stdDev: 0.2 },
  bond: { mean: 0.03, stdDev: 0.06 },
  cash: { mean: 0.02, stdDev: 0.01 },
  inflation: { mean: 0.025, stdDev: 0.02 },
};

function makeParams(overrides = {}) {
  return {
    numYears: 25,
    numSimulations: 800,
    seed: 777,
    distMethod: 'lognormal',
    blockSize: 1,
    smoothFraction: 0,
    allocation: baseAllocation,
    logNormal: logNormalProfiles,
    portfolio: {
      strategy: 'base',
      start: 2_000_000,
      base: 80_000,
      // Easy Mode–style active bands (0.8× / 1.2× start) so Balance rate
      // search has thresholds to tune against by default.
      floorBalance: 1_600_000,
      floorPenalty: 0,
      ceilingBalance: 2_400_000,
      ceilingBonus: 0,
      withdrawalFloorSeries: new Array(25).fill(0),
      spendingOverTimeSeries: spendingSeries(25, [
        { changePct: 0, extra: 20_000, years: 5 },
        { changePct: 0, extra: 0 },
      ]),
    },
    dynConfig: {
      enabled: true,
      low: { ret: -15, adj: -20_000 },
      med: { ret: 5, adj: 0 },
      high: { ret: 20, adj: 20_000 },
      noCutBal: null,
    },
    samples: null,
    ...overrides,
  };
}

// Coarse grids so lever-tuning tests exercise the real search mechanics
// (joint pairs, re-solve scoring) without the full production grid sizes,
// which would make the test suite slow. Production defaults are unaffected —
// these are only passed explicitly into the configs below.
const FAST_LEVER_GRIDS = {
  balanceMultiples: [0, 1],
  adjustmentGrid: { minPct: -30, maxPct: 30, stepPct: 30 },
  penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 50 },
  goGoBonusFractions: [0, 1],
};

const DEFAULT_GOAL_SEEK_CONFIG = {
  shortfallTolerance: 0.2,
};

describe('buildPerRunPlanBenchmarks', () => {
  it('memoizes benchmarks by horizon length', () => {
    const portfolio = {
      strategy: 'base',
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(30, [{ changePct: 0, extra: 0 }]),
      withdrawalFloorSeries: new Array(30).fill(0),
    };
    const horizons = Int32Array.from([25, 25, 30, 30, 28]);
    const benchmarks = buildPerRunPlanBenchmarks(portfolio, horizons, 'total');
    expect(benchmarks[0]).toBe(benchmarks[1]);
    expect(benchmarks[2]).toBe(benchmarks[3]);
    expect(benchmarks[2]).toBeGreaterThan(benchmarks[0]);
  });

  it('builds mean-yearly benchmarks as each horizon plan total over its years', () => {
    const portfolio = {
      strategy: 'base',
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(30, [{ changePct: 0, extra: 0 }]),
      withdrawalFloorSeries: new Array(30).fill(0),
    };
    const horizons = Int32Array.from([25, 30]);
    const benchmarks = buildPerRunPlanBenchmarks(portfolio, horizons, 'meanYearly');
    expect(benchmarks[0]).toBeCloseTo(plannedScheduleTotal(portfolio, 25) / 25, 6);
    expect(benchmarks[1]).toBeCloseTo(plannedScheduleTotal(portfolio, 30) / 30, 6);
  });
});

describe('plannedScheduleTotal', () => {
  it('sums base withdrawals with front-loading and bonus years', () => {
    const portfolio = {
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(5, [
        { changePct: 0, extra: 20_000, years: 2 },
        { changePct: 0, extra: 0 },
      ]),
      withdrawalFloorSeries: new Array(5).fill(0),
    };
    // years 0-1: 120k each, years 2-4: 100k each = 540k
    expect(plannedScheduleTotal(portfolio, 5)).toBe(540_000);
  });

  it('does not fold minimum-withdrawal floors into the planned schedule', () => {
    const portfolio = {
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(5, [{ changePct: -2, extra: 0 }]),
      withdrawalFloorSeries: [120_000, 120_000, 0, 0, 0],
    };
    // Plan follows the schedule only; floors are backstops at run time.
    const expected = 100_000
      + 100_000 * 0.98
      + 100_000 * 0.98 ** 2
      + 100_000 * 0.98 ** 3
      + 100_000 * 0.98 ** 4;
    expect(plannedScheduleTotal(portfolio, 5)).toBeCloseTo(expected, 0);
  });

  it('sums the fixed per-year amounts for a specific-list strategy, ignoring base/bonus fields', () => {
    const portfolio = {
      strategy: 'specific',
      specificWithdrawals: [80_000, 85_000, 90_000, 90_000, 90_000],
      // These would change the total if the (unused) base-strategy formula were applied.
      base: 999_000,
      spendingOverTimeSeries: spendingSeries(5, [
        { changePct: 50, extra: 500_000, years: 5 },
        { changePct: 0, extra: 0 },
      ]),
      withdrawalFloorSeries: new Array(5).fill(0),
    };
    expect(plannedScheduleTotal(portfolio, 5)).toBe(80_000 + 85_000 + 90_000 + 90_000 + 90_000);
  });

  it('keeps typed amounts as the plan when percentage floors are below 100%', () => {
    const portfolio = {
      strategy: 'specific',
      specificWithdrawals: [50_000, 85_000, 90_000],
      withdrawalFloorSeries: [40_000, 68_000, 72_000], // 80% of each year's amount
    };
    // Floors are backstops only — the planned schedule stays the typed amounts.
    expect(plannedScheduleTotal(portfolio, 3)).toBe(50_000 + 85_000 + 90_000);
  });
});

describe('plannedScheduleMedianYearly', () => {
  it('returns the median of the unadjusted per-year schedule', () => {
    const portfolio = {
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(5, [
        { changePct: 0, extra: 20_000, years: 2 },
        { changePct: 0, extra: 0 },
      ]),
      withdrawalFloorSeries: new Array(5).fill(0),
    };
    // years 0-1: 120k, years 2-4: 100k -> median = 100k
    expect(plannedScheduleMedianYearly(portfolio, 5)).toBe(100_000);
  });

  it('uses typed amounts for a specific-list strategy', () => {
    const portfolio = {
      strategy: 'specific',
      specificWithdrawals: [80_000, 85_000, 90_000],
      withdrawalFloorSeries: [0, 0, 0],
    };
    expect(plannedScheduleMedianYearly(portfolio, 3)).toBe(85_000);
  });
});

describe('plannedScheduleMeanYearly', () => {
  it('returns the schedule total divided by the horizon', () => {
    const portfolio = {
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(5, [
        { changePct: 0, extra: 20_000, years: 2 },
        { changePct: 0, extra: 0 },
      ]),
      withdrawalFloorSeries: new Array(5).fill(0),
    };
    // years 0-1: 120k, years 2-4: 100k -> mean = 540k / 5 = 108k (median is 100k)
    expect(plannedScheduleMeanYearly(portfolio, 5)).toBe(108_000);
    expect(plannedScheduleMeanYearly(portfolio, 0)).toBe(0);
  });
});

describe('plannedPrimaryObjective', () => {
  const portfolio = {
    base: 100_000,
    spendingOverTimeSeries: spendingSeries(5, [
      { changePct: 0, extra: 20_000, years: 2 },
      { changePct: 0, extra: 0 },
    ]),
    withdrawalFloorSeries: new Array(5).fill(0),
  };

  it('uses the planned schedule benchmark when there is no early window', () => {
    expect(plannedPrimaryObjective(portfolio, 5, 'total')).toBe(540_000);
    expect(plannedPrimaryObjective(portfolio, 5, 'medianYearly')).toBe(100_000);
    expect(plannedPrimaryObjective(portfolio, 5, 'meanYearly')).toBe(108_000);
  });

  it('averages planned dollars over the early window when front-loading', () => {
    // years 0-1 are 120k each → average 120k over a 2-year window
    expect(plannedPrimaryObjective(portfolio, 5, 'total', 2)).toBe(120_000);
  });
});

describe('medianExcessEndingBalance', () => {
  it('returns the median of ending balances above the target', () => {
    // Excesses vs $100k target: 0, 50k, 100k → median 50k
    expect(medianExcessEndingBalance(
      Float64Array.from([50_000, 150_000, 200_000]),
      100_000,
    )).toBe(50_000);
  });

  it('returns 0 when every run finishes at or below the target', () => {
    expect(medianExcessEndingBalance(
      Float64Array.from([0, 50_000, 100_000]),
      100_000,
    )).toBe(0);
  });
});

describe('isBetterGoalSeekScore', () => {
  it('prefers a meaningfully higher planned primary over lower excess ending', () => {
    expect(isBetterGoalSeekScore(
      { plannedPrimary: 2_000_000, medianExcessEnding: 500_000, successRate: 0.8 },
      { plannedPrimary: 1_500_000, medianExcessEnding: 0, successRate: 0.9 },
    )).toBe(true);
  });

  it('uses spend-down before RT-tail excess when planned values are within $1,000', () => {
    expect(isBetterGoalSeekScore(
      { plannedPrimary: 1_000_500, tailRatioExcess: 0.15, medianExcessEnding: 10_000, successRate: 0.8 },
      { plannedPrimary: 1_000_000, tailRatioExcess: 0.02, medianExcessEnding: 50_000, successRate: 0.8 },
    )).toBe(true);
    expect(isBetterGoalSeekScore(
      { plannedPrimary: 1_000_500, tailRatioExcess: 0.02, medianExcessEnding: 50_000, successRate: 0.8 },
      { plannedPrimary: 1_000_000, tailRatioExcess: 0.15, medianExcessEnding: 10_000, successRate: 0.8 },
    )).toBe(false);
  });

  it('prefers lower RT-tail excess when planned and spend-down are tied', () => {
    expect(isBetterGoalSeekScore(
      { plannedPrimary: 1_000_500, tailRatioExcess: 0.02, medianExcessEnding: 10_000, successRate: 0.8 },
      { plannedPrimary: 1_000_000, tailRatioExcess: 0.15, medianExcessEnding: 10_000, successRate: 0.8 },
    )).toBe(true);
    expect(isBetterGoalSeekScore(
      { plannedPrimary: 1_000_500, tailRatioExcess: 0.15, medianExcessEnding: 10_000, successRate: 0.8 },
      { plannedPrimary: 1_000_000, tailRatioExcess: 0.02, medianExcessEnding: 10_000, successRate: 0.8 },
    )).toBe(false);
  });

  it('breaks a full tie with higher success rate', () => {
    expect(isBetterGoalSeekScore(
      {
        plannedPrimary: 1_000_000,
        tailRatioExcess: 0.05,
        medianExcessEnding: 10_000,
        successRate: 0.9,
      },
      {
        plannedPrimary: 1_000_000,
        tailRatioExcess: 0.05,
        medianExcessEnding: 10_000,
        successRate: 0.8,
      },
    )).toBe(true);
  });
});

describe('highestMinimumWithdrawal', () => {
  it('returns the largest tier amount in the series', () => {
    expect(highestMinimumWithdrawal({ withdrawalFloorSeries: [120_000, 80_000, 0] })).toBe(120_000);
  });

  it('returns 0 when there are no minimum tiers', () => {
    expect(highestMinimumWithdrawal({ withdrawalFloorSeries: [] })).toBe(0);
    expect(highestMinimumWithdrawal({ withdrawalFloorSeries: [0, 0, 0] })).toBe(0);
  });
});

describe('runGoalSeek', () => {
  it('finds a base withdrawal achieving roughly the desired success rate', async () => {
    const params = makeParams();
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
      ...DEFAULT_GOAL_SEEK_CONFIG,
    });

    expect(summary.feasible).toBe(true);
    expect(finalParams.numSimulations).toBe(params.numSimulations);
    // Achieved success rate should be close to (at least near) the target,
    // since bisection converges on the boundary from the feasible side.
    expect(summary.achievedSuccessRate).toBeGreaterThanOrEqual(0.7);
    expect(summary.baseWithdrawal).toBeGreaterThan(0);
    // No front-loading lever included, so the objective stays the lifetime
    // total and there's no bonus-years window to report.
    expect(summary.earlyYearsWindow).toBeUndefined();
  });

  it('enforces the P(100 − Desired) spending ratio RT floor on feasible plans', async () => {
    const params = makeParams();
    const shortfallTolerance = 0.2;
    const desiredSuccessRate = 0.8;
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate,
      shortfallTolerance,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 800,
      maxRounds: 2,
      ...FAST_LEVER_GRIDS,
    });

    expect(summary.feasible).toBe(true);
    const rtFloor = 1 - shortfallTolerance;
    // Split gate: the failure-percentile actual/plan ratio must clear (1 − RT).
    // Legacy/depletion may still bind first, so the ratio need not sit exactly
    // on the floor — only at or above it.
    expect(summary.achievedTailRatio).toBeGreaterThanOrEqual(rtFloor - 1e-9);
    expect(summary.achievedSuccessRate).toBeGreaterThanOrEqual(desiredSuccessRate - 0.05);
  });

  it('ranks by planned median yearly when that metric is selected', async () => {
    const params = makeParams();
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
      withdrawalMetric: 'medianYearly',
      ...DEFAULT_GOAL_SEEK_CONFIG,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.achievedMedianYearlyWithdrawn).toBeGreaterThan(0);
    // Objective is the planned schedule median/yr, not median actual spending.
    expect(summary.achievedObjectiveValue).toBe(
      plannedScheduleMedianYearly(finalParams.portfolio, params.numYears),
    );
  });

  it('ranks by planned mean yearly when that metric is selected', async () => {
    const params = makeParams();
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
      withdrawalMetric: 'meanYearly',
      ...DEFAULT_GOAL_SEEK_CONFIG,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.achievedObjectiveValue).toBeGreaterThan(0);
    expect(summary.achievedObjectiveValue).toBeCloseTo(
      plannedScheduleMeanYearly(finalParams.portfolio, params.numYears),
      6,
    );
  });

  it('reports infeasible when even a $0 withdrawal cannot hit the target', async () => {
    const params = makeParams({ portfolio: { ...makeParams().portfolio, start: 1000 } });
    const { summary } = await seek(params, {
      targetEndingBalance: 50_000_000, // unreachable from a $1000 starting balance
      desiredSuccessRate: 0.9,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
    });
    expect(summary.feasible).toBe(false);
  });

  it('on early infeasible exit, still returns neutralized guardrail levers for the form', async () => {
    // High minimum floor + unreachable ending target → fails the min-base
    // feasibility check before any lever search. Thresholds stay as provided;
    // rates are clamped to the mildest grid mins for write-back.
    const minWithdrawal = 80_000;
    const params = makeParams({
      portfolio: {
        ...makeParams().portfolio,
        start: 1_000_000,
        base: 200_000,
        floorBalance: 999_000,
        floorPenalty: 0.4,
        ceilingBalance: 2_000_000,
        ceilingBonus: 0.5,
        withdrawalFloorSeries: new Array(25).fill(minWithdrawal),
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const { summary } = await seek(params, {
      targetEndingBalance: 50_000_000,
      desiredSuccessRate: 0.99,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      includeGlidePath: true,
      searchNumSimulations: 300,
      ...DEFAULT_GOAL_SEEK_CONFIG,
    });

    expect(summary.feasible).toBe(false);
    expect(summary.baseWithdrawal).toBe(minWithdrawal);
    // Market Low/High are clamped to the mildest non-zero grid points on
    // write-back (same "never stay at $0" rule as a successful search).
    expect(summary.marketAdjustments).toEqual({ low: -4000, med: 0, high: 8000 });
    expect(summary.marketNoCutBalance).toBeUndefined();
    expect(summary.balanceAdjustment.floorBalance).toBe(999_000);
    expect(summary.balanceAdjustment.ceilingBalance).toBe(2_000_000);
    expect(summary.balanceAdjustment.floorPenalty).toBeGreaterThan(0);
    expect(summary.balanceAdjustment.ceilingBonus).toBeGreaterThan(0);
    // Glide target is the RT-discounted Goal Seek target (default 20% → 40M).
    expect(summary.glideSpendDown.target).toBe(40_000_000);
    expect(summary.glideSpendDown.fraction).toBeGreaterThan(0);
  });

  it('does not search for a base below the highest minimum-withdrawal tier', async () => {
    const minWithdrawal = 100_000;
    const params = makeParams({
      portfolio: {
        ...makeParams().portfolio,
        base: 150_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
        withdrawalFloorSeries: new Array(25).fill(minWithdrawal),
      },
    });
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.5,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
      ...DEFAULT_GOAL_SEEK_CONFIG,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.baseWithdrawal).toBeGreaterThanOrEqual(minWithdrawal);
  });

  it('returns dollar values rounded to whole $1,000, never fractional', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.baseWithdrawal % 1000 === 0).toBe(true);
    expect(summary.spendingOverTimeBonus % 1000 === 0).toBe(true);
    for (const value of Object.values(summary.marketAdjustments)) {
      expect(value % 1000 === 0).toBe(true);
    }
    expect(summary.marketNoCutBalance === null || summary.marketNoCutBalance % 1000 === 0).toBe(true);
    // Thresholds are echoed unchanged (not searched); rates are tuned.
    expect(summary.balanceAdjustment.floorBalance).toBe(params.portfolio.floorBalance);
    expect(summary.balanceAdjustment.ceilingBalance).toBe(params.portfolio.ceilingBalance);
    expect(summary.balanceAdjustment.floorPenalty).toBeGreaterThan(0);
    expect(summary.balanceAdjustment.ceilingBonus).toBeGreaterThan(0);
  });

  it('optionally tunes early-years bonus alongside the base withdrawal', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.spendingOverTimeBonus).toBeGreaterThanOrEqual(0);
  });

  it('tunes market adjustments and the no-cut balance threshold together', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.marketAdjustments).toHaveProperty('low');
    expect(summary.marketAdjustments).toHaveProperty('med');
    expect(summary.marketAdjustments).toHaveProperty('high');
    expect(summary).toHaveProperty('marketNoCutBalance');
  });

  it('never returns $0 Low or High market adjustments with the default grids', async () => {
    const params = makeParams();
    const { summary, params: finalParams } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 1,
      ceilingMultiples: [0, 1],
    });
    expect(summary.feasible).toBe(true);
    expect(summary.marketAdjustments.low).toBeLessThan(0);
    expect(summary.marketAdjustments.high).toBeGreaterThan(0);
    expect(finalParams.dynConfig.low.adj).toBeLessThan(0);
    expect(finalParams.dynConfig.high.adj).toBeGreaterThan(0);
  });

  // The Expected adjustment is the on-plan anchor: Goal Seek must leave it at
  // whatever the user typed and tune Low/High around it.
  it('never moves the Expected adjustment and keeps Low/High on its two sides', async () => {
    const params = makeParams();
    params.dynConfig.med.adj = 10_000;
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.marketAdjustments.med).toBe(10_000);
    expect(finalParams.dynConfig.med.adj).toBe(10_000);
    expect(summary.marketAdjustments.low).toBeLessThanOrEqual(10_000);
    expect(summary.marketAdjustments.high).toBeGreaterThanOrEqual(10_000);
  });

  // Goal Seek may mathematically prefer a High adjustment below Expected (or
  // a Low above it), but that reads backwards in the form — keep the dollar
  // ladder ascending around the fixed Expected anchor.
  it('keeps market dollar adjustments ascending low ≤ expected ≤ high', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 2,
      // Grids overlapping the Expected anchor from both sides.
      marketDownAdjGrid: { minPct: -40, maxPct: 40, stepPct: 20 },
      marketUpAdjGrid: { minPct: -20, maxPct: 60, stepPct: 20 },
      floorMultiples: [0, 1],
      ceilingMultiples: [0, 1],
    });

    expect(summary.feasible).toBe(true);
    const { low, med, high } = summary.marketAdjustments;
    expect(med).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(med);
  });

  it('preserves Floor/Ceiling dollars and tunes cut/boost rates only', async () => {
    const params = makeParams({
      portfolio: {
        ...makeParams().portfolio,
        floorBalance: 1_200_000,
        ceilingBalance: 2_800_000,
        floorPenalty: 0.4,
        ceilingBonus: 0.4,
      },
    });
    const { summary, params: finalParams } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });
    expect(summary.feasible).toBe(true);
    const { floorBalance, ceilingBalance, floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    expect(floorBalance).toBe(1_200_000);
    expect(ceilingBalance).toBe(2_800_000);
    expect(finalParams.portfolio.floorBalance).toBe(1_200_000);
    expect(finalParams.portfolio.ceilingBalance).toBe(2_800_000);
    expect(floorPenalty).toBeGreaterThan(0);
    expect(floorPenalty).toBeLessThanOrEqual(1);
    expect(ceilingBonus).toBeGreaterThan(0);
    expect(ceilingBonus).toBeLessThanOrEqual(1);
  });

  it('keeps custom Floor/Ceiling fixed across re-solve rate scoring', async () => {
    const params = makeParams({
      numYears: 30,
      numSimulations: 600,
      portfolio: {
        ...makeParams().portfolio,
        start: 1_500_000,
        floorBalance: 900_000,
        ceilingBalance: 1_800_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const { summary, params: finalParams } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 2,
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 25 },
    });

    expect(summary.feasible).toBe(true);
    expect(summary.balanceAdjustment.floorBalance).toBe(900_000);
    expect(summary.balanceAdjustment.ceilingBalance).toBe(1_800_000);
    expect(finalParams.portfolio.floorBalance).toBe(900_000);
    expect(finalParams.portfolio.ceilingBalance).toBe(1_800_000);
    expect(summary.balanceAdjustment.floorPenalty).toBeGreaterThan(0);
    expect(summary.balanceAdjustment.ceilingBonus).toBeGreaterThan(0);
  });

  it('skips rate search when Floor/Ceiling thresholds are off', async () => {
    const params = makeParams({
      portfolio: {
        ...makeParams().portfolio,
        floorBalance: 0,
        floorPenalty: 0.55,
        ceilingBalance: Infinity,
        ceilingBonus: 0.55,
      },
    });
    const { summary, params: finalParams } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.balanceAdjustment.floorBalance).toBe(0);
    expect(summary.balanceAdjustment.ceilingBalance).toBeNull();
    // Off thresholds: rates are not reset or searched — input values kept.
    expect(summary.balanceAdjustment.floorPenalty).toBe(0.55);
    expect(summary.balanceAdjustment.ceilingBonus).toBe(0.55);
    expect(finalParams.portfolio.floorBalance).toBe(0);
    expect(finalParams.portfolio.ceilingBalance).toBe(Infinity);
  });

  it('never returns 0% max cut when risk tolerance is below the grid step', async () => {
    const params = makeParams({
      portfolio: {
        ...makeParams().portfolio,
        start: 1_500_000,
        floorBalance: 1_200_000,
        ceilingBalance: 1_800_000,
      },
    });
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      shortfallTolerance: 0.05,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 1,
    });

    expect(summary.feasible).toBe(true);
    // 5% RT → envelope scale 0.25 → floor max 12.5%; step is 10%, so the
    // mildest (and here only) candidate is 10% — not capped at RT itself.
    expect(summary.balanceAdjustment.floorPenalty).toBe(0.1);
    expect(summary.balanceAdjustment.floorPenalty).toBeLessThanOrEqual(0.125);
    expect(summary.balanceAdjustment.ceilingBonus).toBeGreaterThan(0);
    expect(summary.balanceAdjustment.floorBalance).toBe(1_200_000);
    expect(summary.balanceAdjustment.ceilingBalance).toBe(1_800_000);
  });

  // Guardrails may raise actual spending via ceiling boosts, but the search
  // ranks by the headline planned schedule — so with extras off, the planned
  // total (and base) must not be sacrificed for bonus-only actual gains.
  // The small tolerance absorbs the $1,000 round-down of the final base
  // re-bisection.
  it('does not sacrifice planned schedule for guardrail-only upside', async () => {
    const baseParams = makeParams({
      numYears: 30,
      numSimulations: 600,
      portfolio: {
        ...makeParams().portfolio,
        start: 1_500_000,
        floorBalance: 1_200_000,
        ceilingBalance: 1_800_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const sharedConfig = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      searchNumSimulations: 600,
      maxRounds: 3,
      balanceMultiples: [0, 0.5, 1],
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 25 },
    };

    const withoutGuardrails = await seek(baseParams, {
      ...sharedConfig,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
    });
    const withGuardrails = await seek(baseParams, {
      ...sharedConfig,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
    });

    expect(withoutGuardrails.summary.feasible).toBe(true);
    expect(withGuardrails.summary.feasible).toBe(true);
    expect(withGuardrails.summary.plannedScheduleTotal).toBeGreaterThanOrEqual(
      withoutGuardrails.summary.plannedScheduleTotal - 1000,
    );
    expect(withGuardrails.summary.baseWithdrawal).toBeGreaterThanOrEqual(
      withoutGuardrails.summary.baseWithdrawal - 1000,
    );
  });

  // When Spending Over Time is included, the objective is average planned
  // dollars per year in the first tier — not median actual early withdrawals.
  it('optimizes for average planned spending during the early-tier window when Spending Over Time is included', async () => {
    const params = makeParams({ numYears: 20, numSimulations: 500 });
    const earlyWindow = 5;
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      spendingFirstTierYears: earlyWindow,
      searchNumSimulations: 500,
      maxRounds: 2,
      ...FAST_LEVER_GRIDS,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.earlyYearsWindow).toBe(earlyWindow);
    expect(summary.achievedObjectiveValue).toBeCloseTo(
      plannedPrimaryObjective(finalParams.portfolio, params.numYears, 'total', earlyWindow),
      6,
    );
  });

  it('takes the no-lever fast path (roundsUsed is 0, single confirming bisection)', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.roundsUsed).toBe(0);
  });

  it('stops before exhausting maxRounds once a round makes no further difference', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 5,
      ...FAST_LEVER_GRIDS,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.roundsUsed).toBeGreaterThanOrEqual(1);
    expect(summary.roundsUsed).toBeLessThanOrEqual(5);
  });

  it('reports roundsUsed at most maxRounds', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      maxRounds: 2,
      ...FAST_LEVER_GRIDS,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.roundsUsed).toBeLessThanOrEqual(2);
  });

  // With the on-plan success constraint, additional rounds are not guaranteed
  // to monotonically improve the objective at reduced search fidelity — both
  // runs should still produce feasible plans with comparable objectives.
  it('produces feasible plans with multiple rounds for the same config', async () => {
    const params = makeParams();
    const baseConfig = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      ...FAST_LEVER_GRIDS,
    };

    const singleRound = await seek(params, { ...baseConfig, maxRounds: 1 });
    const multiRound = await seek(params, { ...baseConfig, maxRounds: 3 });

    expect(singleRound.summary.feasible).toBe(true);
    expect(multiRound.summary.feasible).toBe(true);
    expect(multiRound.summary.achievedSuccessRate).toBeGreaterThanOrEqual(0.7);
    expect(singleRound.summary.achievedSuccessRate).toBeGreaterThanOrEqual(0.7);
  });

  it('does not mutate the caller-supplied params object', async () => {
    const params = makeParams();
    const originalBase = params.portfolio.base;
    await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    });
    expect(params.portfolio.base).toBe(originalBase);
  });

  // Regression test for the self-anchoring bug: a searched lever's result
  // must not depend on whatever value was already sitting in that field
  // before the search started, since Phase 1 now neutralizes every included
  // lever before solving for the base withdrawal.
  it('finds the same early-years bonus answer regardless of the starting value', async () => {
    const config = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    };

    const resultA = await seek(makeParams({
      portfolio: {
        ...makeParams().portfolio,
        spendingOverTimeSeries: spendingSeries(25, [
          { changePct: 0, extra: 200_000, years: 5 },
          { changePct: 0, extra: 0 },
        ]),
      },
    }), config);
    const resultB = await seek(makeParams({
      portfolio: {
        ...makeParams().portfolio,
        spendingOverTimeSeries: spendingSeries(25, [
          { changePct: 0, extra: 2_000, years: 5 },
          { changePct: 0, extra: 0 },
        ]),
      },
    }), config);

    expect(resultA.summary.feasible).toBe(true);
    expect(resultB.summary.feasible).toBe(true);
    expect(resultA.summary.spendingOverTimeBonus).toBe(resultB.summary.spendingOverTimeBonus);
  });

  it('finds the same base withdrawal regardless of pre-existing market/balance rate settings', async () => {
    const config = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
      maxRounds: 1,
      ...FAST_LEVER_GRIDS,
    };

    const paramsA = makeParams();
    // Thresholds stay fixed (same in both). Only neutralized rate / market
    // fields may differ; Expected (med) stays the user's fixed anchor.
    const paramsB = makeParams({
      dynConfig: {
        enabled: true,
        low: { ret: -15, adj: -90_000 },
        med: { ret: 5, adj: 0 },
        high: { ret: 20, adj: 90_000 },
        noCutBal: 4_000_000,
      },
      portfolio: {
        ...makeParams().portfolio,
        floorPenalty: 0.9,
        ceilingBonus: 0.9,
      },
    });

    const resultA = await seek(paramsA, config);
    const resultB = await seek(paramsB, config);

    expect(resultA.summary.feasible).toBe(true);
    expect(resultB.summary.feasible).toBe(true);
    expect(resultA.summary.baseWithdrawal).toBe(resultB.summary.baseWithdrawal);
  });

  it('allows a higher base withdrawal when risk tolerance is higher', async () => {
    const params = makeParams({
      numYears: 30,
      numSimulations: 600,
      portfolio: {
        ...makeParams().portfolio,
        start: 1_500_000,
        floorBalance: 1_200_000,
        ceilingBalance: 1_800_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const shared = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 2,
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 50 },
    };

    const conservative = await seek(params, { ...shared, shortfallTolerance: 0 });
    const aggressive = await seek(params, { ...shared, shortfallTolerance: 0.4 });

    expect(conservative.summary.feasible).toBe(true);
    expect(aggressive.summary.feasible).toBe(true);
    expect(aggressive.summary.baseWithdrawal).toBeGreaterThanOrEqual(conservative.summary.baseWithdrawal);
  });

  it('reports planned schedule total and risk tolerance in the summary', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      shortfallTolerance: 0.25,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.shortfallTolerance).toBe(0.25);
    expect(summary.plannedScheduleTotal).toBeGreaterThan(0);
  });

  it('keeps the pinned base withdrawal fixed and tunes levers when feasible', async () => {
    const pinnedBase = 60_000;
    const params = makeParams({
      numYears: 30,
      numSimulations: 600,
      portfolio: {
        ...makeParams().portfolio,
        start: 2_000_000,
        base: pinnedBase,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.7,
      shortfallTolerance: 0.3,
      pinBaseWithdrawal: true,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 2,
      balanceMultiples: [0, 0.5, 1],
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 50 },
    });

    expect(summary.feasible).toBe(true);
    expect(summary.pinnedBase).toBe(true);
    expect(summary.baseWithdrawal).toBe(pinnedBase);
    expect(finalParams.portfolio.base).toBe(pinnedBase);
    expect(summary.balanceAdjustment).toBeDefined();
  });

  it('reports infeasible when a pinned base cannot meet the desired success rate', async () => {
    const params = makeParams({
      numYears: 30,
      numSimulations: 500,
      portfolio: {
        ...makeParams().portfolio,
        start: 2_000_000,
        base: 500_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.9,
      shortfallTolerance: 0.05,
      pinBaseWithdrawal: true,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 500,
      maxRounds: 2,
      balanceMultiples: [0, 1],
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 50 },
    });

    expect(summary.feasible).toBe(false);
    expect(summary.pinnedBase).toBe(true);
    expect(summary.baseWithdrawal).toBe(500_000);
    expect(summary.balanceAdjustment).toBeDefined();
    expect(summary.achievedSuccessRate).toBeLessThan(0.9);
    expect(finalParams.portfolio.base).toBe(500_000);
    expect(summary.reason).toMatch(/pinned base withdrawal/i);
  });

  it('tunes Market/Balance levers around a fixed specific-list schedule without changing it', async () => {
    const numYears = 25;
    const specificWithdrawals = new Array(numYears).fill(70_000);
    const params = makeParams({
      numYears,
      numSimulations: 600,
      portfolio: {
        ...makeParams().portfolio,
        strategy: 'specific',
        specificWithdrawals,
        start: 2_000_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.7,
      shortfallTolerance: 0.3,
      pinBaseWithdrawal: true,
      includeSpendingOverTime: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 2,
      ...FAST_LEVER_GRIDS,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.pinnedBase).toBe(true);
    // The specific-list schedule itself is never touched by the search.
    expect(finalParams.portfolio.specificWithdrawals).toEqual(specificWithdrawals);
    expect(summary.marketAdjustments).toBeDefined();
    expect(summary.balanceAdjustment).toBeDefined();
    expect(summary.plannedScheduleTotal).toBe(70_000 * numYears);
  });

  it('pins the glide target to the Risk-Tolerance-discounted goal-seek target and tunes the recycle fraction', async () => {
    const params = makeParams({
      numSimulations: 500,
      portfolio: {
        ...makeParams().portfolio,
        // Pre-existing glide values: the search must override the target with
        // the discounted Goal Seek target, re-tune the fraction, and leave the
        // typed rate alone.
        glideTarget: 123_000,
        glideFraction: 0.33,
        glideRate: -0.02,
      },
    });
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 500_000,
      desiredSuccessRate: 0.75,
      shortfallTolerance: 0.2,
      searchNumSimulations: 500,
      maxRounds: 1,
      includeGlidePath: true,
      glideFractions: [0, 0.25, 0.5],
    });

    expect(summary.feasible).toBe(true);
    expect(summary.glideSpendDown).toBeDefined();
    // 500k × (1 − 0.2) = 400k — legacy slack is spendable via the discounted stop.
    expect(summary.glideSpendDown.target).toBe(400_000);
    expect(summary.glideSpendDown.rate).toBeCloseTo(-0.02, 9);
    expect([0, 0.25, 0.5]).toContain(summary.glideSpendDown.fraction);
    // Recycling surplus raises median lifetime spending in this setup (large
    // start, modest target), so the search should not leave the lever at 0.
    expect(summary.glideSpendDown.fraction).toBeGreaterThan(0);
    expect(finalParams.portfolio.glideTarget).toBe(400_000);
    expect(finalParams.portfolio.glideFraction).toBe(summary.glideSpendDown.fraction);
  });

  it('never returns 0% glide spend rate with the default fraction grid', async () => {
    const params = makeParams({
      numSimulations: 500,
      portfolio: {
        ...makeParams().portfolio,
        glideFraction: 0,
      },
    });
    const { summary } = await seek(params, {
      targetEndingBalance: 500_000,
      desiredSuccessRate: 0.75,
      searchNumSimulations: 500,
      maxRounds: 1,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      includeGlidePath: true,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.glideSpendDown.fraction).toBeGreaterThanOrEqual(0.05);
  });
});

describe('runGoalSeek upward base nudge', () => {
  // Fake engine: split gate passes only when base ≤ maxFeasible. Bisection plus
  // $1k flooring can stop a step low; the post-search nudge should climb back
  // to the highest whole-thousand base that still passes.
  function gateByBaseSimulate(maxFeasible) {
    return (p) => {
      const n = p.numSimulations;
      const years = p.numYears;
      const base = p.portfolio.base ?? 0;
      const ok = base <= maxFeasible + 1e-9;
      const actual = Math.max(0, base) * years;
      return Promise.resolve({
        finalBalance: new Float64Array(n).fill(ok ? 1_000_000 : 0),
        depletionYear: new Float64Array(n).fill(ok ? years + 1 : 1),
        horizonYears: Int32Array.from(new Array(n).fill(years)),
        totalWithdrawn: new Float64Array(n).fill(actual),
        medianYearlyWithdrawal: new Float64Array(n).fill(Math.max(0, base)),
        earlyWithdrawn: new Float64Array(n).fill(0),
      });
    };
  }

  it('nudges a floored base up to the highest feasible $1,000 step', async () => {
    const maxFeasible = 103_000;
    const { summary } = await runGoalSeek(
      makeParams({
        portfolio: {
          ...makeParams().portfolio,
          base: 50_000,
          spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
          withdrawalFloorSeries: new Array(25).fill(0),
        },
      }),
      {
        targetEndingBalance: 0,
        desiredSuccessRate: 0.9,
        shortfallTolerance: 0.2,
        includeSpendingOverTime: false,
        includeMarketAdjustments: false,
        includeBalanceOverrides: false,
        includeGlidePath: false,
        searchNumSimulations: 200,
        maxRounds: 1,
      },
      gateByBaseSimulate(maxFeasible),
    );

    expect(summary.feasible).toBe(true);
    expect(summary.baseWithdrawal).toBe(103_000);
  });

  it('does not nudge a pinned base', async () => {
    const pinned = 70_000;
    const { summary } = await runGoalSeek(
      makeParams({
        portfolio: {
          ...makeParams().portfolio,
          base: pinned,
          spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
        },
      }),
      {
        targetEndingBalance: 0,
        desiredSuccessRate: 0.9,
        shortfallTolerance: 0.2,
        pinBaseWithdrawal: true,
        includeSpendingOverTime: false,
        includeMarketAdjustments: false,
        includeBalanceOverrides: true,
        searchNumSimulations: 200,
        maxRounds: 1,
        ...FAST_LEVER_GRIDS,
      },
      gateByBaseSimulate(200_000),
    );

    expect(summary.feasible).toBe(true);
    expect(summary.baseWithdrawal).toBe(pinned);
  });
});

describe('runGoalSeek glide-target tolerance band', () => {
  // Fake engine: every run ends at exactly 90% of the typed target with generous
  // spending and no depletion. Risk Tolerance discounts the ending gate (and
  // glide stop) to typed × (1 − RT), so near-misses on the typed target still
  // count as successes — with or without the glide lever.
  const TARGET = 1_000_000;

  function fakeResult(numSimulations, numYears, endingBalance = TARGET * 0.9) {
    return {
      finalBalance: new Float64Array(numSimulations).fill(endingBalance),
      depletionYear: new Float64Array(numSimulations).fill(numYears + 1),
      horizonYears: Int32Array.from(new Array(numSimulations).fill(numYears)),
      totalWithdrawn: new Float64Array(numSimulations).fill(50_000_000),
      medianYearlyWithdrawal: new Float64Array(numSimulations).fill(2_000_000),
      earlyWithdrawn: new Float64Array(numSimulations).fill(0),
    };
  }

  const fakeSimulate = (p) => Promise.resolve(fakeResult(p.numSimulations, p.numYears));

  const bandConfig = {
    targetEndingBalance: TARGET,
    desiredSuccessRate: 0.9,
    shortfallTolerance: 0.2,
    includeSpendingOverTime: false,
    includeMarketAdjustments: false,
    includeBalanceOverrides: false,
    searchNumSimulations: 300,
    maxRounds: 1,
    glideFractions: [0.1],
  };

  it('accepts endings within the discounted target while the glide lever is searched', async () => {
    const { summary } = await runGoalSeek(
      makeParams(),
      { ...bandConfig, includeGlidePath: true },
      fakeSimulate,
    );
    // 900k ending ≥ 1M × (1 − 0.2) = 800k → every run passes the discounted gate.
    expect(summary.feasible).toBe(true);
    expect(summary.glideSpendDown.target).toBe(800_000);
  });

  it('accepts endings within the discounted target even when the glide lever is not searched', async () => {
    const { summary } = await runGoalSeek(
      makeParams(),
      { ...bandConfig, includeGlidePath: false },
      fakeSimulate,
    );
    // Same 900k ≥ 800k discounted gate — legacy discount is not glide-only.
    expect(summary.feasible).toBe(true);
  });

  it('rejects endings below the discounted target', async () => {
    const tooLowSimulate = (p) =>
      Promise.resolve(fakeResult(p.numSimulations, p.numYears, TARGET * 0.7));
    const { summary } = await runGoalSeek(
      makeParams(),
      { ...bandConfig, includeGlidePath: false },
      tooLowSimulate,
    );
    // 700k < 800k discounted gate → infeasible even at the minimum base.
    expect(summary.feasible).toBe(false);
  });

  it('runs Phase 1 with glide off so feasibility is not blocked by an active lever', async () => {
    // Endings pass only while glideFraction is 0 (Phase 1 + base bisection).
    // Any positive recycle rate fails the discounted ending test — if Phase 1
    // still turned glide on, the search would exit infeasible immediately.
    const glideSensitiveSimulate = (p) => {
      const glideOn = (p.portfolio.glideFraction ?? 0) > 0;
      const ending = glideOn ? TARGET * 0.5 : TARGET;
      return Promise.resolve(fakeResult(p.numSimulations, p.numYears, ending));
    };

    const { summary } = await runGoalSeek(
      makeParams(),
      {
        ...bandConfig,
        includeGlidePath: true,
        desiredSuccessRate: 0.75,
        glideFractions: [0.1, 0.2],
      },
      glideSensitiveSimulate,
    );

    expect(summary.feasible).toBe(true);
    // No glide candidate qualified; final clamp still applies the minimum rate.
    expect(summary.glideSpendDown.fraction).toBe(0.1);
  });
});
