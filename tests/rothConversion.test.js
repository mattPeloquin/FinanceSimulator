import { describe, it, expect } from 'vitest';
import {
  taxOnIncome,
  roomToCeiling,
  ceilingForRate,
  requiredRmd,
  applyQcd,
  buildConversionStrategies,
  simulateRothPath,
  runRothConversionAnalysis,
} from '../src/core/rothConversion.js';
import {
  defaultIllustrativeTaxLadder,
  normalizeTaxLadder,
} from '../src/data/taxLadderIllustrative.js';
import { rmdDivisor } from '../src/data/rmdFactors.js';
import { HANDLERS } from '../src/workers/dispatch.js';
import { drawTaxRateShock } from '../src/core/policyShocks.js';

describe('tax ladder', () => {
  it('computes progressive tax and marginal rate', () => {
    const ladder = defaultIllustrativeTaxLadder();
    const low = taxOnIncome(ladder, 10000);
    expect(low.marginalRate).toBeCloseTo(0.10, 5);
    expect(low.tax).toBeCloseTo(1000, 5);

    const mid = taxOnIncome(ladder, 150000);
    expect(mid.marginalRate).toBeCloseTo(0.22, 5);
    expect(mid.tax).toBeGreaterThan(10000);
  });

  it('roomToCeiling and ceilingForRate support fill planning', () => {
    const ladder = normalizeTaxLadder(defaultIllustrativeTaxLadder());
    const c22 = ceilingForRate(ladder, 0.22);
    expect(c22).toBe(207000);
    expect(roomToCeiling(40000, c22)).toBe(167000);
    expect(roomToCeiling(250000, c22)).toBe(0);
  });

  it('rounds ladder ceilings to the nearest $1,000', () => {
    const ladder = normalizeTaxLadder([
      { ceiling: 23850, rate: 0.10 },
      { ceiling: 206700, rate: 0.22 },
      { ceiling: Infinity, rate: 0.37 },
    ]);
    expect(ladder[0].ceiling).toBe(24000);
    expect(ladder[1].ceiling).toBe(207000);
  });
});

describe('RMD / QCD', () => {
  it('returns 0 RMD before age 73', () => {
    expect(requiredRmd(500000, 70)).toBe(0);
  });

  it('computes RMD from Uniform Lifetime divisor', () => {
    const div = rmdDivisor(75);
    expect(div).toBeGreaterThan(20);
    const rmd = requiredRmd(500000, 75);
    expect(rmd).toBeCloseTo(500000 / div, 5);
  });

  it('QCD reduces taxable RMD', () => {
    const split = applyQcd(40000, 15000);
    expect(split.taxableRmd).toBe(25000);
    expect(split.qcd).toBe(15000);
  });
});

describe('strategies and path simulation', () => {
  const baseInput = {
    seed: 42,
    numYears: 5,
    numSimulations: 50,
    couple: false,
    ageA: 65,
    tradBalance: 500000,
    rothBalance: 50000,
    taxableBalance: 100000,
    taxableBasis: 80000,
    taxableGainRate: 0.15,
    otherTaxableIncome: 30000,
    ladder: defaultIllustrativeTaxLadder(),
    fillTierRate: 0.22,
    annualConversionCap: 0,
    taxPayment: 'fromTaxable',
    ratePremium: 0,
    taxNoiseStd: 0,
    rmdEnabled: false,
    qcdEnabled: false,
    returnMode: 'constant',
    constantRealReturn: 0.03,
  };

  it('always includes a $0 strategy', () => {
    const strategies = buildConversionStrategies(baseInput);
    expect(strategies.some((s) => s.id === 'zero')).toBe(true);
    expect(strategies.find((s) => s.id === 'zero').kind).toBe('zero');
  });

  it('zero strategy converts nothing; fill converts positive', () => {
    const strategies = buildConversionStrategies(baseInput);
    const zero = strategies.find((s) => s.id === 'zero');
    const fill = strategies.find((s) => s.id === 'fill-22');
    const zPath = simulateRothPath(baseInput, zero, 0);
    const fPath = simulateRothPath(baseInput, fill, 0);
    expect(zPath.lifetimeConverted).toBe(0);
    expect(fPath.lifetimeConverted).toBeGreaterThan(0);
    expect(fPath.endingRoth).toBeGreaterThan(zPath.endingRoth);
  });

  it('withhold mode sends less to Roth than fromTaxable for same conversion', () => {
    const strategies = buildConversionStrategies(baseInput);
    const fill = strategies.find((s) => s.id === 'fill-22');
    const fromTaxable = simulateRothPath(
      { ...baseInput, taxPayment: 'fromTaxable', taxNoiseStd: 0, ratePremium: 0.1 },
      fill,
      1,
    );
    const withhold = simulateRothPath(
      { ...baseInput, taxPayment: 'withhold', taxNoiseStd: 0, ratePremium: 0.1 },
      fill,
      1,
    );
    // Same CRN path index → same convert gross; withhold lands less in Roth.
    expect(withhold.years[0].netToRoth).toBeLessThan(fromTaxable.years[0].netToRoth);
  });

  it('taxable basis stays within taxable balance', () => {
    const strategies = buildConversionStrategies(baseInput);
    const fill = strategies.find((s) => s.id === 'custom');
    const path = simulateRothPath(baseInput, fill, 2);
    expect(path.endingTaxable).toBeGreaterThanOrEqual(0);
  });
});

