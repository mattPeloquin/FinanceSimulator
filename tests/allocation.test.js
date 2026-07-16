import { describe, it, expect } from 'vitest';
import {
  buildAllocationOverTimeSeries,
  ALLOCATION_ENGINE_KEYS,
  renormalizeAllocation,
} from '../src/core/allocation.js';
import { ALLOCATION_KEYS } from '../src/state/scenario.js';
import { simulatePath } from '../src/core/simulation.js';
import { createRng } from '../src/core/rng.js';

const start = {
  usLgGrowth: 0.5,
  usLgValue: 0.5,
  usSmMid: 0,
  exUs: 0,
  bond: 0,
  cash: 0,
};

const allBondsTier = {
  usLgGrowthAllocation: 0,
  usLgValueAllocation: 0,
  usSmMidAllocation: 0,
  exUsAllocation: 0,
  bondAllocation: 100,
  cashAllocation: 0,
};

function sumWeights(mix) {
  return ALLOCATION_ENGINE_KEYS.reduce((s, k) => s + (mix[k] || 0), 0);
}

describe('buildAllocationOverTimeSeries', () => {
  it('returns a constant copy of the start mix when tiers are empty', () => {
    const series = buildAllocationOverTimeSeries([], 5, start, ALLOCATION_KEYS);
    expect(series).toHaveLength(5);
    for (const mix of series) {
      expect(mix.usLgGrowth).toBeCloseTo(0.5);
      expect(mix.usLgValue).toBeCloseTo(0.5);
      expect(sumWeights(mix)).toBeCloseTo(1);
    }
  });

  it('glides from start to a single remaining-tier target over the horizon', () => {
    const series = buildAllocationOverTimeSeries(
      [allBondsTier],
      5,
      start,
      ALLOCATION_KEYS,
    );
    expect(series[0].usLgGrowth).toBeCloseTo(0.5);
    expect(series[0].bond).toBeCloseTo(0);
    // Midpoint of the glide (year index 2 of 0..4 with end waypoint at 5).
    expect(series[2].bond).toBeCloseTo(0.4, 5);
    expect(series[2].usLgGrowth).toBeCloseTo(0.3, 5);
    // Last simulated year is near the target (t = 4/5).
    expect(series[4].bond).toBeCloseTo(0.8, 5);
    expect(series[4].usLgGrowth).toBeCloseTo(0.1, 5);
    for (const mix of series) {
      expect(sumWeights(mix)).toBeCloseTo(1);
    }
  });

  it('hits the intermediate mix at the span boundary', () => {
    const mid = {
      usLgGrowthAllocation: 0,
      usLgValueAllocation: 0,
      usSmMidAllocation: 0,
      exUsAllocation: 0,
      bondAllocation: 50,
      cashAllocation: 50,
      years: 10,
    };
    const end = {
      usLgGrowthAllocation: 0,
      usLgValueAllocation: 0,
      usSmMidAllocation: 0,
      exUsAllocation: 0,
      bondAllocation: 0,
      cashAllocation: 100,
    };
    const series = buildAllocationOverTimeSeries(
      [mid, end],
      20,
      start,
      ALLOCATION_KEYS,
    );
    expect(series[10].bond).toBeCloseTo(0.5);
    expect(series[10].cash).toBeCloseTo(0.5);
    expect(series[10].usLgGrowth).toBeCloseTo(0);
    expect(series[19].cash).toBeCloseTo(0.95, 5);
    for (const mix of series) {
      expect(sumWeights(mix)).toBeCloseTo(1);
    }
  });

  it('renormalizes drifted weights to sum to 1', () => {
    const out = renormalizeAllocation({
      usLgGrowth: 0.3,
      usLgValue: 0.3,
      usSmMid: 0.3,
      exUs: 0.3,
      bond: 0,
      cash: 0,
    });
    expect(sumWeights(out)).toBeCloseTo(1);
  });
});

describe('simulation consumes allocationSeries', () => {
  const cashProfiles = {
    usLgGrowth: { mean: 0, stdDev: 0 },
    usLgValue: { mean: 0, stdDev: 0 },
    usSmMid: { mean: 0, stdDev: 0 },
    exUs: { mean: 0, stdDev: 0 },
    bond: { mean: 0.10, stdDev: 0 },
    cash: { mean: 0, stdDev: 0 },
    inflation: { mean: 0, stdDev: 0 },
  };

  const portfolio = {
    start: 1_000_000,
    base: 0,
    floorBalance: 0,
    floorPenalty: 0,
    ceilingBalance: Infinity,
    ceilingBonus: 0,
    spendingOverTimeSeries: Array.from({ length: 10 }, () => ({ changeRate: 0, extra: 0 })),
  };

  const dynConfig = {
    enabled: false,
    low: { ret: -15, bal: null, adj: 0 },
    med: { ret: 5, bal: null, adj: 0 },
    high: { ret: 20, bal: null, adj: 0 },
  };

  it('ends with a different balance when the mix glides toward bonds', () => {
    const fixedStock = {
      usLgGrowth: 1,
      usLgValue: 0,
      usSmMid: 0,
      exUs: 0,
      bond: 0,
      cash: 0,
    };
    const glideSeries = buildAllocationOverTimeSeries(
      [allBondsTier],
      10,
      fixedStock,
      ALLOCATION_KEYS,
    );

    const fixedParams = {
      numYears: 10,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: fixedStock,
      logNormal: cashProfiles,
      portfolio,
      dynConfig,
    };
    const glideParams = {
      ...fixedParams,
      allocationSeries: glideSeries,
    };

    const fixed = simulatePath(fixedParams, createRng(1), true);
    const glide = simulatePath(glideParams, createRng(1), true);
    // Fixed 100% stock earns 0% with these profiles; gliding into bonds earns
    // positive returns, so the ending balance must be higher.
    expect(glide.finalBalance).toBeGreaterThan(fixed.finalBalance);
  });
});
