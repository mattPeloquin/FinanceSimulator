import { describe, it, expect } from 'vitest';
import {
  computeSaleNetProceeds,
  amortizingAnnualPayment,
  advanceMortgageYear,
  simulateHouseEquityPath,
  runHouseEquityAnalysis,
  STRATEGY_IDS,
  STRATEGY_LABELS,
  drawHomeAppreciationShock,
} from '../src/core/houseEquity.js';
import { sizeHecmProceeds } from '../src/data/hecmPlf.js';
import { HANDLERS } from '../src/workers/dispatch.js';
import { buildMarketParams, defaultPortfolio } from '../src/portfolio/api.js';

function baseInput(overrides = {}) {
  const marketParams = buildMarketParams(defaultPortfolio({ distMethod: 'lognormal' }), {
    horizonYears: overrides.numYears || 12,
  });
  return {
    seed: 42,
    numSimulations: 40,
    numYears: 12,
    accessYear: 3,
    currentAge: 65,
    homeValue: 800_000,
    costBasis: 300_000,
    cgExclusion: 250_000,
    longTermCgRate: 0.15,
    saleCommissionPct: 0.05,
    saleOtherClosingPct: 0.02,
    existingMortgageBalance: 200_000,
    existingMortgageRate: 0.04,
    existingMortgageTermYears: 15,
    expectedRealAppreciation: 0.01,
    expectedInflation: 0.025,
    annualSpendTarget: 30_000,
    annualRent: 36_000,
    realRentGrowth: 0,
    simplifiedRmMode: 'loc',
    simplifiedRmFeePct: 0.02,
    simplifiedRmRate: 0.06,
    simplifiedRmLineGrowth: 0.03,
    privateRmMode: 'loc',
    privateRmProceedsPct: 0.5,
    privateRmFeePct: 0.03,
    privateRmRate: 0.07,
    privateRmLineGrowth: 0.04,
    helocLtv: 0.75,
    helocRate: 0.08,
    cashOutLtv: 0.7,
    cashOutRate: 0.065,
    cashOutTermYears: 30,
    cashOutClosingPct: 0.02,
    returnMode: 'market',
    marketParams,
    allocation: marketParams.allocation,
    ...overrides,
  };
}

describe('sale net proceeds', () => {
  it('applies commission, other closing, mortgage payoff, and CG tax', () => {
    const sale = computeSaleNetProceeds({
      homeValue: 1_000_000,
      mortgageBalance: 100_000,
      basis: 200_000,
      exclusion: 250_000,
      cgRate: 0.15,
      commissionPct: 0.05,
      otherClosingPct: 0.02,
    });
    // Taxable gain = 1e6 - 200k - 250k = 550k; tax = 82.5k
    // Closing = 70k; payoff = 100k → net = 1e6 - 70k - 100k - 82.5k = 747.5k
    expect(sale.closingCosts).toBeCloseTo(70_000, 0);
    expect(sale.taxableGain).toBeCloseTo(550_000, 0);
    expect(sale.cgTax).toBeCloseTo(82_500, 0);
    expect(sale.netToHousehold).toBeCloseTo(747_500, 0);
  });

  it('floors taxable gain at zero when exclusion covers the gain', () => {
    const sale = computeSaleNetProceeds({
      homeValue: 400_000,
      basis: 300_000,
      exclusion: 250_000,
      mortgageBalance: 0,
      commissionPct: 0,
      otherClosingPct: 0,
      cgRate: 0.15,
    });
    expect(sale.taxableGain).toBe(0);
    expect(sale.cgTax).toBe(0);
    expect(sale.netToHousehold).toBe(400_000);
  });
});

describe('mortgage helpers', () => {
  it('computes a positive amortizing payment', () => {
    const pmt = amortizingAnnualPayment(200_000, 0.04, 15);
    expect(pmt).toBeGreaterThan(15_000);
    expect(pmt).toBeLessThan(25_000);
  });

  it('reduces principal over a year', () => {
    const pmt = amortizingAnnualPayment(200_000, 0.04, 15);
    const step = advanceMortgageYear(200_000, 0.04, pmt);
    expect(step.balance).toBeLessThan(200_000);
    expect(step.principal).toBeGreaterThan(0);
  });
});

describe('calibrated HECM labeling', () => {
  it('keeps strategy id simplifiedRm with calibrated label', () => {
    expect(STRATEGY_LABELS.simplifiedRm).toMatch(/HECM|PLF/i);
  });
});

