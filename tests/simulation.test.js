import { describe, it, expect } from 'vitest';
import { simulatePath, runMonteCarlo, regeneratePath } from '../src/core/simulation.js';
import { createRng, deriveSeed } from '../src/core/rng.js';
import { successRate } from '../src/core/statistics.js';
import { computeProfiles, computeStandardizedYears } from '../src/core/history.js';
import { buildSpendingOverTimeSeries } from '../src/core/withdrawal.js';

const dollars = (k) => k;
function spendingSeries(numYears, tiers) {
  return buildSpendingOverTimeSeries(tiers, numYears, dollars);
}

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

describe('glide-path spend-down', () => {
  // The glide lever is part of Dynamic Adjustments & Guardrails, so it only
  // runs when dynConfig.enabled is true. Neutral anchors (all adjustments 0,
  // no balance overrides) keep the section enabled without adding spending.
  const neutralEnabledDynConfig = {
    enabled: true,
    low: { ret: -15, bal: null, adj: 0 },
    med: { ret: 5, bal: null, adj: 0 },
    high: { ret: 20, bal: null, adj: 0 },
  };

  // 100% cash at a deterministic 5% nominal / 0% inflation return, with
  // neutral adjustments and guardrails — every path is identical, so glide
  // behavior can be asserted exactly.
  function deterministicParams(portfolioOverrides = {}) {
    return lognormalParams({
      numYears: 10,
      numSimulations: 1,
      allocation: { usLgGrowth: 0, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 1 },
      logNormal: {
        ...logNormalProfiles,
        cash: { mean: 0.05, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
      },
      dynConfig: neutralEnabledDynConfig,
      portfolio: {
        start: 1_000_000,
        base: 50_000,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
        ...portfolioOverrides,
      },
    });
  }

  it('is inert while dynamic adjustments are disabled, even with a target set', () => {
    const off = runMonteCarlo(deterministicParams());
    const disabledSection = runMonteCarlo({
      ...deterministicParams({ glideTarget: 200_000, glideFraction: 1, glideRate: 0.05 }),
      dynConfig: { ...neutralEnabledDynConfig, enabled: false },
    });
    const offDisabled = runMonteCarlo({
      ...deterministicParams(),
      dynConfig: { ...neutralEnabledDynConfig, enabled: false },
    });
    expect(Array.from(disabledSection.finalBalance)).toEqual(Array.from(offDisabled.finalBalance));
    expect(Array.from(disabledSection.totalWithdrawn)).toEqual(Array.from(offDisabled.totalWithdrawn));
    // Sanity: with neutral anchors the enabled/disabled baselines also match.
    expect(Array.from(off.finalBalance)).toEqual(Array.from(offDisabled.finalBalance));
  });

  it('a null glide target leaves results byte-identical to params without glide fields', () => {
    const withoutFields = runMonteCarlo(lognormalParams());
    const withNullTarget = runMonteCarlo(
      lognormalParams({
        portfolio: {
          ...lognormalParams().portfolio,
          glideTarget: null,
          glideFraction: 0.5,
          glideRate: 0.02,
        },
      }),
    );
    expect(Array.from(withNullTarget.finalBalance)).toEqual(Array.from(withoutFields.finalBalance));
    expect(Array.from(withNullTarget.totalWithdrawn)).toEqual(Array.from(withoutFields.totalWithdrawn));
  });

  it('a zero fraction also disables the lever', () => {
    const off = runMonteCarlo(deterministicParams());
    const zeroFraction = runMonteCarlo(
      deterministicParams({ glideTarget: 200_000, glideFraction: 0, glideRate: 0.05 }),
    );
    expect(Array.from(zeroFraction.finalBalance)).toEqual(Array.from(off.finalBalance));
  });

  it('with fraction 1 and the glide rate matching the real return, the path lands exactly on the target', () => {
    const result = runMonteCarlo(
      deterministicParams({ glideTarget: 200_000, glideFraction: 1, glideRate: 0.05 }),
    );
    expect(result.finalBalance[0]).toBeCloseTo(200_000, 2);
  });

  it('recycled surplus raises withdrawals and never causes depletion above the target', () => {
    const off = runMonteCarlo(deterministicParams());
    const on = runMonteCarlo(
      deterministicParams({ glideTarget: 200_000, glideFraction: 1, glideRate: 0.05 }),
    );
    expect(on.totalWithdrawn[0]).toBeGreaterThan(off.totalWithdrawn[0]);
    expect(on.depletionYear[0]).toBe(11); // horizon + 1 = never depleted
  });

  it('a larger recycle fraction spends the surplus down harder across a volatile Monte Carlo run', () => {
    // Neutral guardrails isolate the glide lever inside the enabled section.
    const base = {
      ...lognormalParams().portfolio,
      floorBalance: 0,
      floorPenalty: 0,
      ceilingBalance: Infinity,
      ceilingBonus: 0,
    };
    const run = (glideFraction) =>
      runMonteCarlo(
        lognormalParams({
          dynConfig: neutralEnabledDynConfig,
          portfolio: { ...base, glideTarget: 1_000_000, glideFraction, glideRate: 0.02 },
        }),
      );
    const off = runMonteCarlo(lognormalParams({ dynConfig: neutralEnabledDynConfig, portfolio: base }));
    const half = run(0.5);
    const full = run(1);
    const medianOf = (arr) => {
      const sorted = Array.from(arr).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    expect(medianOf(half.finalBalance)).toBeLessThan(medianOf(off.finalBalance));
    expect(medianOf(full.finalBalance)).toBeLessThan(medianOf(half.finalBalance));
    expect(medianOf(full.totalWithdrawn)).toBeGreaterThan(medianOf(off.totalWithdrawn));
  });
});

describe('runMonteCarlo determinism', () => {
  it('produces identical results for the same seed', () => {
    const a = runMonteCarlo(lognormalParams());
    const b = runMonteCarlo(lognormalParams());
    expect(Array.from(a.avgReturn)).toEqual(Array.from(b.avgReturn));
    expect(Array.from(a.irr)).toEqual(Array.from(b.irr));
    expect(Array.from(a.finalBalance)).toEqual(Array.from(b.finalBalance));
    expect(Array.from(a.totalWithdrawn)).toEqual(Array.from(b.totalWithdrawn));
    expect(Array.from(a.medianYearlyWithdrawal)).toEqual(Array.from(b.medianYearlyWithdrawal));
    expect(Array.from(a.horizonYears)).toEqual(Array.from(b.horizonYears));
    expect(Array.from(a.allYearsReturns)).toEqual(Array.from(b.allYearsReturns));
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
      expect(re.medianYearlyWithdrawal).toBeCloseTo(result.medianYearlyWithdrawal[i], 6);
      expect(re.avgReturn).toBeCloseTo(result.avgReturn[i], 12);
      expect(re.irr).toBeCloseTo(result.irr[i], 12);
      // The regenerated path arrays are populated and self-consistent.
      expect(re.path.balances.length).toBe(params.numYears + 1);
      expect(re.path.withdrawals.length).toBe(params.numYears);
      expect(re.path.returns.length).toBe(params.numYears);
      expect(re.path.balances[re.path.balances.length - 1]).toBeCloseTo(re.finalBalance, 6);
    }
  });
});

describe('money-weighted return (irr)', () => {
  it('collapses to the time-weighted avgReturn when there are no withdrawals', () => {
    // With zero withdrawals the only flows are the initial balance and the final
    // balance, so the IRR is exactly the geometric mean return.
    const params = lognormalParams({
      numSimulations: 50,
      portfolio: { start: 4_000_000, base: 0 },
    });
    const result = runMonteCarlo(params);
    for (let i = 0; i < result.numSimulations; i++) {
      expect(result.irr[i]).toBeCloseTo(result.avgReturn[i], 8);
    }
  });

  it('diverges from avgReturn once withdrawals weight the returns', () => {
    const result = runMonteCarlo(lognormalParams({ numSimulations: 200 }));
    let differing = 0;
    for (let i = 0; i < result.numSimulations; i++) {
      expect(Number.isFinite(result.irr[i])).toBe(true);
      if (Math.abs(result.irr[i] - result.avgReturn[i]) > 1e-6) differing++;
    }
    expect(differing).toBeGreaterThan(0);
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
    expect(result.irr.length).toBe(500);
    expect(result.allYearsReturns.length).toBe(500 * params.numYears);
    expect(Number.isFinite(result.finalBalance[0])).toBe(true);
  });

  it('runs with stationary bootstrap when blockSize>1 and maps returns to sample years', () => {
    const params = lognormalParams({
      distMethod: 'resampling',
      samples: sampleYears,
      blockSize: 3,
      numYears: 50,
      numSimulations: 1,
      seed: 42,
    });
    const rng = createRng(deriveSeed(params.seed, 0));
    const path = simulatePath(params, rng, true);
    expect(Number.isFinite(path.finalBalance)).toBe(true);
    expect(path.path.returns.length).toBe(params.numYears);

    const sampleReturns = sampleYears.years.map((y) =>
      (y.us_lg_growth * baseAllocation.usLgGrowth +
        y.us_lg_value * baseAllocation.usLgValue +
        y.us_sm_mid * baseAllocation.usSmMid +
        y.ex_us * baseAllocation.exUs +
        y.bond * baseAllocation.bond +
        y.cash * baseAllocation.cash) /
      100
    );
    for (const r of path.path.returns) {
      expect(sampleReturns.some((sr) => Math.abs(sr - r) < 1e-9)).toBe(true);
    }
  });
});

function profilesFromSampleYears(years) {
  const profiles = computeProfiles(years);
  return {
    usLgGrowth: { mean: profiles.us_lg_growth.mean / 100, stdDev: profiles.us_lg_growth.stdDev / 100 },
    usLgValue: { mean: profiles.us_lg_value.mean / 100, stdDev: profiles.us_lg_value.stdDev / 100 },
    usSmMid: { mean: profiles.us_sm_mid.mean / 100, stdDev: profiles.us_sm_mid.stdDev / 100 },
    exUs: { mean: profiles.ex_us.mean / 100, stdDev: profiles.ex_us.stdDev / 100 },
    bond: { mean: profiles.bond.mean / 100, stdDev: profiles.bond.stdDev / 100 },
    cash: { mean: profiles.cash.mean / 100, stdDev: profiles.cash.stdDev / 100 },
    inflation: { mean: profiles.inflation.mean / 100, stdDev: profiles.inflation.stdDev / 100 },
    chol: null,
  };
}

describe('smoothed historical simulation', () => {
  it('runs and produces finite results', () => {
    const params = lognormalParams({
      distMethod: 'scaledHistorical',
      samples: sampleYears,
      scaledHistoricalShocks: computeStandardizedYears(sampleYears.years),
      scaledHistoricalSmoothing: 0.35,
      logNormal: profilesFromSampleYears(sampleYears.years),
      blockSize: 1,
      numSimulations: 500,
    });
    const result = runMonteCarlo(params);
    expect(result.avgReturn.length).toBe(500);
    expect(Number.isFinite(result.finalBalance[0])).toBe(true);
  });

  it('matches resampling when targets equal the sample historical profiles and smoothing is off', () => {
    const logNormal = profilesFromSampleYears(sampleYears.years);
    const base = {
      numYears: 30,
      blockSize: 3,
      seed: 99,
      allocation: baseAllocation,
      logNormal,
      portfolio: lognormalParams().portfolio,
      dynConfig: baseDynConfig,
      samples: sampleYears,
      scaledHistoricalShocks: computeStandardizedYears(sampleYears.years),
      scaledHistoricalSmoothing: 0,
    };

    const resampleRng = createRng(deriveSeed(base.seed, 0));
    const scaledRng = createRng(deriveSeed(base.seed, 0));
    const resamplePath = simulatePath({ ...base, distMethod: 'resampling' }, resampleRng, true);
    const scaledPath = simulatePath({ ...base, distMethod: 'scaledHistorical' }, scaledRng, true);

    for (let i = 0; i < base.numYears; i++) {
      expect(scaledPath.path.returns[i]).toBeCloseTo(resamplePath.path.returns[i], 10);
    }
  });

  it('adds jitter when smoothing is on without biasing the mean', () => {
    const logNormal = profilesFromSampleYears(sampleYears.years);
    const sampleReturns = sampleYears.years.map((y) =>
      (y.us_lg_growth * baseAllocation.usLgGrowth +
        y.us_lg_value * baseAllocation.usLgValue +
        y.us_sm_mid * baseAllocation.usSmMid +
        y.ex_us * baseAllocation.exUs +
        y.bond * baseAllocation.bond +
        y.cash * baseAllocation.cash) /
      100
    );
    const base = {
      numYears: 500,
      blockSize: 1,
      seed: 42,
      allocation: baseAllocation,
      logNormal,
      portfolio: lognormalParams().portfolio,
      dynConfig: baseDynConfig,
      samples: sampleYears,
      scaledHistoricalShocks: computeStandardizedYears(sampleYears.years),
      scaledHistoricalSmoothing: 0.35,
    };

    const rng = createRng(deriveSeed(base.seed, 0));
    const path = simulatePath({ ...base, distMethod: 'scaledHistorical' }, rng, true);

    let differsFromDiscrete = false;
    for (const r of path.path.returns) {
      if (!sampleReturns.some((sr) => Math.abs(sr - r) < 1e-9)) {
        differsFromDiscrete = true;
        break;
      }
    }
    expect(differsFromDiscrete).toBe(true);

    const avg =
      path.path.returns.reduce((a, b) => a + b, 0) / path.path.returns.length;
    expect(avg).toBeCloseTo(logNormal.usLgGrowth.mean * baseAllocation.usLgGrowth +
      logNormal.usLgValue.mean * baseAllocation.usLgValue +
      logNormal.usSmMid.mean * baseAllocation.usSmMid +
      logNormal.exUs.mean * baseAllocation.exUs +
      logNormal.bond.mean * baseAllocation.bond +
      logNormal.cash.mean * baseAllocation.cash, 1);
  });

  it('shifts average return when target mean is shifted', () => {
    const historical = profilesFromSampleYears(sampleYears.years);
    const shifted = {
      ...historical,
      usLgGrowth: {
        mean: historical.usLgGrowth.mean + 0.02,
        stdDev: historical.usLgGrowth.stdDev,
      },
    };
    const base = {
      numYears: 200,
      blockSize: 1,
      seed: 77,
      allocation: { ...baseAllocation, usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      portfolio: lognormalParams().portfolio,
      dynConfig: baseDynConfig,
      samples: sampleYears,
      scaledHistoricalShocks: computeStandardizedYears(sampleYears.years),
      scaledHistoricalSmoothing: 0,
    };

    const histRng = createRng(deriveSeed(base.seed, 0));
    const shiftRng = createRng(deriveSeed(base.seed, 0));
    const histPath = simulatePath(
      { ...base, distMethod: 'scaledHistorical', logNormal: historical },
      histRng,
      true,
    );
    const shiftPath = simulatePath(
      { ...base, distMethod: 'scaledHistorical', logNormal: shifted },
      shiftRng,
      true,
    );

    const histAvg =
      histPath.path.returns.reduce((a, b) => a + b, 0) / histPath.path.returns.length;
    const shiftAvg =
      shiftPath.path.returns.reduce((a, b) => a + b, 0) / shiftPath.path.returns.length;
    expect(shiftAvg - histAvg).toBeCloseTo(0.02, 2);
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

describe('front-loaded spending', () => {
  // Deterministic engine: zero-variance, zero-return assets and no dynamic
  // adjustment, so each year's withdrawal is purely base * ageFactor (+bonus).
  function flatParams() {
    return {
      numYears: 10,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        start: 1e9, base: 100_000, floorBalance: 0, floorPenalty: 0,
        ceilingBalance: Infinity, ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]),
      },
      dynConfig: {
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
    };
  }

  it('leaves withdrawals flat with neutral defaults', () => {
    const s = simulatePath(flatParams(), createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals.every((w) => Math.abs(w - 100_000) < 1e-6)).toBe(true);
  });

  it('declines withdrawals over time with a negative annual real change', () => {
    const p = flatParams();
    p.portfolio.spendingOverTimeSeries = spendingSeries(10, [{ changePct: -10, extra: 0 }]);
    const w = simulatePath(p, createRng(deriveSeed(1, 0)), true).path.withdrawals;
    expect(w[0]).toBeCloseTo(100_000, 3);
    expect(w[1]).toBeCloseTo(90_000, 3);
    expect(w[0]).toBeGreaterThan(w[9]);
  });

  it('adds a flat bonus only during the early years', () => {
    const p = flatParams();
    p.portfolio.spendingOverTimeSeries = spendingSeries(10, [
      { changePct: 0, extra: 50_000, years: 3 },
      { changePct: 0, extra: 0 },
    ]);
    const w = simulatePath(p, createRng(deriveSeed(1, 0)), true).path.withdrawals;
    expect(w[0]).toBeCloseTo(150_000, 3);
    expect(w[2]).toBeCloseTo(150_000, 3);
    expect(w[3]).toBeCloseTo(100_000, 3);
  });

  it('enforces a minimum withdrawal floor regardless of adjustments', () => {
    const p = flatParams();
    p.portfolio.base = 50_000;
    p.portfolio.withdrawalFloorSeries = Array(10).fill(80_000);
    const w = simulatePath(p, createRng(deriveSeed(1, 0)), true).path.withdrawals;
    expect(w[0]).toBeCloseTo(80_000, 3);
  });

  it('applies staged minimum withdrawal tiers by year index', () => {
    const p = flatParams();
    p.portfolio.base = 40_000;
    p.portfolio.withdrawalFloorSeries = [80_000, 80_000, 80_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000];
    const w = simulatePath(p, createRng(deriveSeed(1, 0)), true).path.withdrawals;
    expect(w[2]).toBeCloseTo(80_000, 3);
    expect(w[3]).toBeCloseTo(60_000, 3);
  });
});

describe('early-years withdrawal window (Goal Seek objective)', () => {
  // Deterministic engine: zero-variance, zero-return assets, so each year's
  // withdrawal is purely base * ageFactor (+bonus), same as 'front-loaded
  // spending' above.
  function flatParams(overrides = {}) {
    return {
      numYears: 10,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        start: 1e9, base: 100_000, floorBalance: 0, floorPenalty: 0,
        ceilingBalance: Infinity, ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]),
      },
      dynConfig: {
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
      ...overrides,
    };
  }

  it('sums only the withdrawals within the window when earlyYearsWindow is set', () => {
    const s = simulatePath(flatParams({ earlyYearsWindow: 3 }), createRng(deriveSeed(1, 0)), false);
    expect(s.earlyWithdrawn).toBeCloseTo(300_000, 3);
    expect(s.totalWithdrawn).toBeCloseTo(1_000_000, 3);
  });

  it('counts a flat bonus toward the early window when it falls inside it', () => {
    const p = flatParams({ earlyYearsWindow: 3 });
    p.portfolio.spendingOverTimeSeries = spendingSeries(10, [
      { changePct: 0, extra: 50_000, years: 3 },
      { changePct: 0, extra: 0 },
    ]);
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), false);
    expect(s.earlyWithdrawn).toBeCloseTo(450_000, 3);
  });

  it('defaults to zero early-withdrawn when no window is given', () => {
    const s = simulatePath(flatParams(), createRng(deriveSeed(1, 0)), false);
    expect(s.earlyWithdrawn).toBe(0);
  });

  it('runMonteCarlo packs earlyWithdrawn per simulation', () => {
    const result = runMonteCarlo(flatParams({ earlyYearsWindow: 5, numSimulations: 10 }));
    expect(result.earlyWithdrawn.length).toBe(10);
    for (const value of result.earlyWithdrawn) {
      expect(value).toBeCloseTo(500_000, 3);
    }
  });
});

