import { describe, it, expect } from 'vitest';
import { runMonteCarlo } from '../src/core/simulation.js';
import { stitchMonteCarloResults } from '../src/workers/parallelPool.js';

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

function lognormalParams(overrides = {}) {
  return {
    numYears: 30,
    numSimulations: 200,
    seed: 42,
    distMethod: 'lognormal',
    blockSize: 1,
    allocation: baseAllocation,
    logNormal: logNormalProfiles,
    portfolio: {
      start: 4_000_000,
      base: 80_000,
      floorBalance: 2_000_000,
      floorPenalty: 0.5,
      ceilingBalance: 5_000_000,
      ceilingBonus: 0.5,
    },
    dynConfig: {
      enabled: false,
      low: { ret: -15, bal: null, adj: 0 },
      med: { ret: 5, bal: null, adj: 0 },
      high: { ret: 20, bal: null, adj: 0 },
    },
    samples: null,
    ...overrides,
  };
}

describe('stitchMonteCarloResults', () => {
  it('stitches horizonYears from parallel chunks', () => {
    const params = lognormalParams({ numSimulations: 200, seed: 99 });
    const chunkA = runMonteCarlo({ ...params, numSimulations: 80 }, { startIndex: 0 });
    const chunkB = runMonteCarlo({ ...params, numSimulations: 120 }, { startIndex: 80 });

    const stitched = stitchMonteCarloResults(params, [
      { startIndex: 0, numSimulations: 80, ...chunkA },
      { startIndex: 80, numSimulations: 120, ...chunkB },
    ]);

    expect(stitched.horizonYears).toBeInstanceOf(Int32Array);
    expect(stitched.horizonYears.length).toBe(200);
    expect(Array.from(stitched.horizonYears.slice(0, 80))).toEqual(Array.from(chunkA.horizonYears));
    expect(Array.from(stitched.horizonYears.slice(80))).toEqual(Array.from(chunkB.horizonYears));
  });

  it('stitches allYearsWithdrawals identical to a single-shot run', () => {
    const params = lognormalParams({ numSimulations: 200, seed: 99 });
    const single = runMonteCarlo(params);
    const chunkA = runMonteCarlo({ ...params, numSimulations: 80 }, { startIndex: 0 });
    const chunkB = runMonteCarlo({ ...params, numSimulations: 120 }, { startIndex: 80 });

    const stitched = stitchMonteCarloResults(params, [
      { startIndex: 0, numSimulations: 80, ...chunkA },
      { startIndex: 80, numSimulations: 120, ...chunkB },
    ]);

    expect(stitched.allYearsWithdrawals.length).toBe(single.allYearsWithdrawals.length);
    expect(Array.from(stitched.allYearsWithdrawals)).toEqual(Array.from(single.allYearsWithdrawals));
  });
});