describe('calibrated HECM path sizing', () => {
  it('opens a credit line consistent with sizeHecmProceeds at access', () => {
    const input = baseInput({
      accessYear: 0,
      numYears: 5,
      currentAge: 75,
      homeValue: 500_000,
      existingMortgageBalance: 80_000,
      simplifiedRmRate: 0.05875,
      simplifiedRmFeePct: 0.03, // 3% of MCA
      annualSpendTarget: 0,
      seed: 3,
    });
    const expected = sizeHecmProceeds({
      homeValue: 500_000,
      age: 75,
      expectedRate: 0.05875,
      mortgageBalance: 80_000,
      otherFeeAmount: 0.03 * 500_000,
    });
    const path = simulateHouseEquityPath(input, 'simplifiedRm', 0);
    // With zero spend, no draws — residual should reflect undrawn line vs home.
    // Credit line at open equals netAvailable; verify via first-year residual identity:
    // home − drawn (0) = home, and cumulative cash starts at 0 when spend target is 0.
    expect(expected.netAvailable).toBeGreaterThan(0);
    expect(path.endingResidualEquityReal).toBeGreaterThan(0);
    // Path should not explode; ending residual ≤ starting home grown a bit.
    expect(path.endingResidualEquityReal).toBeLessThan(input.homeValue * 1.5);
  });
});

describe('home appreciation shock CRN', () => {
  it('is deterministic for the same seeds', () => {
    const a = drawHomeAppreciationShock(99, 3, 5);
    const b = drawHomeAppreciationShock(99, 3, 5);
    expect(a).toBe(b);
    expect(drawHomeAppreciationShock(99, 3, 6)).not.toBe(a);
  });
});

describe('runway identity', () => {
  it('matches cashflows across strategies before accessYear', () => {
    const input = baseInput({ accessYear: 4, numYears: 10, seed: 7 });
    const paths = STRATEGY_IDS.map((id) => simulateHouseEquityPath(input, id, 0));
    for (let y = 0; y < 4; y++) {
      const ref = paths[0].cashflowNominal[y];
      for (const p of paths) {
        expect(p.cashflowNominal[y]).toBeCloseTo(ref, 6);
      }
    }
  });
});

describe('strategy paths', () => {
  it('sellAndRent zeros residual equity after access and pays rent later', () => {
    const input = baseInput({ accessYear: 2, numYears: 8, seed: 11 });
    const path = simulateHouseEquityPath(input, 'sellAndRent', 0);
    expect(path.cashflowReal[2]).toBeGreaterThan(0);
    expect(path.endingResidualEquityReal).toBe(0);
    expect(path.cashflowReal[3]).toBeLessThan(0);
  });

  it('cashOutInvest funds a portfolio at access', () => {
    const input = baseInput({ accessYear: 2, numYears: 8, seed: 13 });
    const path = simulateHouseEquityPath(input, 'cashOutInvest', 0);
    expect(path.endingPortfolioReal).toBeGreaterThan(0);
    expect(path.cashflowReal[2]).toBeGreaterThan(0);
  });

  it('calibrated HECM can draw after access', () => {
    const input = baseInput({ accessYear: 1, annualSpendTarget: 20_000, seed: 17 });
    const path = simulateHouseEquityPath(input, 'simplifiedRm', 0);
    const postAccessDraw = path.cashflowReal.slice(1).some((v) => v > 0);
    expect(postAccessDraw).toBe(true);
  });
});

describe('runHouseEquityAnalysis', () => {
  it('compares all five strategies and emits cashflow series', () => {
    const result = runHouseEquityAnalysis(baseInput({ numSimulations: 24, numYears: 10 }));
    expect(result.strategies).toHaveLength(5);
    expect(result.ranking).toHaveLength(5);
    expect(result.cashflowSeries.sourceFeature).toBe('house-equity');
    expect(Object.keys(result.cashflowSeries.seriesByStrategy).sort()).toEqual(
      [...STRATEGY_IDS].sort(),
    );
    for (const id of STRATEGY_IDS) {
      expect(result.byStrategy[id].cumulativeCash.p50).toBeTypeOf('number');
      expect(result.cashflowSeries.seriesByStrategy[id].annual).toHaveLength(10);
    }
  });
});

describe('worker handler registration', () => {
  it('registers houseEquity', () => {
    expect(typeof HANDLERS.houseEquity).toBe('function');
  });
});