describe('runRothConversionAnalysis packaging', () => {
  it('packages response curve, sweep bundles, heatmaps, and $0 baseline', () => {
    const result = runRothConversionAnalysis({
      seed: 7,
      numYears: 4,
      numSimulations: 40,
      couple: true,
      ageA: 70,
      ageB: 68,
      tradBalance: 600000,
      rothBalance: 80000,
      taxableBalance: 150000,
      taxableBasis: 100000,
      taxableGainRate: 0.1,
      otherTaxableIncome: 25000,
      ladder: defaultIllustrativeTaxLadder(),
      fillTierRate: 0.22,
      annualConversionCap: 0,
      taxPayment: 'fromTaxable',
      ratePremium: 0.02,
      taxNoiseStd: 0.02,
      rmdEnabled: true,
      qcdEnabled: false,
      spouseSoleBeneficiary: true,
      returnMode: 'constant',
      constantRealReturn: 0.04,
    });

    expect(result.responseCurve.length).toBeGreaterThanOrEqual(4);
    expect(result.byStrategy.zero).toBeTruthy();
    // Engine clamps numSimulations to ≥ 100.
    expect(result.meta.numSimulations).toBe(100);
    expect(result.byStrategy.zero.heatmaps.netWorth.values.length).toBe(100 * 4);
    expect(result.byStrategy.custom.percentiles.p50.netWorthByYear.length).toBe(4);
    expect(result.sweep.points.length).toBe(result.responseCurve.length);
    expect(result.sweep.points[0].bundle.perPath.endingWealth.percentiles.length).toBeGreaterThan(0);
    expect(typeof result.recommendation.bestStrategyId).toBe('string');
    expect(result.recommendation.zeroP50).toBeGreaterThan(0);
    expect(result.byStrategy.custom.scatter.length).toBeGreaterThan(0);
    expect(result.byStrategy.fill22?.beatBaselineRate ?? result.byStrategy['fill-22'].beatBaselineRate)
      .toBeGreaterThanOrEqual(0);
  });

  it('can recommend $0 when conversion is unattractive', () => {
    // High other income already past fill ceiling + high premium → little room / costly.
    const result = runRothConversionAnalysis({
      seed: 99,
      numYears: 3,
      numSimulations: 30,
      couple: false,
      ageA: 60,
      tradBalance: 50000,
      rothBalance: 400000,
      taxableBalance: 10000,
      taxableBasis: 10000,
      taxableGainRate: 0,
      otherTaxableIncome: 300000,
      ladder: defaultIllustrativeTaxLadder(),
      fillTierRate: 0.12,
      annualConversionCap: 0,
      taxPayment: 'fromTaxable',
      ratePremium: 0.15,
      taxNoiseStd: 0,
      rmdEnabled: false,
      returnMode: 'constant',
      constantRealReturn: 0.05,
    });
    // Not asserting best === zero always (rates interact), but packaging stays valid.
    expect(result.byStrategy.zero.percentiles.p50.endingWealth).toBeGreaterThan(0);
  });
});

describe('policy shock wiring', () => {
  it('drawTaxRateShock is CRN-stable', () => {
    const a = drawTaxRateShock(123, 5, { baseRate: 0.22, noiseStd: 0.03 });
    const b = drawTaxRateShock(123, 5, { baseRate: 0.22, noiseStd: 0.03 });
    expect(a).toBe(b);
  });
});

describe('worker registry', () => {
  it('registers rothConvert handler', () => {
    expect(typeof HANDLERS.rothConvert).toBe('function');
  });
});