describe('balance-based spending scale', () => {
  // Deterministic engine (zero-variance, zero-return assets) with dynamic
  // adjustments enabled but neutral anchors, so only the scale acts.
  function scaleParams() {
    return {
      numYears: 1,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        start: 1_000_000, base: 100_000, floorBalance: 2_000_000, floorPenalty: 0.5,
        ceilingBalance: Infinity, ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]), withdrawalFloorSeries: [0],
      },
      dynConfig: {
        enabled: true,
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
    };
  }

  it('ramps spending down below the floor', () => {
    // Balance $1M with a $2M floor -> multiplier 1 - 0.5 * 0.5 = 0.75.
    const s = simulatePath(scaleParams(), createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(75_000, 3);
  });

  it('never scales below the minimum withdrawal backstop', () => {
    const p = scaleParams();
    p.portfolio.floorPenalty = 1; // multiplier 0.5 -> 50k target...
    p.portfolio.withdrawalFloorSeries = [60_000];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(60_000, 3);
  });

  it('ramps spending up above the ceiling with no cap', () => {
    const p = scaleParams();
    p.portfolio.start = 10_000_000;
    p.portfolio.floorBalance = 0;
    p.portfolio.ceilingBalance = 5_000_000;
    p.portfolio.ceilingBonus = 0.5; // 10M = 2x ceiling -> multiplier 1.5
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(150_000, 3);
  });

  it('keeps the unadjusted plan free of scaling', () => {
    const s = simulatePath(scaleParams(), createRng(deriveSeed(1, 0)), true);
    expect(s.path.unadjustedWithdrawals[0]).toBeCloseTo(100_000, 3);
  });
});

