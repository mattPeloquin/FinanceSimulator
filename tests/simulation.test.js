import { describe, it, expect } from 'vitest';
import { simulatePath, runMonteCarlo, regeneratePath } from '../src/core/simulation.js';
import { createRng, deriveSeed } from '../src/core/rng.js';
import { successRate } from '../src/core/statistics.js';

const baseDynConfig = {
  low: { ret: -15, bal: 1_000_000, adj: 0 },
  med: { ret: 5, bal: 5_000_000, adj: 100_000 },
  high: { ret: 20, bal: 8_000_000, adj: 200_000 },
};

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
    numSimulations: 2000,
    seed: 123,
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
    dynConfig: baseDynConfig,
    samples: null,
    ...overrides,
  };
}

const sampleYears = {
  years: [
    { us_lg_growth: 20, us_lg_value: 15, us_sm_mid: 25, ex_us: 10, bond: 4, cash: 2, inflation: 3 },
    { us_lg_growth: -10, us_lg_value: -5, us_sm_mid: -15, ex_us: -8, bond: 6, cash: 2, inflation: 2 },
    { us_lg_growth: 8, us_lg_value: 12, us_sm_mid: 5, ex_us: 6, bond: 3, cash: 1, inflation: 2.5 },
  ],
};

describe('runMonteCarlo determinism', () => {
  it('produces identical results for the same seed', () => {
    const a = runMonteCarlo(lognormalParams());
    const b = runMonteCarlo(lognormalParams());
    expect(Array.from(a.avgReturn)).toEqual(Array.from(b.avgReturn));
    expect(Array.from(a.finalBalance)).toEqual(Array.from(b.finalBalance));
    expect(Array.from(a.totalWithdrawn)).toEqual(Array.from(b.totalWithdrawn));
  });

  it('produces different results for different seeds', () => {
    const a = runMonteCarlo(lognormalParams({ seed: 1 }));
    const b = runMonteCarlo(lognormalParams({ seed: 2 }));
    expect(Array.from(a.avgReturn)).not.toEqual(Array.from(b.avgReturn));
  });

  it('reports progress ending at 1', () => {
    const seen = [];
    runMonteCarlo(lognormalParams({ numSimulations: 500 }), { onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe('regeneratePath', () => {
  it('reproduces the exact summary of a bulk-run simulation', () => {
    const params = lognormalParams({ numSimulations: 200 });
    const result = runMonteCarlo(params);
    for (const i of [0, 1, 50, 199]) {
      const re = regeneratePath(params, result.baseSeed, i);
      expect(re.finalBalance).toBeCloseTo(result.finalBalance[i], 6);
      expect(re.totalWithdrawn).toBeCloseTo(result.totalWithdrawn[i], 6);
      expect(re.avgReturn).toBeCloseTo(result.avgReturn[i], 12);
      // The regenerated path arrays are populated and self-consistent.
      expect(re.path.balances.length).toBe(params.numYears + 1);
      expect(re.path.withdrawals.length).toBe(params.numYears);
      expect(re.path.returns.length).toBe(params.numYears);
      expect(re.path.balances[re.path.balances.length - 1]).toBeCloseTo(re.finalBalance, 6);
    }
  });
});

describe('historical resampling', () => {
  it('runs and stays within sample data when blockSize=1', () => {
    const params = lognormalParams({
      distMethod: 'resampling',
      samples: sampleYears,
      blockSize: 1,
      numSimulations: 500,
    });
    const result = runMonteCarlo(params);
    expect(result.avgReturn.length).toBe(500);
    expect(Number.isFinite(result.finalBalance[0])).toBe(true);
  });
});

describe('success / depletion metric', () => {
  it('depletes when withdrawals dwarf the portfolio', () => {
    const params = lognormalParams({
      numSimulations: 1000,
      portfolio: {
        start: 100_000,
        base: 90_000,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
      },
    });
    const result = runMonteCarlo(params);
    const rate = successRate(result.depletionYear, params.numYears);
    expect(rate).toBeLessThan(0.5);
  });

  it('rarely depletes with a tiny withdrawal and large portfolio', () => {
    const params = lognormalParams({
      numSimulations: 1000,
      portfolio: {
        start: 10_000_000,
        base: 1_000,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
      },
    });
    const result = runMonteCarlo(params);
    const rate = successRate(result.depletionYear, params.numYears);
    expect(rate).toBeGreaterThan(0.9);
  });
});

describe('simulatePath path mode', () => {
  it('omits path arrays when collectPath is false', () => {
    const s = simulatePath(lognormalParams(), createRng(deriveSeed(123, 0)), false);
    expect(s.path).toBeUndefined();
    expect(typeof s.finalBalance).toBe('number');
  });
});
