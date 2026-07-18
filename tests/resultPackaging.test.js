import { describe, it, expect } from 'vitest';
import { runMonteCarlo } from '../src/core/simulation.js';
import { buildRunResult, heatmapFrameMember, bandWithdrawalHeatmap } from '../src/core/resultPackaging.js';
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
    expect(scatter.horizonYears.length).toBe(p.numSimulations);
    expect(scatter.finalBalance.length).toBe(p.numSimulations);
    expect(scatter.outcome.length).toBe(p.numSimulations);
    expect(Array.from(scatter.avgReturn)).toEqual(Array.from(raw.avgReturn));
    expect(Array.from(scatter.irr)).toEqual(Array.from(raw.irr));
    expect(Array.from(scatter.totalWithdrawn)).toEqual(Array.from(raw.totalWithdrawn));
    expect(Array.from(scatter.horizonYears)).toEqual(Array.from(raw.horizonYears));
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
  const src = packaged.withdrawalHeatmap;
  // 300 sims: the source holds P0..P100 (ranks 0..299 → 300 runs); the
  // renderer rebands the active from/to window to fill the plot width.
  const p0 = 0;
  const p100 = 299;
  const span = p100 - p0 + 1;

  it('ships a per-run source over the P0–P100 rank window', () => {
    expect(src.p5Rank).toBe(p0);
    expect(src.hiRank).toBe(p100);
    expect(src.hiPercentile).toBe(100);
    expect(src.sourceSpan).toBe(span);
    expect(src.numYears).toBe(p.numYears);
    expect(src.numSimulations).toBe(p.numSimulations);
    expect(src.sourceValues.length).toBe(span * p.numYears);
    expect(src.sourceSimIndex.length).toBe(span);
  });

  it('orders source rows by ascending withdrawal rank within the window', () => {
    const rankW = packaged.surfaceMeta.rankW;
    for (let i = 0; i < src.sourceSpan; i++) {
      expect(src.sourceSimIndex[i]).toBe(rankW[p0 + i]);
    }
    // Band columns partition the same rank window in ascending order.
    const hm = bandWithdrawalHeatmap(src, p0, p100, span);
    for (let c = 0; c < hm.numCols; c++) {
      expect(hm.colCenterRank[c]).toBeGreaterThanOrEqual(p0);
      expect(hm.colCenterRank[c]).toBeLessThanOrEqual(p100);
      if (c > 0) expect(hm.colCenterRank[c]).toBeGreaterThan(hm.colCenterRank[c - 1]);
    }
  });

  it('source rows reproduce the raw per-run withdrawals', () => {
    for (const i of [0, 90, 180]) {
      const simIndex = src.sourceSimIndex[i];
      for (const j of [0, 15, 29]) {
        expect(src.sourceValues[i * p.numYears + j]).toBe(raw.allYearsWithdrawals[simIndex * p.numYears + j]);
      }
    }
  });

  it('exposes the deterministic planned schedule as the deviation baseline', () => {
    expect(Array.from(src.planByYear)).toEqual(plannedYearlySchedule(p.portfolio, p.numYears));
  });

  it('exposes a flat classic 4% of start schedule for the vs 4% encoding', () => {
    const expected = p.portfolio.start * 0.04;
    expect(src.classicByYear).toHaveLength(p.numYears);
    expect(Array.from(src.classicByYear).every((v) => v === expected)).toBe(true);
    const banded = bandWithdrawalHeatmap(src, p0, p100, span);
    expect(Array.from(banded.classicByYear)).toEqual(Array.from(src.classicByYear));
  });

  it('bands the full source 1:1 when maxCols exceeds the span', () => {
    const hm = bandWithdrawalHeatmap(src, p0, p100, span);
    expect(hm.numCols).toBe(span);
    expect(Array.from(hm.colRunCount).every((c) => c === 1)).toBe(true);
    expect(hm.numFrames).toBe(1);
    expect(hm.frameValues).toBeNull();
    expect(hm.frameSimIndex).toBeNull();
  });

  it('bins adjacent ranks into averaged columns when span exceeds maxCols', () => {
    const big = params({ numSimulations: 1000 });
    const bigRaw = runMonteCarlo(big);
    const bigPackaged = buildRunResult(big, bigRaw);
    const bigSrc = bigPackaged.withdrawalHeatmap;
    const bigSpan = bigSrc.hiRank - bigSrc.p5Rank + 1;
    expect(bigSpan).toBe(1000);
    const bhm = bandWithdrawalHeatmap(bigSrc, bigSrc.p5Rank, bigSrc.hiRank, 480);
    expect(bhm.numCols).toBe(480);
    const total = Array.from(bhm.colRunCount).reduce((a, b) => a + b, 0);
    expect(total).toBe(bigSpan);
    expect(Array.from(bhm.colRunCount).every((c) => c >= 1)).toBe(true);
    const rankW = bigPackaged.surfaceMeta.rankW;
    const c = 100;
    const bandLo = bigSrc.p5Rank + Math.floor((c * bigSpan) / bhm.numCols);
    const bandSize = bhm.colRunCount[c];
    const j = 10;
    let sum = 0;
    for (let r = bandLo; r < bandLo + bandSize; r++) {
      sum += bigRaw.allYearsWithdrawals[rankW[r] * big.numYears + j];
    }
    expect(bhm.values[c * big.numYears + j]).toBeCloseTo(sum / bandSize, 8);

    expect(bhm.numFrames).toBe(3);
    expect(bhm.frameValues.length).toBe(3 * bhm.numCols * big.numYears);
    expect(bhm.frameSimIndex.length).toBe(3 * bhm.numCols);
    for (let f = 0; f < bhm.numFrames; f++) {
      const member = heatmapFrameMember(f, bandSize, bhm.numFrames);
      const simIndex = rankW[bandLo + member];
      expect(bhm.frameSimIndex[f * bhm.numCols + c]).toBe(simIndex);
      const cell = bhm.frameValues[(f * bhm.numCols + c) * big.numYears + j];
      expect(cell).toBeCloseTo(bigRaw.allYearsWithdrawals[simIndex * big.numYears + j], 0);
    }
  });

  it('rebands a narrower percentile window to maxCols', () => {
    const p5 = Math.floor(300 * 0.05);
    const p65 = Math.floor(300 * 0.65);
    const windowSpan = p65 - p5 + 1;
    const hm = bandWithdrawalHeatmap(src, p5, p65, 480);
    expect(hm.numCols).toBe(windowSpan);
    expect(hm.loRank).toBe(p5);
    expect(hm.windowHiRank).toBe(p65);
  });
});

