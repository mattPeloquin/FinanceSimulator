import { describe, it, expect } from 'vitest';
import {
  summarizeSweepPoint,
  assembleLabSweepResult,
  binomialStandardError,
  percentileVector,
  readMetricValue,
  readMetricMean,
  PERCENTILE_GRID,
  METRIC_DEFS,
} from '../src/core/sensitivity.js';
import { tornadoRows, curveSeries } from '../src/features/sor-lab/ui/select.js';
import {
  applyEquitySharePct,
  applyBondVsCashSplit,
  resolveLabVariables,
  LAB_VARIABLES,
} from '../src/features/sor-lab/variables.js';
import {
  linspace,
  buildSweepJob,
  estimateSweepCost,
  stripSharedArrays,
  restoreSharedArrays,
} from '../src/features/sor-lab/sweep.js';
import { defaultScenario, ALLOCATION_KEYS, buildSimParams } from '../src/state/scenario.js';
import { getSampleYears } from '../src/core/history.js';
import { regeneratePath } from '../src/core/simulation.js';

function sampleScenario(overrides = {}) {
  const s = {
    ...defaultScenario(),
    startBalance: 2000,
    baseWithdrawal: 80,
    numYears: 30,
    numSimulations: 200,
    randomSeed: '42',
    enableDynamicAdjustments: true,
    floorBalance: 1600,
    ceilingBalance: 2400,
    glideTarget: 320,
    enableFeesTaxes: false,
    usLgGrowthMean: 10,
    usLgGrowthStdDev: 18,
    usLgValueMean: 9,
    usLgValueStdDev: 16,
    usSmMidMean: 11,
    usSmMidStdDev: 22,
    exUsMean: 8,
    exUsStdDev: 17,
    bondReturnMean: 3,
    bondReturnStdDev: 6,
    cashReturnMean: 1,
    cashReturnStdDev: 1,
    inflationMean: 3,
    inflationStdDev: 2,
    ...overrides,
  };
  return s;
}

function fakeRaw({ n = 100, successFrac = 0.8 } = {}) {
  const finalBalance = new Float64Array(n);
  const depletionYear = new Float64Array(n);
  const horizonYears = new Int32Array(n);
  const totalWithdrawn = new Float64Array(n);
  const medianYearlyWithdrawal = new Float64Array(n);
  const irr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    horizonYears[i] = 30;
    const ok = i < Math.round(n * successFrac);
    depletionYear[i] = ok ? 31 : 10;
    finalBalance[i] = ok ? 100_000 + i * 1000 : 0;
    totalWithdrawn[i] = 50_000 + i * 100;
    medianYearlyWithdrawal[i] = 2000 + i;
    irr[i] = 0.04 + i * 0.0001;
  }
  return {
    numSimulations: n,
    finalBalance,
    depletionYear,
    horizonYears,
    totalWithdrawn,
    totalNetSpend: totalWithdrawn,
    medianYearlyWithdrawal,
    medianYearlyNetSpend: medianYearlyWithdrawal,
    irr,
    allYearsWithdrawals: new Float64Array(n * 30),
    allYearsNetSpend: new Float64Array(n * 30),
  };
}

