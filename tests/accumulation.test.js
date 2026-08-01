import { describe, it, expect } from 'vitest';
import {
  buildContributionSeries,
  scaleContributionTiers,
  buildEventSeries,
  buildAllContributionSeries,
  simulateAccumulationPath,
  runAccumulationMonteCarlo,
  summarizeAccumulationPaths,
  buildWeightGrid,
  DEFAULT_WEIGHT_GRID_CEILING,
  allocationFromConfig,
} from '../src/core/accumulation.js';
import { createRng } from '../src/core/rng.js';
import { ALLOCATION_KEYS } from '../src/features/accumulation/session.js';
import { migrateAccumulationState, ACCUMULATION_STATE_VERSION } from '../src/state/migrations.js';
import { HANDLERS } from '../src/workers/dispatch.js';

const FLAT_ALLOC = {
  usLgGrowth: 0.25,
  usLgValue: 0.25,
  usSmMid: 0.1,
  exUs: 0.15,
  bond: 0.2,
  cash: 0.05,
};

function fixedReturnParams(overrides = {}) {
  // Log-normal with near-zero vol and known mean so paths are deterministic-ish.
  const mean = 0.05;
  const stdDev = 1e-9;
  const logNormal = {
    usLgGrowth: { mean, stdDev },
    usLgValue: { mean, stdDev },
    usSmMid: { mean, stdDev },
    exUs: { mean, stdDev },
    bond: { mean, stdDev },
    cash: { mean, stdDev },
    inflation: { mean: 0, stdDev },
    chol: null,
  };
  return {
    numYears: 5,
    distMethod: 'lognormal',
    blockSize: 1,
    allocation: FLAT_ALLOC,
    allocationKeys: ALLOCATION_KEYS,
    allocationOverTimeTiers: [],
    afterTaxDragRate: 0,
    balancesInThousands: true,
    sleeves: {
      ira: { startBalance: 10, contributionTiers: [{ amount: 1, growthPct: 0 }] },
      roth: { startBalance: 0, contributionTiers: [{ amount: 0, growthPct: 0 }] },
      afterTax: { startBalance: 0, basis: 0, contributionTiers: [{ amount: 0, growthPct: 0 }] },
    },
    events: [],
    logNormal,
    samples: { years: [] },
    ...overrides,
  };
}

describe('buildContributionSeries', () => {
  it('expands tiers with growthPct and last-tier fill', () => {
    const series = buildContributionSeries(
      [
        { amount: 1, growthPct: 100, years: 2 }, // $1k then $2k
        { amount: 3, growthPct: 0 }, // $3k for rest
      ],
      4,
    );
    expect(series).toEqual([1000, 2000, 3000, 3000]);
  });
});

describe('scaleContributionTiers', () => {
  it('scales amounts only for Low/Med/High', () => {
    const scaled = scaleContributionTiers(
      [{ amount: 10, growthPct: 2, years: 3 }, { amount: 5, growthPct: 1 }],
      0.5,
    );
    expect(scaled[0].amount).toBe(5);
    expect(scaled[0].growthPct).toBe(2);
    expect(scaled[1].amount).toBe(2.5);
  });
});

describe('buildEventSeries', () => {
  it('applies signed events at 1-based start years', () => {
    const series = buildEventSeries([{ amount: -10, startYear: 2, years: 2 }], 4);
    expect(series).toEqual([0, -10000, -10000, 0]);
  });
});

describe('simulateAccumulationPath', () => {
  it('grows contributions without withdrawals', () => {
    const params = fixedReturnParams();
    const path = simulateAccumulationPath(params, createRng(1));
    // Start $10k + $1k/yr for 5 years with ~5% real growth → ending > start + contributions.
    expect(path.ending.total).toBeGreaterThan(15000);
    expect(path.balancesByYear).toHaveLength(6);
    expect(path.balancesByYear[0]).toBe(10000);
  });

  it('applies after-tax drag on positive gains', () => {
    const base = fixedReturnParams({
      afterTaxDragRate: 0,
      sleeves: {
        ira: { startBalance: 0, contributionTiers: [{ amount: 0, growthPct: 0 }] },
        roth: { startBalance: 0, contributionTiers: [{ amount: 0, growthPct: 0 }] },
        afterTax: { startBalance: 100, basis: 100, contributionTiers: [{ amount: 0, growthPct: 0 }] },
      },
    });
    const dragged = {
      ...base,
      afterTaxDragRate: 0.5,
    };
    const noDrag = simulateAccumulationPath(base, createRng(42));
    const withDrag = simulateAccumulationPath(dragged, createRng(42));
    expect(withDrag.ending.afterTax).toBeLessThan(noDrag.ending.afterTax);
  });
});

describe('runAccumulationMonteCarlo + summarize', () => {
  it('builds a percentile cone', () => {
    const raw = runAccumulationMonteCarlo({
      ...fixedReturnParams(),
      numSimulations: 40,
      seed: 99,
    });
    const summary = summarizeAccumulationPaths(raw);
    expect(summary.cone).toHaveLength(6);
    expect(summary.ending.median).toBeGreaterThan(0);
    expect(summary.ending.p10).toBeLessThanOrEqual(summary.ending.p90);
  });

  it('Low savings scale ends below Med', () => {
    const med = runAccumulationMonteCarlo({
      ...fixedReturnParams(),
      numSimulations: 30,
      seed: 7,
      amountScale: 1,
    });
    const low = runAccumulationMonteCarlo({
      ...fixedReturnParams(),
      numSimulations: 30,
      seed: 7,
      amountScale: 0.5,
    });
    expect(summarizeAccumulationPaths(low).ending.median)
      .toBeLessThan(summarizeAccumulationPaths(med).ending.median);
  });
});

describe('buildWeightGrid', () => {
  it('respects ceiling and sums to ~1', () => {
    const grid = buildWeightGrid(0.5, DEFAULT_WEIGHT_GRID_CEILING);
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.length).toBeLessThanOrEqual(DEFAULT_WEIGHT_GRID_CEILING);
    for (const mix of grid) {
      const sum = Object.values(mix).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});

describe('allocationFromConfig', () => {
  it('converts scenario % keys to engine decimals', () => {
    const mix = allocationFromConfig({
      usLgGrowthAllocation: 50,
      usLgValueAllocation: 50,
      usSmMidAllocation: 0,
      exUsAllocation: 0,
      bondAllocation: 0,
      cashAllocation: 0,
    }, ALLOCATION_KEYS);
    expect(mix.usLgGrowth).toBeCloseTo(0.5);
    expect(mix.usLgValue).toBeCloseTo(0.5);
  });
});

describe('buildAllContributionSeries', () => {
  it('builds per-sleeve series', () => {
    const series = buildAllContributionSeries({
      ira: { contributionTiers: [{ amount: 2, growthPct: 0 }] },
      roth: { contributionTiers: [{ amount: 1, growthPct: 0 }] },
      afterTax: { contributionTiers: [{ amount: 0, growthPct: 0 }] },
    }, 3, 1);
    expect(series.ira).toEqual([2000, 2000, 2000]);
    expect(series.roth).toEqual([1000, 1000, 1000]);
  });
});

describe('migrateAccumulationState', () => {
  it('accepts current version', () => {
    const out = migrateAccumulationState({ numYears: 10 }, ACCUMULATION_STATE_VERSION);
    expect(out.numYears).toBe(10);
  });
});

describe('worker HANDLERS', () => {
  it('registers accumulation', () => {
    expect(typeof HANDLERS.accumulation).toBe('function');
  });
});