describe('deposits from negative withdrawals', () => {
  function flatParams() {
    return {
      numYears: 2,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        strategy: 'specific',
        specificWithdrawals: [],
        start: 1_000_000,
        base: 0,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]),
        withdrawalFloorSeries: [0, 0],
      },
      dynConfig: { enabled: false, low: { ret: 0, bal: 0, adj: 0 }, med: { ret: 0, bal: 0, adj: 0 }, high: { ret: 0, bal: 0, adj: 0 } },
      samples: null,
    };
  }

  it('adds to balance when a specific-list amount is negative', () => {
    const p = flatParams();
    p.portfolio.specificWithdrawals = [-50_000, 100_000];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(-50_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(1_050_000, 3);
    expect(s.path.withdrawals[1]).toBeCloseTo(100_000, 3);
    expect(s.path.balances[2]).toBeCloseTo(950_000, 3);
  });

  it('skips the withdrawal floor when the target is a deposit', () => {
    const p = flatParams();
    p.numYears = 1;
    p.portfolio.specificWithdrawals = [-100_000];
    p.portfolio.withdrawalFloorSeries = [80_000];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(-100_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(1_100_000, 3);
  });

  it('enforces a percentage minimum floor on a specific-list withdrawal', () => {
    const p = flatParams();
    p.numYears = 1;
    p.portfolio.specificWithdrawals = [100_000];
    p.portfolio.withdrawalFloorSeries = [80_000];
    p.dynConfig.enabled = true;
    p.dynConfig.low = { ret: 0, bal: 0, adj: -50_000 };
    p.dynConfig.med = { ret: 0, bal: 0, adj: -50_000 };
    p.dynConfig.high = { ret: 0, bal: 0, adj: -50_000 };
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    // Target would be 50k after adjustment, but 80% floor raises it to 80k.
    expect(s.path.withdrawals[0]).toBeCloseTo(80_000, 3);
  });

  it('skips percentage minimum floor on a deposit year', () => {
    const p = flatParams();
    p.numYears = 1;
    p.portfolio.specificWithdrawals = [-100_000];
    p.portfolio.withdrawalFloorSeries = [0];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(-100_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(1_100_000, 3);
  });

  it('reuses the last list value for years beyond the pasted list', () => {
    const p = flatParams();
    p.numYears = 4;
    p.portfolio.specificWithdrawals = [50_000, 60_000];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.unadjustedWithdrawals).toEqual([50_000, 60_000, 60_000, 60_000]);
  });

  it('prevents dynamic adjustments from turning a withdrawal into a deposit', () => {
    const p = flatParams();
    p.numYears = 1;
    p.portfolio.strategy = 'base';
    p.portfolio.base = 50_000;
    p.dynConfig.enabled = true;
    p.dynConfig.low = { ret: 0, bal: 0, adj: -100_000 };
    p.dynConfig.med = { ret: 0, bal: 0, adj: -100_000 };
    p.dynConfig.high = { ret: 0, bal: 0, adj: -100_000 };
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    // Adjustment is -100k, base is +50k. Target would be -50k, but should clamp to 0.
    expect(s.path.withdrawals[0]).toBeCloseTo(0, 3);
    expect(s.path.balances[1]).toBeCloseTo(1_000_000, 3);
  });
});