describe('buildRunResult withdrawal tax packaging', () => {
  it('flags tax active and packages net below gross on taxed paths', () => {
    const numYears = 10;
    const taxSeries = Array.from({ length: numYears }, () => ({
      taxRate: 0.25,
      applyToGifts: true,
      spendBrackets: [],
    }));
    const p = params({
      numYears,
      numSimulations: 40,
      seed: 7,
      allocation: { usLgGrowth: 0, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 1 },
      logNormal: {
        ...logNormalProfiles,
        cash: { mean: 0.04, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
      },
      portfolio: {
        start: 1_000_000,
        base: 40_000,
        advisorFeeRate: 0,
        withdrawalTaxSeries: taxSeries,
      },
      dynConfig: { enabled: false },
    });
    const raw = runMonteCarlo(p);
    const packaged = buildRunResult(p, raw);
    expect(packaged.withdrawalTaxActive).toBe(true);
    expect(packaged.medianNetSpend).toBeLessThan(packaged.medianWithdrawn);
    expect(packaged.plannedGrossTotal).toBeGreaterThan(packaged.plannedWithdrawn);
    expect(packaged.percentiles.p50.totalNetSpend).toBeLessThan(packaged.percentiles.p50.totalWithdrawn);
  });

  it('leaves tax inactive and planned gross equal to net when tax is off', () => {
    const p = params({ numSimulations: 40, seed: 3 });
    const packaged = buildRunResult(p, runMonteCarlo(p));
    expect(packaged.withdrawalTaxActive).toBe(false);
    expect(packaged.plannedGrossTotal).toBeCloseTo(packaged.plannedWithdrawn, 3);
  });
});

describe('buildRunResult balancePercentiles and depletionByYear', () => {
  const p = params({ numSimulations: 400, portfolio: { start: 400_000, base: 40_000 } });
  const raw = runMonteCarlo(p);
  const packaged = buildRunResult(p, raw);

  it('packages 21 P5-step balance levels without shipping the full matrix', () => {
    expect(packaged.balancePercentiles).toBeTruthy();
    expect(packaged.balancePercentiles.levels).toHaveLength(21);
    expect(packaged.balancePercentiles.levels[0]).toBe(0);
    expect(packaged.balancePercentiles.levels[20]).toBe(100);
    expect(packaged.balancePercentiles.series).toHaveLength(21);
    for (const row of packaged.balancePercentiles.series) {
      expect(row.length).toBe(p.numYears);
    }
    expect(packaged.allYearsBalances).toBeUndefined();
  });

  it('is monotonic across percentile levels for each year', () => {
    const { series, numYears } = packaged.balancePercentiles;
    for (let year = 0; year < numYears; year++) {
      for (let li = 1; li < series.length; li++) {
        const prev = series[li - 1][year];
        const cur = series[li][year];
        if (Number.isNaN(prev) || Number.isNaN(cur)) continue;
        expect(cur).toBeGreaterThanOrEqual(prev - 1e-6);
      }
    }
  });

  it('keeps depletionByYear consistent with successRate', () => {
    const dep = packaged.depletionByYear;
    expect(dep.totalRuns).toBe(p.numSimulations);
    expect(dep.counts).toHaveLength(p.numYears);
    const fromHist = dep.totalDepleted / dep.totalRuns;
    expect(fromHist).toBeCloseTo(1 - packaged.successRate, 10);
  });
});

describe('heatmapFrameMember', () => {
  it('spreads frames evenly across the band', () => {
    // Band of 13 shown over 13 frames: one member per frame, in rank order.
    expect(heatmapFrameMember(0, 13, 13)).toBe(0);
    expect(heatmapFrameMember(6, 13, 13)).toBe(6);
    expect(heatmapFrameMember(12, 13, 13)).toBe(12);
  });

  it('repeats members when the band is smaller than the frame count', () => {
    // Single-run band: every frame shows that run.
    expect(heatmapFrameMember(0, 1, 24)).toBe(0);
    expect(heatmapFrameMember(23, 1, 24)).toBe(0);
    // Band of 2 over 4 frames: first half shows member 0, second half member 1.
    expect(heatmapFrameMember(1, 2, 4)).toBe(0);
    expect(heatmapFrameMember(2, 2, 4)).toBe(1);
  });

  it('never exceeds the band when frames cap a larger band', () => {
    // Band of 30 capped at 24 frames: members sampled across the full band.
    expect(heatmapFrameMember(0, 30, 24)).toBe(0);
    expect(heatmapFrameMember(23, 30, 24)).toBe(28);
  });
});
