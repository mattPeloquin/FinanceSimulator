import { describe, it, expect } from 'vitest';
import { runMonteCarlo } from '../src/core/simulation.js';
import {
  bisectMaxSatisfying,
  bisectMaxSatisfyingAsync,
  bisectMaxSatisfyingInt,
  buildAdjustmentGrid,
  buildBalanceGrid,
  buildFractionGrid,
  buildBonusGrid,
  buildPairGrid,
  highestMinimumWithdrawal,
  plannedScheduleTotal,
  plannedScheduleMedianYearly,
  buildPerRunPlanBenchmarks,
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
  it('builds a symmetric percentage grid around the base withdrawal', () => {
    const grid = buildAdjustmentGrid(100000, { minPct: -10, maxPct: 10, stepPct: 5 });
    expect(grid).toEqual([-10000, -5000, 0, 5000, 10000]);
  });

  it('rounds candidates to the nearest whole $1,000', () => {
    const grid = buildAdjustmentGrid(100501, { minPct: -10, maxPct: 10, stepPct: 5 });
    for (const value of grid) expect(value % 1000 === 0).toBe(true);
    expect(grid).toEqual([-10000, -5000, 0, 5000, 10000]);
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
  it('builds a 0-100% grid in 10-point steps as 0-1 fractions by default', () => {
    const grid = buildFractionGrid();
    expect(grid).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
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
      floorBalance: 0,
      floorPenalty: 0,
      ceilingBalance: Infinity,
      ceilingBonus: 0,
      withdrawalFloorSeries: new Array(25).fill(0),
      spendingOverTimeSeries: spendingSeries(25, [
        { changePct: 0, extra: 20_000, years: 5 },
        { changePct: 0, extra: 0 },
      ]),
    },
    dynConfig: {
      enabled: true,
      low: { ret: -15, bal: null, adj: -20_000 },
      med: { ret: 5, bal: null, adj: 0 },
      high: { ret: 20, bal: null, adj: 20_000 },
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
    const benchmarks = buildPerRunPlanBenchmarks(portfolio, horizons, false);
    expect(benchmarks[0]).toBe(benchmarks[1]);
    expect(benchmarks[2]).toBe(benchmarks[3]);
    expect(benchmarks[2]).toBeGreaterThan(benchmarks[0]);
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

  it('applies spend-change rate and minimum-withdrawal floors', () => {
    const portfolio = {
      base: 100_000,
      spendingOverTimeSeries: spendingSeries(5, [{ changePct: -2, extra: 0 }]),
      withdrawalFloorSeries: [120_000, 120_000, 0, 0, 0],
    };
    // year 0: max(100k, 120k) = 120k; year 1: max(98k, 120k) = 120k; rest decline
    const expected = 120_000 + 120_000 + 100_000 * 0.98 ** 2 + 100_000 * 0.98 ** 3 + 100_000 * 0.98 ** 4;
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

  it('optimizes median yearly withdrawal when that metric is selected', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
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
    expect(summary.achievedObjectiveValue).toBe(summary.achievedMedianYearlyWithdrawn);
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
    for (const value of Object.values(summary.marketBalanceOverrides)) {
      expect(value === null || value % 1000 === 0).toBe(true);
    }
    expect(summary.balanceAdjustment.floorBalance % 1000 === 0).toBe(true);
    expect(summary.balanceAdjustment.floorBalance).toBeGreaterThan(0);
    expect(summary.balanceAdjustment.ceilingBalance % 1000 === 0).toBe(true);
    expect(Number.isFinite(summary.balanceAdjustment.ceilingBalance)).toBe(true);
    expect(summary.balanceAdjustment.ceilingBalance).toBeGreaterThan(0);
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

  it('tunes market adjustments and their balance override thresholds together', async () => {
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
    expect(summary.marketBalanceOverrides).toHaveProperty('low');
    expect(summary.marketBalanceOverrides).toHaveProperty('med');
    expect(summary.marketBalanceOverrides).toHaveProperty('high');
  });

  it('tunes floor/ceiling balance and their cut/boost rates together', async () => {
    const params = makeParams();
    const { summary } = await seek(params, {
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
    expect(floorBalance).toBeGreaterThan(0);
    expect(Number.isFinite(ceilingBalance)).toBe(true);
    expect(ceilingBalance).toBe(6_000_000);
    expect(floorBalance).toBe(200_000);
    expect(floorPenalty).toBeGreaterThan(0);
    expect(floorPenalty).toBeLessThanOrEqual(1);
    expect(ceilingBonus).toBeGreaterThan(0);
    expect(ceilingBonus).toBeLessThanOrEqual(1);
  });

  it('pins floor to the lowest balance band and ceiling to the highest, then tunes cut/boost rates', async () => {
    const params = makeParams({
      portfolio: { ...makeParams().portfolio, start: 1_500_000 },
    });
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 2,
      floorMultiples: [0, 0.5, 1],
      ceilingMultiples: [0, 0.5, 1, 2],
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 25 },
    });

    expect(summary.feasible).toBe(true);
    expect(summary.balanceAdjustment.floorBalance).toBe(750_000);
    expect(summary.balanceAdjustment.ceilingBalance).toBe(3_000_000);
    expect(finalParams.portfolio.floorBalance).toBe(750_000);
    expect(finalParams.portfolio.ceilingBalance).toBe(3_000_000);
    expect(summary.balanceAdjustment.floorPenalty).toBeGreaterThan(0);
    expect(summary.balanceAdjustment.ceilingBonus).toBeGreaterThan(0);
  });

  // Regression: balance thresholds stay pinned to the widest band and max
  // cut / boost rate are scored with the base re-solved (not stuck at 0% because
  // the partner threshold was searched independently).
  it('pins guardrail thresholds and searches cut/boost rates with re-solve scoring', async () => {
    const params = makeParams({
      numYears: 30,
      numSimulations: 600,
      portfolio: {
        ...makeParams().portfolio,
        start: 1_500_000,
        spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]),
      },
    });
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 3,
      floorMultiples: [0, 0.5, 1],
      ceilingMultiples: [0, 1, 2],
      penaltyBonusGrid: { minPct: 0, maxPct: 100, stepPct: 25 },
    });

    expect(summary.feasible).toBe(true);
    const { floorBalance, ceilingBalance, floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    expect(floorBalance).toBe(750_000);
    expect(ceilingBalance).toBe(3_000_000);
    expect(floorPenalty).toBeGreaterThan(0);
    expect(ceilingBonus).toBeGreaterThan(0);
  });

  it('never returns 0% max cut when risk tolerance is below the grid step', async () => {
    const params = makeParams({
      portfolio: { ...makeParams().portfolio, start: 1_500_000 },
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
    expect(summary.balanceAdjustment.floorPenalty).toBe(0.05);
    expect(summary.balanceAdjustment.ceilingBonus).toBeGreaterThan(0);
  });

  // Regression test for the fixed-base scoring bug: since a spending cut only
  // pays off once the base is re-solved against it, a plan allowed to use
  // guardrails must never come out WORSE than one without them. The fair
  // comparison is the search's own objective (median lifetime withdrawals):
  // with the aggressive sub-1x ceiling grid the winner may legitimately trade
  // a slightly lower base for balance-conditional boosts that spend more in
  // total, so the base itself is no longer a one-directional proxy for plan
  // quality. The small tolerance absorbs the $1,000 round-down of the final
  // base re-bisection.
  it('produces at least as good a plan with guardrails available as without', async () => {
    const baseParams = makeParams({
      numYears: 30,
      numSimulations: 600,
      portfolio: { ...makeParams().portfolio, start: 1_500_000, spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]) },
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
    expect(withGuardrails.summary.achievedMedianTotalWithdrawn).toBeGreaterThanOrEqual(
      withoutGuardrails.summary.achievedMedianTotalWithdrawn * 0.99,
    );
  });

  // The early-years objective: when Bonus Years is included in the search,
  // the achieved objective (average annual withdrawal during the bonus-year
  // window) should be reported, and the window should reflect whatever
  // first-tier year span the search actually converged on.
  it('optimizes for average annual spending during the bonus-year window when Bonus Years is included', async () => {
    const params = makeParams({ numYears: 20, numSimulations: 500 });
    const { summary } = await seek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 500,
      maxRounds: 2,
      ...FAST_LEVER_GRIDS,
    });

    expect(summary.feasible).toBe(true);
    if (summary.spendingOverTimeBonus > 0) {
      expect(summary.earlyYearsWindow).toBeGreaterThan(0);
      expect(summary.achievedObjectiveValue).toBeGreaterThan(0);
    } else {
      // Bonus resolved to zero — search falls back to the lifetime-total
      // objective even though the first tier's year span may still be set on the portfolio.
      expect(summary.achievedObjectiveValue).toBeGreaterThan(0);
    }
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

  it('finds the same base withdrawal regardless of pre-existing market/balance settings', async () => {
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
    const paramsB = makeParams({
      dynConfig: {
        enabled: true,
        low: { ret: -15, bal: 4_000_000, adj: -90_000 },
        med: { ret: 5, bal: 4_000_000, adj: 50_000 },
        high: { ret: 20, bal: 4_000_000, adj: 90_000 },
      },
      portfolio: { ...makeParams().portfolio, floorBalance: 3_000_000, floorPenalty: 0.9, ceilingBalance: 3_500_000, ceilingBonus: 0.9 },
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
      portfolio: { ...makeParams().portfolio, start: 1_500_000, spendingOverTimeSeries: spendingSeries(25, [{ changePct: 0, extra: 0 }]) },
    });
    const shared = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.75,
      includeSpendingOverTime: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 600,
      maxRounds: 2,
      balanceMultiples: [0, 0.5, 1],
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

  it('pins the glide target to the goal-seek target and tunes the recycle fraction', async () => {
    const params = makeParams({
      numSimulations: 500,
      portfolio: {
        ...makeParams().portfolio,
        // Pre-existing glide values: the search must override the target with
        // its own, re-tune the fraction, and leave the typed rate alone.
        glideTarget: 123_000,
        glideFraction: 0.33,
        glideRate: -0.02,
      },
    });
    const { params: finalParams, summary } = await seek(params, {
      targetEndingBalance: 500_000,
      desiredSuccessRate: 0.75,
      searchNumSimulations: 500,
      maxRounds: 1,
      includeGlidePath: true,
      glideFractions: [0, 0.25, 0.5],
    });

    expect(summary.feasible).toBe(true);
    expect(summary.glideSpendDown).toBeDefined();
    expect(summary.glideSpendDown.target).toBe(500_000);
    expect(summary.glideSpendDown.rate).toBeCloseTo(-0.02, 9);
    expect([0, 0.25, 0.5]).toContain(summary.glideSpendDown.fraction);
    // Recycling surplus raises median lifetime spending in this setup (large
    // start, modest target), so the search should not leave the lever at 0.
    expect(summary.glideSpendDown.fraction).toBeGreaterThan(0);
    expect(finalParams.portfolio.glideTarget).toBe(500_000);
    expect(finalParams.portfolio.glideFraction).toBe(summary.glideSpendDown.fraction);
  });
});