describe('simulatePath path mode', () => {
  it('omits path arrays when collectPath is false', () => {
    const s = simulatePath(lognormalParams(), createRng(deriveSeed(123, 0)), false);
    expect(s.path).toBeUndefined();
    expect(typeof s.finalBalance).toBe('number');
  });

  it('writes per-year real returns into an output buffer when provided', () => {
    const params = lognormalParams({ numYears: 5 });
    const out = new Float64Array(5);
    simulatePath(params, createRng(deriveSeed(123, 0)), false, out, 0);
    expect(out.length).toBe(5);
    expect(out.every((r) => Number.isFinite(r))).toBe(true);
  });
});

describe('variable horizon', () => {
  it('draws per-run horizons inside the typed +/- range', () => {
    const params = lognormalParams({
      numYears: 30,
      maxYears: 35,
      horizonRange: { endpoint: 30, plus: 5, minus: 5 },
      numSimulations: 500,
    });
    const result = runMonteCarlo(params);
    const horizons = Array.from(result.horizonYears);
    expect(horizons.every((h) => h >= 25 && h <= 35)).toBe(true);
    expect(new Set(horizons).size).toBeGreaterThan(1);
  });

  it('regeneratePath matches the stored horizon and summary stats', () => {
    const params = lognormalParams({
      numYears: 30,
      maxYears: 33,
      horizonRange: { endpoint: 30, plus: 3, minus: 2 },
    });
    const result = runMonteCarlo(params);
    const re = regeneratePath(params, result.baseSeed, 7);
    expect(re.horizonYears).toBe(result.horizonYears[7]);
    expect(re.totalWithdrawn).toBeCloseTo(result.totalWithdrawn[7], 4);
    expect(re.path.balances.length).toBe(re.horizonYears + 1);
  });

  it('does not consume an extra RNG draw when the range is disabled (seed compatibility)', () => {
    const fixed = lognormalParams({ numYears: 20, numSimulations: 100, seed: 999 });
    const withZeroRange = lognormalParams({
      numYears: 20,
      maxYears: 20,
      horizonRange: { endpoint: 20, plus: 0, minus: 0 },
      numSimulations: 100,
      seed: 999,
    });
    const a = runMonteCarlo(fixed);
    const b = runMonteCarlo(withZeroRange);
    expect(Array.from(a.totalWithdrawn)).toEqual(Array.from(b.totalWithdrawn));
  });

  it('pads unused years in allYearsReturns with NaN', () => {
    const params = lognormalParams({
      numYears: 20,
      maxYears: 24,
      horizonRange: { endpoint: 20, plus: 4, minus: 0 },
      numSimulations: 50,
    });
    const result = runMonteCarlo(params);
    expect(result.allYearsReturns.length).toBe(50 * 24);
    let sawNaN = false;
    let sawFinite = false;
    for (const v of result.allYearsReturns) {
      if (Number.isNaN(v)) sawNaN = true;
      else sawFinite = true;
    }
    expect(sawNaN).toBe(true);
    expect(sawFinite).toBe(true);
  });
});