describe('sensitivity core', () => {
  it('computes binomial SE', () => {
    expect(binomialStandardError(0.5, 100)).toBeCloseTo(0.05, 6);
    expect(binomialStandardError(0, 100)).toBe(0);
    expect(binomialStandardError(1, 0)).toBe(0);
  });

  it('builds percentile vectors over the grid', () => {
    const values = Float64Array.from({ length: 100 }, (_, i) => i + 1);
    const vec = percentileVector(values);
    expect(vec).toHaveLength(PERCENTILE_GRID.length);
    expect(vec[PERCENTILE_GRID.indexOf(50)]).toBeGreaterThan(40);
  });

  it('summarizeSweepPoint extracts rates and per-path percentiles', () => {
    const scenario = sampleScenario();
    const years = getSampleYears(scenario.startYear, scenario.endYear);
    const params = buildSimParams(scenario, { years });
    const raw = fakeRaw({ n: 200, successFrac: 0.75 });
    const bundle = summarizeSweepPoint(raw, params);
    expect(bundle.rates.successRate.value).toBeCloseTo(0.75, 5);
    expect(bundle.rates.depletionRate.value).toBeCloseTo(0.25, 5);
    expect(bundle.rates.successRate.se).toBeGreaterThan(0);
    expect(bundle.perPath.endingBalance.percentiles).toHaveLength(PERCENTILE_GRID.length);
    expect(bundle.perPath.lifetimeSpend.mean).toBeGreaterThan(0);
    expect(bundle.perPath.meanYearlySpend.mean).toBeGreaterThan(0);
    // Mean yearly ≈ lifetime / horizon for the fake raw (fixed 30-year horizon).
    expect(bundle.perPath.meanYearlySpend.mean)
      .toBeCloseTo(bundle.perPath.lifetimeSpend.mean / 30, 5);
    expect(METRIC_DEFS.some((m) => m.id === 'successRate')).toBe(true);
    expect(METRIC_DEFS.some((m) => m.id === 'meanYearlySpend')).toBe(true);
  });

  it('assembleLabSweepResult inserts shared baseline into curves', () => {
    const baselineBundle = summarizeSweepPoint(fakeRaw({ successFrac: 0.8 }), {});
    const lowBundle = summarizeSweepPoint(fakeRaw({ successFrac: 0.7 }), {});
    const highBundle = summarizeSweepPoint(fakeRaw({ successFrac: 0.9 }), {});
    const result = assembleLabSweepResult({
      evaluated: [
        { kind: 'baseline', variableId: null, value: null, bundle: baselineBundle },
        { kind: 'variable', variableId: 'startBalance', value: 1400, bundle: lowBundle },
        { kind: 'variable', variableId: 'startBalance', value: 2600, bundle: highBundle },
        { kind: 'sentinel', variableId: 'sentinelA', value: -1, bundle: baselineBundle },
        { kind: 'sentinel', variableId: 'sentinelA', value: 1, bundle: baselineBundle },
      ],
      variableDefs: [
        {
          id: 'startBalance',
          label: 'Starting portfolio',
          group: 'Portfolio',
          category: 'decision',
          unit: '$000s',
          baselineValue: 2000,
          envelope: { low: 1400, high: 2600 },
        },
        {
          id: 'sentinelA',
          label: 'Noise floor A',
          group: 'Sentinels',
          category: 'uncertainty',
          unit: 'index',
          baselineValue: 0,
          envelope: { low: -1, high: 1 },
          isSentinel: true,
        },
      ],
      baselineRef: { feature: 'sor-plan', name: 'Demo' },
      meta: { seed: 1, pathsPerPoint: 200, sweepPoints: 3 },
    });
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].values).toEqual([1400, 2000, 2600]);
    expect(result.variables[0].points).toHaveLength(3);
    expect(result.sentinels).toHaveLength(1);
    expect(readMetricValue(result.baseline, 'successRate')).toBeCloseTo(0.8, 5);
  });
});

