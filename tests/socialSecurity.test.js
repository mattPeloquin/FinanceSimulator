import { describe, it, expect } from 'vitest';
import {
  fraFromBirthYear,
  ownBenefitAtClaimAge,
  spousalAddonMonthly,
  estimatePiaFromEarnings,
  buildBenefitCashflow,
  evaluateStrategy,
  evaluateClaimGrid,
  summarizeEndAgeStrip,
  breakEvenEndAge,
  runDeterministicSsAnalysis,
  DEFAULT_END_AGES,
} from '../src/core/socialSecurity.js';
import {
  drawTaxRateShock,
  createBenefitCutSchedule,
  applyPolicyShocksToBenefits,
} from '../src/core/policyShocks.js';
import { simulateBridgePath, runBridgeMonteCarlo } from '../src/core/accumulation.js';
import { buildSamplesAndProfiles, defaultReturnsAllocationSlice, ALLOCATION_PCT_KEYS } from '../src/state/returnsAllocationSlice.js';
import { profilesToLogNormal, correlationCholesky } from '../src/core/history.js';
import { allocationFromConfig } from '../src/core/accumulation.js';
import { createRng } from '../src/core/rng.js';

describe('socialSecurity core', () => {
  it('computes FRA from birth year', () => {
    expect(fraFromBirthYear(1960)).toBe(67);
    expect(fraFromBirthYear(1954)).toBe(66);
  });

  it('reduces own benefit when claiming early and credits delay', () => {
    const pia = 2000;
    const fra = 67;
    const at62 = ownBenefitAtClaimAge(pia, 62, fra);
    const atFra = ownBenefitAtClaimAge(pia, 67, fra);
    const at70 = ownBenefitAtClaimAge(pia, 70, fra);
    expect(at62).toBeLessThan(atFra);
    expect(atFra).toBeCloseTo(pia, 5);
    expect(at70).toBeGreaterThan(atFra);
  });

  it('computes simplified spousal add-on', () => {
    const addon = spousalAddonMonthly(1000, 3000, 67, 67);
    expect(addon).toBeCloseTo(500, 5); // 0.5*3000 - 1000
    const none = spousalAddonMonthly(2000, 3000, 67, 67);
    expect(none).toBe(0);
  });

  it('estimates PIA from earnings via bend points', () => {
    const grid = [];
    for (let age = 25; age <= 60; age++) {
      grid.push({ age, earnings: 60000 });
    }
    const { piaMonthly, yearsUsed } = estimatePiaFromEarnings(grid);
    expect(yearsUsed).toBeGreaterThan(30);
    expect(piaMonthly).toBeGreaterThan(1000);
  });

  it('applies survivor step-up after one spouse dies', () => {
    const flow = buildBenefitCashflow(
      { piaMonthly: 3000, claimAge: 67, fra: 67, endAge: 80 },
      { piaMonthly: 1000, claimAge: 62, fra: 67, endAge: 95 },
    );
    // After A dies at 80, B should receive max(own+spousal, A's package).
    const idxAfter = flow.years.indexOf(81);
    expect(idxAfter).toBeGreaterThan(-1);
    expect(flow.byPerson.B[idxAfter]).toBeGreaterThan(0);
    expect(flow.byPerson.A[idxAfter]).toBe(0);
    expect(flow.lifetime).toBeGreaterThan(0);
  });

  it('ranks strategies on an end-age strip and can flip', () => {
    const personA = { piaMonthly: 2500, fra: 67, claimAge: 67 };
    const early = evaluateStrategy({ id: 'early', claimA: 62 }, personA, null, DEFAULT_END_AGES);
    const late = evaluateStrategy({ id: 'late', claimA: 70 }, personA, null, DEFAULT_END_AGES);
    const strip = summarizeEndAgeStrip([early, late], DEFAULT_END_AGES);
    expect(strip.byEndAge[80].winner).toBeTruthy();
    expect(strip.byEndAge[95].winner).toBeTruthy();
  });

  it('builds a claim-age grid for singles and couples', () => {
    const a = { piaMonthly: 2000, fra: 67 };
    const single = evaluateClaimGrid(a, null, [90]);
    expect(single.cells.length).toBe(9); // 62..70
    const couple = evaluateClaimGrid(a, { piaMonthly: 1500, fra: 67 }, [90]);
    expect(couple.cells.length).toBe(81);
  });

  it('finds a break-even end age between early and delay', () => {
    const a = { piaMonthly: 2500, fra: 67 };
    const be = breakEvenEndAge(
      { id: 'early', claimA: 62 },
      { id: 'delay70', claimA: 70 },
      a,
      null,
      { scanFrom: 70, scanTo: 100 },
    );
    expect(be).toBeTruthy();
    expect(be.endAge).toBeGreaterThanOrEqual(70);
  });

  it('runs a full deterministic analysis for a couple', () => {
    const result = runDeterministicSsAnalysis({
      couple: true,
      personA: { piaMonthly: 2800, birthYear: 1960, claimAge: 70 },
      personB: { piaMonthly: 1800, birthYear: 1962, claimAge: 62 },
      endAges: [80, 85, 90, 95],
    });
    expect(result.strategies.length).toBeGreaterThanOrEqual(4);
    expect(result.grid.cells.length).toBe(81);
    expect(result.strip.byEndAge[90].winner).toBeTruthy();
  });
});

describe('policyShocks', () => {
  it('draws tax rates near the base with CRN stability', () => {
    const a = drawTaxRateShock(42, 0, { baseRate: 0.15, noiseStd: 0.02 });
    const b = drawTaxRateShock(42, 0, { baseRate: 0.15, noiseStd: 0.02 });
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(0.6);
  });

  it('applies discrete benefit cuts', () => {
    const sched = createBenefitCutSchedule(1, 0, {
      mode: 'discrete',
      cutFraction: 0.2,
      cutYearIndex: 2,
      jitterYears: 0,
    });
    expect(sched(0)).toBe(1);
    expect(sched(2)).toBeCloseTo(0.8, 5);
    const after = applyPolicyShocksToBenefits([100, 100, 100], 0.1, sched);
    expect(after[0]).toBeCloseTo(90, 5);
    expect(after[2]).toBeCloseTo(72, 5);
  });
});

describe('bridge portfolio', () => {
  function marketParams() {
    const slice = defaultReturnsAllocationSlice({ startYear: 1990, endYear: 2010 });
    const { samples, profiles } = buildSamplesAndProfiles(slice, { forceProfiles: true });
    const logNormal = profilesToLogNormal(profiles);
    logNormal.chol = correlationCholesky(samples.years);
    return {
      seed: 7,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: allocationFromConfig(slice.allocation, ALLOCATION_PCT_KEYS),
      allocationKeys: ALLOCATION_PCT_KEYS,
      samples,
      logNormal,
      numSimulations: 50,
      numYears: 5,
      startBalance: 200000,
      bridgeSpend: 30000,
    };
  }

  it('simulates a single bridge path', () => {
    const path = simulateBridgePath(marketParams(), createRng(1));
    expect(path.balancesByYear.length).toBe(6);
    expect(path.endingBalance).toBeGreaterThanOrEqual(0);
  });

  it('runs bridge Monte Carlo with success rate', () => {
    const raw = runBridgeMonteCarlo(marketParams());
    expect(raw.numSimulations).toBe(50);
    expect(raw.ending.p50).toBeGreaterThanOrEqual(0);
    expect(raw.successRate).toBeGreaterThanOrEqual(0);
    expect(raw.successRate).toBeLessThanOrEqual(1);
  });
});
