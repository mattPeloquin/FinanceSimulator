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

describe('buildRunResult withdrawalHeatmap', () => {
  const p = params();
  const raw = runMonteCarlo(p);
  const packaged = buildRunResult(p, raw);
  const hm = packaged.withdrawalHeatmap;
  // 300 sims: P5 rank 15, P65 rank 195 → 181-run window, under the column cap.
  const p5 = Math.floor(300 * 0.05);
  const p65 = Math.floor(300 * 0.65);
  const span = p65 - p5 + 1;

  it('has one column per run when the P5–P65 window fits the cap', () => {
    expect(hm.p5Rank).toBe(p5);
    expect(hm.p65Rank).toBe(p65);
    expect(hm.numCols).toBe(span);
    expect(hm.numYears).toBe(p.numYears);
    expect(hm.numSimulations).toBe(p.numSimulations);
    expect(hm.values.length).toBe(span * p.numYears);
    expect(Array.from(hm.colRunCount).every((c) => c === 1)).toBe(true);
  });

  it('orders columns by ascending withdrawal rank within the window', () => {
    for (let c = 0; c < hm.numCols; c++) {
      expect(hm.colCenterRank[c]).toBeGreaterThanOrEqual(p5);
      expect(hm.colCenterRank[c]).toBeLessThanOrEqual(p65);
      if (c > 0) expect(hm.colCenterRank[c]).toBeGreaterThan(hm.colCenterRank[c - 1]);
    }
  });

  it('cells reproduce the raw per-run withdrawals for single-run columns', () => {
    const rankW = packaged.surfaceMeta.rankW;
    for (const c of [0, 90, 180]) {
      const simIndex = rankW[p5 + c];
      expect(hm.colSimIndex[c]).toBe(simIndex);
      for (const j of [0, 15, 29]) {
        expect(hm.values[c * p.numYears + j]).toBe(raw.allYearsWithdrawals[simIndex * p.numYears + j]);
      }
    }
  });

  it('exposes the deterministic planned schedule as the deviation baseline', () => {
    expect(Array.from(hm.planByYear)).toEqual(plannedYearlySchedule(p.portfolio, p.numYears));
  });

  it('computes finite, ordered color domains', () => {
    expect(Number.isFinite(hm.absDomain.lo)).toBe(true);
    expect(Number.isFinite(hm.absDomain.hi)).toBe(true);
    expect(hm.absDomain.hi).toBeGreaterThan(hm.absDomain.lo);
    expect(Number.isFinite(hm.deltaDomain.max)).toBe(true);
    expect(hm.deltaDomain.max).toBeGreaterThanOrEqual(0);
  });

  it('bins adjacent ranks into averaged columns above the cap', () => {
    const big = params({ numSimulations: 1000 });
    const bigRaw = runMonteCarlo(big);
    const bigPackaged = buildRunResult(big, bigRaw);
    const bhm = bigPackaged.withdrawalHeatmap;
    // 1000 sims: ranks 50..650 → 601-run window binned into 480 columns.
    const bigSpan = bhm.p65Rank - bhm.p5Rank + 1;
    expect(bigSpan).toBe(601);
    expect(bhm.numCols).toBe(480);
    // Bands partition the window: sizes sum to the span, none empty.
    const total = Array.from(bhm.colRunCount).reduce((a, b) => a + b, 0);
    expect(total).toBe(bigSpan);
    expect(Array.from(bhm.colRunCount).every((c) => c >= 1)).toBe(true);
    // A banded cell is the mean of its band's raw values (skipping NaN — none
    // here since horizons are fixed).
    const rankW = bigPackaged.surfaceMeta.rankW;
    const c = 100;
    const bandLo = bhm.p5Rank + Math.floor((c * bigSpan) / bhm.numCols);
    const bandSize = bhm.colRunCount[c];
    const j = 10;
    let sum = 0;
    for (let r = bandLo; r < bandLo + bandSize; r++) {
      sum += bigRaw.allYearsWithdrawals[rankW[r] * big.numYears + j];
    }
    expect(bhm.values[c * big.numYears + j]).toBeCloseTo(sum / bandSize, 8);
  });
});