describe('minimum withdrawal vs plan', () => {
  function flatParams(overrides = {}) {
    return {
      numYears: 1,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        start: 1e9,
        base: 50_000,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]),
        withdrawalFloorSeries: [80_000],
      },
      dynConfig: {
        enabled: false,
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
      ...overrides,
    };
  }

  it('keeps the unadjusted plan at the schedule while the floor raises actual spending', () => {
    const s = simulatePath(flatParams(), createRng(deriveSeed(1, 0)), true);
    expect(s.path.unadjustedWithdrawals[0]).toBeCloseTo(50_000, 3);
    expect(s.path.withdrawals[0]).toBeCloseTo(80_000, 3);
  });
});

describe('consecutive-min recovery', () => {
  function recoveryParams(overrides = {}) {
    return {
      numYears: 4,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        start: 1_000_000,
        base: 100_000,
        floorBalance: 2_000_000,
        floorPenalty: 0.5,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]),
        withdrawalFloorSeries: [80_000, 80_000, 80_000, 80_000],
        maxConsecutiveMinWithdrawals: 2,
        minWithdrawalPlanRecoveryYears: 2,
      },
      dynConfig: {
        enabled: true,
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
      ...overrides,
    };
  }

  it('forces spending back to the plan after consecutive minimum years', () => {
    const s = simulatePath(recoveryParams(), createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(80_000, 3);
    expect(s.path.withdrawals[1]).toBeCloseTo(80_000, 3);
    expect(s.path.withdrawals[2]).toBeCloseTo(100_000, 3);
    expect(s.path.withdrawals[3]).toBeCloseTo(100_000, 3);
  });

  it('is a no-op when recovery knobs are zero', () => {
    const p = recoveryParams();
    p.portfolio.maxConsecutiveMinWithdrawals = 0;
    p.portfolio.minWithdrawalPlanRecoveryYears = 0;
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals.every((w) => w === 80_000)).toBe(true);
  });

  it('caps forced-plan spending at the remaining balance', () => {
    const p = recoveryParams({ numYears: 3 });
    p.portfolio.start = 150_000;
    p.portfolio.maxConsecutiveMinWithdrawals = 1;
    p.portfolio.minWithdrawalPlanRecoveryYears = 1;
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(80_000, 3);
    expect(s.path.withdrawals[1]).toBeCloseTo(70_000, 3);
  });

  it('does not count deposit years toward the consecutive-min streak', () => {
    const p = recoveryParams({ numYears: 4 });
    p.portfolio.strategy = 'specific';
    p.portfolio.specificWithdrawals = [-50_000, 100_000, 100_000, 100_000];
    p.portfolio.base = 0;
    p.portfolio.start = 1_000_000;
    p.portfolio.floorBalance = 5_000_000;
    p.portfolio.floorPenalty = 0.5;
    p.portfolio.withdrawalFloorSeries = [0, 80_000, 80_000, 80_000];
    p.dynConfig.enabled = true;
    p.dynConfig.low = { ret: -100, bal: 0, adj: 0 };
    p.dynConfig.med = { ret: 0, bal: 1e12, adj: 0 };
    p.dynConfig.high = { ret: 100, bal: 1e12, adj: 0 };
    p.portfolio.maxConsecutiveMinWithdrawals = 2;
    p.portfolio.minWithdrawalPlanRecoveryYears = 1;
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(-50_000, 3);
    expect(s.path.withdrawals[1]).toBeCloseTo(80_000, 3);
    expect(s.path.withdrawals[2]).toBeCloseTo(80_000, 3);
    expect(s.path.withdrawals[3]).toBeCloseTo(100_000, 3);
  });
});

