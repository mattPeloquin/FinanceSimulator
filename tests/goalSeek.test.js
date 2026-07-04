import { describe, it, expect } from 'vitest';
import {
  bisectMaxSatisfying,
  bisectMaxSatisfyingInt,
  buildAdjustmentGrid,
  buildBalanceGrid,
  buildFractionGrid,
  runGoalSeek,
} from '../src/core/goalSeek.js';

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
      spendChangeRate: 0,
      goGoBonus: 20_000,
      goGoYears: 5,
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

describe('runGoalSeek', () => {
  it('finds a base withdrawal achieving roughly the desired success rate', () => {
    const params = makeParams();
    const { params: finalParams, summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
    });

    expect(summary.feasible).toBe(true);
    expect(finalParams.numSimulations).toBe(params.numSimulations);
    // Achieved success rate should be close to (at least near) the target,
    // since bisection converges on the boundary from the feasible side.
    expect(summary.achievedSuccessRate).toBeGreaterThanOrEqual(0.7);
    expect(summary.baseWithdrawal).toBeGreaterThan(0);
  });

  it('reports infeasible when even a $0 withdrawal cannot hit the target', () => {
    const params = makeParams({ portfolio: { ...makeParams().portfolio, start: 1000 } });
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 50_000_000, // unreachable from a $1000 starting balance
      desiredSuccessRate: 0.9,
      includeGoGoYears: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 300,
    });
    expect(summary.feasible).toBe(false);
  });

  it('returns dollar values rounded to whole $1,000, never fractional', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 400,
    });

    expect(summary.feasible).toBe(true);
    expect(summary.baseWithdrawal % 1000 === 0).toBe(true);
    expect(Number.isInteger(summary.goGoYears)).toBe(true);
    for (const value of Object.values(summary.marketAdjustments)) {
      expect(value % 1000 === 0).toBe(true);
    }
    for (const value of Object.values(summary.marketBalanceOverrides)) {
      expect(value === null || value % 1000 === 0).toBe(true);
    }
    expect(summary.balanceAdjustment.floorBalance % 1000 === 0).toBe(true);
    expect(
      summary.balanceAdjustment.ceilingBalance === null || summary.balanceAdjustment.ceilingBalance % 1000 === 0,
    ).toBe(true);
  });

  it('optionally tunes bonus years alongside the base withdrawal', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 500,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.goGoYears).toBeGreaterThanOrEqual(0);
    expect(summary.goGoYears).toBeLessThanOrEqual(params.numYears);
  });

  it('tunes market adjustments and their balance override thresholds together', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: false,
      searchNumSimulations: 500,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.marketAdjustments).toHaveProperty('low');
    expect(summary.marketAdjustments).toHaveProperty('med');
    expect(summary.marketAdjustments).toHaveProperty('high');
    expect(summary.marketBalanceOverrides).toHaveProperty('low');
    expect(summary.marketBalanceOverrides).toHaveProperty('med');
    expect(summary.marketBalanceOverrides).toHaveProperty('high');
  });

  it('tunes floor/ceiling balance and their cut/boost rates together', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: true,
      searchNumSimulations: 500,
    });
    expect(summary.feasible).toBe(true);
    const { floorBalance, ceilingBalance, floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    expect(floorBalance).toBeGreaterThanOrEqual(0);
    expect(ceilingBalance === null || ceilingBalance > 0).toBe(true);
    expect(floorPenalty).toBeGreaterThanOrEqual(0);
    expect(floorPenalty).toBeLessThanOrEqual(1);
    expect(ceilingBonus).toBeGreaterThanOrEqual(0);
    expect(ceilingBonus).toBeLessThanOrEqual(1);
  });

  it('takes the no-lever fast path (roundsUsed is 0, single confirming bisection)', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: false,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 800,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.roundsUsed).toBe(0);
  });

  it('stops before exhausting maxRounds once a round makes no further difference', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 400,
      maxRounds: 5,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.roundsUsed).toBeGreaterThanOrEqual(1);
    expect(summary.roundsUsed).toBeLessThan(5);
  });

  it('reports roundsUsed at most maxRounds', () => {
    const params = makeParams();
    const { summary } = runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 400,
      maxRounds: 2,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.roundsUsed).toBeLessThanOrEqual(2);
  });

  // Regression test for the "everything zeroed" local-optimum problem: solving
  // the base withdrawal to its absolute max before any lever is considered
  // leaves no slack for a single lever-tuning pass to use. Additional rounds
  // must never do worse than fewer rounds, since a later round can always
  // fall back to reproducing the previous round's choices.
  it('never does worse with more rounds than with fewer, for the same config', () => {
    const params = makeParams();
    const baseConfig = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 500,
    };

    const singleRound = runGoalSeek(params, { ...baseConfig, maxRounds: 1 });
    const multiRound = runGoalSeek(params, { ...baseConfig, maxRounds: 3 });

    expect(singleRound.summary.feasible).toBe(true);
    expect(multiRound.summary.feasible).toBe(true);
    expect(multiRound.summary.achievedMedianTotalWithdrawn).toBeGreaterThanOrEqual(
      singleRound.summary.achievedMedianTotalWithdrawn,
    );
  });

  it('does not mutate the caller-supplied params object', () => {
    const params = makeParams();
    const originalBase = params.portfolio.base;
    runGoalSeek(params, {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 300,
    });
    expect(params.portfolio.base).toBe(originalBase);
  });

  // Regression test for the self-anchoring bug: a searched lever's result
  // must not depend on whatever value was already sitting in that field
  // before the search started, since Phase 1 now neutralizes every included
  // lever before solving for the base withdrawal.
  it('finds the same bonus-years answer regardless of the starting value', () => {
    const config = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: true,
      includeMarketAdjustments: false,
      includeBalanceOverrides: false,
      searchNumSimulations: 500,
    };

    const resultA = runGoalSeek(makeParams({ portfolio: { ...makeParams().portfolio, goGoYears: 20 } }), config);
    const resultB = runGoalSeek(makeParams({ portfolio: { ...makeParams().portfolio, goGoYears: 2 } }), config);

    expect(resultA.summary.feasible).toBe(true);
    expect(resultB.summary.feasible).toBe(true);
    expect(resultA.summary.goGoYears).toBe(resultB.summary.goGoYears);
  });

  it('finds the same base withdrawal regardless of pre-existing market/balance settings', () => {
    const config = {
      targetEndingBalance: 0,
      desiredSuccessRate: 0.8,
      includeGoGoYears: false,
      includeMarketAdjustments: true,
      includeBalanceOverrides: true,
      searchNumSimulations: 500,
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

    const resultA = runGoalSeek(paramsA, config);
    const resultB = runGoalSeek(paramsB, config);

    expect(resultA.summary.feasible).toBe(true);
    expect(resultB.summary.feasible).toBe(true);
    expect(resultA.summary.baseWithdrawal).toBe(resultB.summary.baseWithdrawal);
  });
});