describe('Lab variable registry', () => {
  it('gates fee and gifting variables when inactive', () => {
    const s = sampleScenario({ enableFeesTaxes: false, giftingTiers: [] });
    const { live, gated } = resolveLabVariables(s);
    expect(live.some((v) => v.id === 'advisorFeePct')).toBe(false);
    expect(gated.some((v) => v.id === 'advisorFeePct' && v.gatedOff)).toBe(true);
    expect(live.some((v) => v.id === 'giftingAmountScale')).toBe(false);
  });

  it('swaps base vs specific spending variables', () => {
    const base = sampleScenario({ withdrawalStrategy: 'base' });
    const specific = sampleScenario({
      withdrawalStrategy: 'specific',
      specificWithdrawals: '80\n80\n80',
    });
    expect(resolveLabVariables(base).live.some((v) => v.id === 'baseWithdrawal')).toBe(true);
    expect(resolveLabVariables(base).live.some((v) => v.id === 'specificWithdrawalScale')).toBe(false);
    expect(resolveLabVariables(specific).live.some((v) => v.id === 'specificWithdrawalScale')).toBe(true);
    expect(resolveLabVariables(specific).live.some((v) => v.id === 'baseWithdrawal')).toBe(false);
  });

  it('reparameterizes equity share while preserving within-equity mix', () => {
    const s = sampleScenario({
      usLgGrowthAllocation: 40,
      usLgValueAllocation: 20,
      usSmMidAllocation: 10,
      exUsAllocation: 10,
      bondAllocation: 15,
      cashAllocation: 5,
    });
    const out = applyEquitySharePct(s, 50);
    const equity = ALLOCATION_KEYS.slice(0, 4).reduce((sum, k) => sum + out[k], 0);
    const total = ALLOCATION_KEYS.reduce((sum, k) => sum + out[k], 0);
    expect(equity).toBeCloseTo(50, 5);
    expect(total).toBeCloseTo(100, 5);
    // Within-equity proportions: growth was 40/80 = 0.5 of equity.
    expect(out.usLgGrowthAllocation / equity).toBeCloseTo(0.5, 5);
  });

  it('splits bonds vs cash without moving equity', () => {
    const s = sampleScenario({
      usLgGrowthAllocation: 40,
      usLgValueAllocation: 20,
      usSmMidAllocation: 10,
      exUsAllocation: 10,
      bondAllocation: 15,
      cashAllocation: 5,
    });
    const out = applyBondVsCashSplit(s, 25);
    const equity = 40 + 20 + 10 + 10;
    expect(out.usLgGrowthAllocation + out.usLgValueAllocation + out.usSmMidAllocation + out.exUsAllocation)
      .toBeCloseTo(equity, 5);
    expect(out.bondAllocation).toBeCloseTo(5, 5); // 25% of 20
    expect(out.cashAllocation).toBeCloseTo(15, 5);
  });

  it('sentinel apply is a no-op', () => {
    const s = sampleScenario();
    const sentinel = LAB_VARIABLES.find((v) => v.id === 'sentinelA');
    const out = sentinel.apply(s, 1);
    expect(out.startBalance).toBe(s.startBalance);
    expect(out.baseWithdrawal).toBe(s.baseWithdrawal);
  });
});