describe('tiered gifting', () => {
  function giftingParams(overrides = {}) {
    return {
      numYears: 2,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: {
        usLgGrowth: { mean: 0, stdDev: 0 },
        usLgValue: { mean: 0, stdDev: 0 },
        usSmMid: { mean: 0, stdDev: 0 },
        exUs: { mean: 0, stdDev: 0 },
        bond: { mean: 0, stdDev: 0 },
        cash: { mean: 0, stdDev: 0 },
        inflation: { mean: 0, stdDev: 0 },
        chol: null,
      },
      portfolio: {
        start: 3_000_000,
        base: 100_000,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
        spendingOverTimeSeries: spendingSeries(10, [{ changePct: 0, extra: 0 }]),
        withdrawalFloorSeries: [0, 0],
        giftingSeries: [
          { amount: 50_000, balanceThreshold: 2_000_000 },
          { amount: 50_000, balanceThreshold: 2_000_000 },
        ],
      },
      dynConfig: {
        enabled: false,
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
      ...overrides,
    };
  }

  it('adds a gift when balance exceeds the threshold and the plan was fully met', () => {
    const s = simulatePath(giftingParams(), createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(150_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(2_850_000, 3);
  });

  it('skips the gift when balance does not exceed the threshold', () => {
    const p = giftingParams();
    p.portfolio.start = 2_050_000;
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(100_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(1_950_000, 3);
  });

  it('skips the gift when guardrail scaling cuts spending below the plan', () => {
    const p = giftingParams({ numYears: 1 });
    p.portfolio.start = 2_500_000;
    p.portfolio.floorBalance = 3_000_000;
    p.portfolio.floorPenalty = 0.5;
    p.dynConfig.enabled = true;
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(91_666.667, 2);
    expect(s.path.unadjustedWithdrawals[0]).toBeCloseTo(100_000, 3);
  });

  it('skips the gift when only the minimum floor was met, not the plan', () => {
    const p = giftingParams({ numYears: 1 });
    p.portfolio.start = 3_000_000;
    p.portfolio.withdrawalFloorSeries = [80_000];
    p.dynConfig.enabled = true;
    p.dynConfig.low = { ret: 0, bal: 0, adj: -50_000 };
    p.dynConfig.med = { ret: 0, bal: 0, adj: -50_000 };
    p.dynConfig.high = { ret: 0, bal: 0, adj: -50_000 };
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(80_000, 3);
    expect(s.path.unadjustedWithdrawals[0]).toBeCloseTo(100_000, 3);
  });

  it('caps the gift at the remaining balance', () => {
    const p = giftingParams({ numYears: 1 });
    p.portfolio.start = 130_000;
    p.portfolio.base = 100_000;
    p.portfolio.giftingSeries = [{ amount: 50_000, balanceThreshold: 10_000 }];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(130_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(0, 3);
  });

  it('applies staged gifting tiers by year index', () => {
    const p = giftingParams();
    p.portfolio.giftingSeries = [
      { amount: 30_000, balanceThreshold: 1_000_000 },
      { amount: 10_000, balanceThreshold: 1_000_000 },
    ];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(130_000, 3);
    expect(s.path.withdrawals[1]).toBeCloseTo(110_000, 3);
  });

  it('applies gifting under the Specific List strategy', () => {
    const p = giftingParams({ numYears: 1 });
    p.portfolio.strategy = 'specific';
    p.portfolio.specificWithdrawals = [80_000];
    p.portfolio.giftingSeries = [{ amount: 20_000, balanceThreshold: 2_000_000 }];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(100_000, 3);
  });

  it('applies gifting in deposit years when the post-deposit balance exceeds the threshold', () => {
    const p = giftingParams({ numYears: 1 });
    p.portfolio.strategy = 'specific';
    p.portfolio.specificWithdrawals = [-50_000];
    p.portfolio.start = 2_500_000;
    p.portfolio.giftingSeries = [{ amount: 30_000, balanceThreshold: 2_000_000 }];
    const s = simulatePath(p, createRng(deriveSeed(1, 0)), true);
    expect(s.path.withdrawals[0]).toBeCloseTo(-20_000, 3);
    expect(s.path.balances[1]).toBeCloseTo(2_520_000, 3);
  });

  it('defers gifting during zero-gift placeholder tiers', () => {
    const p = giftingParams({ numYears: 4 });
    p.portfolio.giftingSeries = [
      { amount: 0, balanceThreshold: 0 },
      { amount: 0, balanceThreshold: 0 },
      { amount: 50_000, balanceThreshold: 2_000_000 },
      { amount: 50_000, balanceThreshold: 2_000_000 },
    ];
    const w = simulatePath(p, createRng(deriveSeed(1, 0)), true).path.withdrawals;
    expect(w[0]).toBeCloseTo(100_000, 3);
    expect(w[1]).toBeCloseTo(100_000, 3);
    expect(w[2]).toBeCloseTo(150_000, 3);
    expect(w[3]).toBeCloseTo(150_000, 3);
  });
});
