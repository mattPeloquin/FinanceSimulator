import { describe, it, expect } from 'vitest';
import { runMonteCarlo } from '../src/core/simulation.js';
import { buildRunResult } from '../src/core/resultPackaging.js';
import { plannedYearlySchedule } from '../src/core/goalSeek.js';

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

function params(overrides = {}) {
  return {
    numYears: 30,
    numSimulations: 300,
    seed: 42,
    distMethod: 'lognormal',
    blockSize: 1,
    allocation: baseAllocation,
    logNormal: logNormalProfiles,
    portfolio: { start: 1_000_000, base: 55_000 },
    dynConfig: {},
    samples: null,
    ...overrides,
  };
}

describe('buildRunResult returnScatter', () => {
  const p = params();
  const raw = runMonteCarlo(p);
  const packaged = buildRunResult(p, raw);
  const scatter = packaged.returnScatter;

  it('carries one point per simulation, aligned with the raw arrays', () => {
    expect(scatter.avgReturn.length).toBe(p.numSimulations);
    expect(scatter.irr.length).toBe(p.numSimulations);
    expect(scatter.totalWithdrawn.length).toBe(p.numSimulations);
    expect(scatter.finalBalance.length).toBe(p.numSimulations);
    expect(scatter.outcome.length).toBe(p.numSimulations);
    expect(Array.from(scatter.avgReturn)).toEqual(Array.from(raw.avgReturn));
    expect(Array.from(scatter.irr)).toEqual(Array.from(raw.irr));
    expect(Array.from(scatter.totalWithdrawn)).toEqual(Array.from(raw.totalWithdrawn));
    expect(Array.from(scatter.finalBalance)).toEqual(Array.from(raw.finalBalance));
  });

  it('tags every depleted path as outcome 2 and only valid codes elsewhere', () => {
    for (let i = 0; i < p.numSimulations; i++) {
      const depleted = raw.depletionYear[i] <= raw.horizonYears[i];
      if (depleted) {
        expect(scatter.outcome[i]).toBe(2);
      } else {
        expect([0, 1]).toContain(scatter.outcome[i]);
      }
    }
  });

  it('computes a finite required IRR consistent with the planned schedule', () => {
    expect(scatter.requiredIrr).not.toBeNull();
    expect(Number.isFinite(scatter.requiredIrr)).toBe(true);
    // The break-even rate must discount the plan to exactly the starting balance.
    const schedule = plannedYearlySchedule(p.portfolio, p.numYears);
    let npv = -p.portfolio.start;
    for (let t = 0; t < schedule.length; t++) {
      npv += schedule[t] / (1 + scatter.requiredIrr) ** (t + 1);
    }
    expect(npv).toBeCloseTo(0, 2);
  });

  it('exposes irr on percentile entries and an irrSummary', () => {
    expect(Number.isFinite(packaged.percentiles.p50.irr)).toBe(true);
    expect(Number.isFinite(packaged.irrSummary.mean)).toBe(true);
    expect(Number.isFinite(packaged.irrSummary.median)).toBe(true);
  });

  it('builds an IRR histogram covering every simulation', () => {
    expect(packaged.irrHistogram.bins.length).toBeGreaterThan(0);
    const counted = packaged.irrHistogram.bins.reduce((a, b) => a + b, 0);
    let finite = 0;
    for (let i = 0; i < raw.irr.length; i++) {
      if (!Number.isNaN(raw.irr[i])) finite++;
    }
    expect(counted).toBe(finite);
  });
});