describe('Lab sweep construction', () => {
  it('linspace includes endpoints', () => {
    expect(linspace(0, 10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('estimateSweepCost counts design points with shared baseline', () => {
    const s = sampleScenario();
    const est = estimateSweepCost(s, { sweepPoints: 5, pathsPerPoint: 1000 });
    expect(est.liveVariables).toBeGreaterThan(5);
    expect(est.designPoints).toBeGreaterThan(est.liveVariables);
    // designPoints = 1 baseline + (points-1 or points) per live var excluding exact baseline hits
    expect(est.totalPaths).toBe(est.designPoints * 1000);
  });

  it('buildSweepJob pins seed on every point', () => {
    const s = sampleScenario({ randomSeed: '' });
    const job = buildSweepJob(s, {
      seed: 12345,
      sweepPoints: 3,
      pathsPerPoint: 50,
      baselineRef: { feature: 'sor-plan', name: 'Demo' },
      envelopeOverrides: {
        // Disable most variables for a fast unit build — keep a couple.
        ...Object.fromEntries(
          LAB_VARIABLES.filter((v) => !v.isSentinel && v.id !== 'startBalance' && v.id !== 'baseWithdrawal')
            .map((v) => [v.id, { enabled: false }]),
        ),
      },
    });
    expect(job.baseParams.seed).toBe(12345);
    for (const point of job.designPoints) {
      expect(point.params.seed).toBe(12345);
      expect(point.params.samples).toBeNull();
    }
    const restored = restoreSharedArrays(job.designPoints[0].params, job.baseParams);
    expect(restored.samples?.years?.length).toBeGreaterThan(0);
    expect(stripSharedArrays(job.baseParams).scaledHistoricalShocks).toBeNull();
  });

  it('CRN-safe startBalance perturbations share market path returns', () => {
    const s = sampleScenario();
    const years = getSampleYears(s.startYear, s.endYear);
    const samples = { years };
    const seed = 99;
    const low = { ...s, startBalance: 1400, numSimulations: 5, randomSeed: String(seed) };
    const high = { ...s, startBalance: 2600, numSimulations: 5, randomSeed: String(seed) };
    const pLow = buildSimParams(low, samples);
    const pHigh = buildSimParams(high, samples);
    pLow.seed = seed;
    pHigh.seed = seed;
    const pathLow = regeneratePath(pLow, seed, 0);
    const pathHigh = regeneratePath(pHigh, seed, 0);
    expect(pathLow.path.returns.length).toBe(pathHigh.path.returns.length);
    for (let j = 0; j < pathLow.path.returns.length; j++) {
      expect(pathLow.path.returns[j]).toBeCloseTo(pathHigh.path.returns[j], 12);
    }
  });
});

describe('Lab selectors', () => {
  function miniResult() {
    const baseline = summarizeSweepPoint(fakeRaw({ successFrac: 0.8 }), {});
    const low = summarizeSweepPoint(fakeRaw({ successFrac: 0.6 }), {});
    const high = summarizeSweepPoint(fakeRaw({ successFrac: 0.95 }), {});
    const flat = summarizeSweepPoint(fakeRaw({ successFrac: 0.8 }), {});
    return assembleLabSweepResult({
      evaluated: [
        { kind: 'baseline', variableId: null, value: null, bundle: baseline },
        { kind: 'variable', variableId: 'startBalance', value: 1400, bundle: low },
        { kind: 'variable', variableId: 'startBalance', value: 2600, bundle: high },
        { kind: 'variable', variableId: 'advisorFeePct', value: 0, bundle: flat },
        { kind: 'variable', variableId: 'advisorFeePct', value: 1.5, bundle: flat },
        { kind: 'sentinel', variableId: 'sentinelA', value: -1, bundle: flat },
        { kind: 'sentinel', variableId: 'sentinelA', value: 1, bundle: flat },
      ],
      variableDefs: [
        {
          id: 'startBalance',
          label: 'Starting portfolio',
          group: 'Portfolio',
          category: 'decision',
          unit: '$000s',
          baselineValue: 2000,
          envelope: { low: 1400, high: 2600 },
        },
        {
          id: 'advisorFeePct',
          label: 'Advisor fee',
          group: 'Portfolio',
          category: 'decision',
          unit: '%',
          baselineValue: 0,
          envelope: { low: 0, high: 1.5 },
        },
        {
          id: 'sentinelA',
          label: 'Noise A',
          group: 'Sentinels',
          category: 'uncertainty',
          unit: 'index',
          baselineValue: 0,
          envelope: { low: -1, high: 1 },
          isSentinel: true,
        },
      ],
      baselineRef: { feature: 'sor-plan', name: 'Demo' },
      meta: { seed: 1, pathsPerPoint: 100, sweepPoints: 3 },
    });
  }

  it('tornadoRows ranks by impact and marks below-noise bars', () => {
    const result = miniResult();
    const { rows, allRows, noiseFloor } = tornadoRows(result, {
      metric: 'successRate',
      topN: 10,
      showBelowNoise: true,
    });
    expect(noiseFloor).toBeLessThan(0.01);
    expect(rows[0].id).toBe('startBalance');
    expect(rows[0].impact).toBeGreaterThan(rows.find((r) => r.id === 'advisorFeePct').impact);
    const fee = allRows.find((r) => r.id === 'advisorFeePct');
    expect(fee.belowNoise).toBe(true);
  });

  it('re-ranking by band does not mutate stored curves', () => {
    const result = miniResult();
    const before = JSON.stringify(result.variables[0].points);
    tornadoRows(result, { metric: 'endingBalance', band: { low: 10, high: 90 } });
    tornadoRows(result, { metric: 'endingBalance', band: { low: 20, high: 80 } });
    expect(JSON.stringify(result.variables[0].points)).toBe(before);
  });

  it('curveSeries returns x and metric series', () => {
    const result = miniResult();
    const curve = curveSeries(result, 'startBalance', { metric: 'successRate' });
    expect(curve.x).toEqual([1400, 2000, 2600]);
    expect(curve.series.value).toHaveLength(3);
    expect(curve.series.se).toHaveLength(3);
    expect(curve.envelope).toBeTruthy();
  });

  it('curveSeries returns fan percentiles and mean for per-path metrics', () => {
    const result = miniResult();
    const curve = curveSeries(result, 'startBalance', {
      metric: 'endingBalance',
      band: { low: 10, high: 90 },
    });
    expect(curve.series.percentiles[50]).toHaveLength(3);
    expect(curve.series.percentiles[5]).toHaveLength(3);
    expect(curve.series.percentiles[95]).toHaveLength(3);
    expect(curve.series.mean).toHaveLength(3);
  });

  it('readMetricMean returns the per-path mean and null for rates', () => {
    const result = miniResult();
    expect(readMetricMean(result.baseline, 'endingBalance')).toBeTypeOf('number');
    expect(readMetricMean(result.baseline, 'successRate')).toBeNull();
  });
});
