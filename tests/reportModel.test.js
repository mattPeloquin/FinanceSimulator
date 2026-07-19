import { describe, it, expect } from 'vitest';
import { runMonteCarlo } from '../src/core/simulation.js';
import { buildRunResult, percentileLinear } from '../src/core/resultPackaging.js';
import {
  bandPercentileSeries,
  balanceFanSeries,
  buildPlanSnapshot,
} from '../src/core/reportModel.js';

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
    numYears: 20,
    numSimulations: 200,
    seed: 7,
    distMethod: 'lognormal',
    blockSize: 1,
    allocation: baseAllocation,
    logNormal: logNormalProfiles,
    portfolio: { start: 1_000_000, base: 40_000 },
    dynConfig: {},
    samples: null,
    ...overrides,
  };
}

describe('percentileLinear', () => {
  it('returns endpoints and interpolates midpoints', () => {
    expect(percentileLinear([10, 20, 30, 40], 0)).toBe(10);
    expect(percentileLinear([10, 20, 30, 40], 1)).toBe(40);
    expect(percentileLinear([10, 20, 30, 40], 0.5)).toBe(25);
  });
});

describe('bandPercentileSeries', () => {
  it('computes known per-year percentiles from a tiny heatmap', () => {
    // 5 rank rows × 3 years. Year 0 values: 0,10,20,30,40 → P0=0, P50=20, P100=40
    // Year 1 has a NaN in one row; Year 2 includes a deposit-like negative (clamped to 0).
    const sourceValues = new Float32Array([
      0, 100, -5,
      10, 110, 50,
      20, NaN, 60,
      30, 130, 70,
      40, 140, 80,
    ]);
    const heatmap = {
      numYears: 3,
      sourceSpan: 5,
      sourceValues,
      planByYear: Float64Array.from([25, 25, 25]),
    };
    const band = bandPercentileSeries(heatmap, 0, 100);
    expect(band.low[0]).toBe(0);
    expect(band.median[0]).toBe(20);
    expect(band.high[0]).toBe(40);
    expect(band.columns[1].length).toBe(4); // NaN stripped
    expect(band.low[2]).toBe(0); // clamped deposit
    expect(band.plan).toEqual([25, 25, 25]);
    // Depleted fraction keys off the RAW value (exact $0), so the deposit
    // (-5, clamped to 0 in the column) does NOT count as depleted.
    expect(band.depletedFraction[0]).toBeCloseTo(1 / 5); // one raw 0 of five
    expect(band.depletedFraction[1]).toBe(0); // no zeros
    expect(band.depletedFraction[2]).toBe(0); // deposit is not depletion
  });
});

describe('balanceFanSeries', () => {
  it('picks the correct P5-step rows and labels', () => {
    const levels = Array.from({ length: 21 }, (_, i) => i * 5);
    const series = levels.map((level) => Float64Array.from([level * 1000, level * 1000 + 1]));
    const fan = balanceFanSeries({ numYears: 2, levels, series }, 10, 90);
    expect(fan.lowLabel).toBe('P10');
    expect(fan.highLabel).toBe('P90');
    expect(fan.low[0]).toBe(10_000);
    expect(fan.median[0]).toBe(50_000);
    expect(fan.high[0]).toBe(90_000);
  });
});

describe('buildPlanSnapshot', () => {
  const p = params();
  const raw = runMonteCarlo(p);
  const packaged = buildRunResult(p, raw);
  const scenario = {
    startBalance: 1000,
    numYears: 20,
    horizonPlusYears: 0,
    horizonMinusYears: 0,
    baseWithdrawal: 40,
    withdrawalStrategy: 'base',
    usLgGrowthAllocation: 35,
    usLgValueAllocation: 25,
    usSmMidAllocation: 15,
    exUsAllocation: 15,
    bondAllocation: 0,
    cashAllocation: 10,
    distMethod: 'lognormal',
    enableFeesTaxes: false,
    enableDynamicAdjustments: false,
    presetActive: false,
    goalSeekMode: false,
  };

  it('builds a usable snapshot from a real packaged run', () => {
    const snap = buildPlanSnapshot(packaged, scenario, null, { pLow: 10, pHigh: 90 });
    // Verdict prose was removed; the hero stats + gauges donut now carry it.
    expect(snap.verdict).toEqual([]);
    expect(snap.footerLine).toMatch(/simulations/i);
    expect(snap.band.years.length).toBe(packaged.maxYears);
    expect(snap.band.low.length).toBe(packaged.maxYears);
    expect(snap.planBullets.some((b) => /base/i.test(b))).toBe(true);
    expect(snap.nextMoves).toBeUndefined();
  });

  it('mentions fees when enableFeesTaxes is on', () => {
    const withFees = {
      ...scenario,
      enableFeesTaxes: true,
      advisorFeePct: 0.5,
      withdrawalTaxTiers: [{ taxPct: 10, spendBrackets: [] }],
    };
    const snap = buildPlanSnapshot(packaged, withFees, null, { pLow: 10, pHigh: 90 });
    expect(snap.planBullets.some((b) => /fee|tax/i.test(b))).toBe(true);
  });

  it('shows a no-depletion note when every run survives', () => {
    const rich = params({ portfolio: { start: 5_000_000, base: 10_000 }, numSimulations: 80 });
    const richPackaged = buildRunResult(rich, runMonteCarlo(rich));
    const snap = buildPlanSnapshot(richPackaged, { ...scenario, startBalance: 5000, baseWithdrawal: 10 }, null, {
      pLow: 10,
      pHigh: 90,
    });
    if (richPackaged.depletionByYear.totalDepleted === 0) {
      expect(snap.depletion.note).toMatch(/No depletions/);
    }
  });
});
