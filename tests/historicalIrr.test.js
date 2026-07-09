import { describe, it, expect } from 'vitest';
import {
  HISTORICAL_IRR_PERCENTILES,
  historicalPlanIrrs,
  historicalIrrBand,
} from '../src/core/historicalIrr.js';
import { getSampleYears } from '../src/core/history.js';

// Full year record (all asset columns) with only us_lg_growth and inflation set.
const yr = (us_lg_growth, inflation = 0) => ({
  us_lg_growth,
  us_lg_value: 0,
  us_sm_mid: 0,
  ex_us: 0,
  bond: 0,
  cash: 0,
  inflation,
});

// Minimal engine params: all-growth allocation, plain base withdrawal, no
// guardrails/floors/gifts, so window IRRs are hand-checkable.
function makeParams({ years, numYears, base = 0, start = 1000 }) {
  return {
    numYears,
    allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
    portfolio: {
      strategy: 'base',
      start,
      base,
      floorBalance: 0,
      floorPenalty: 0,
      ceilingBalance: Infinity,
      ceilingBonus: 0,
    },
    dynConfig: { enabled: false },
    samples: { years },
  };
}

describe('historicalPlanIrrs', () => {
  it('with no withdrawals, each window IRR equals its annualized real return', () => {
    const params = makeParams({ years: [yr(10), yr(10), yr(21)], numYears: 2 });
    const { irrs, wrapped } = historicalPlanIrrs(params);
    expect(wrapped).toBe(false);
    expect(irrs).toHaveLength(2);
    // Windows: 1.1*1.1 -> 10% and 1.1*1.21 -> ~15.36% annualized.
    expect(irrs[0]).toBeCloseTo(0.1, 6);
    expect(irrs[1]).toBeCloseTo(Math.sqrt(1.1 * 1.21) - 1, 6);
  });

  it('deflates by inflation: IRR is real, not nominal', () => {
    const params = makeParams({ years: [yr(10, 10), yr(10, 10)], numYears: 2 });
    const { irrs } = historicalPlanIrrs(params);
    expect(irrs).toHaveLength(1);
    expect(irrs[0]).toBeCloseTo(0, 6);
  });

  it('at a constant return, withdrawals do not move the IRR off that rate', () => {
    const params = makeParams({ years: [yr(5), yr(5), yr(5), yr(5)], numYears: 3, base: 40 });
    const { irrs } = historicalPlanIrrs(params);
    for (const irr of irrs) expect(irr).toBeCloseTo(0.05, 6);
  });

  it('is sequence-sensitive: with withdrawals, a crash-first era scores below a crash-last one', () => {
    const crashFirst = makeParams({ years: [yr(-30), yr(25), yr(25)], numYears: 3, base: 50 });
    const crashLast = makeParams({ years: [yr(25), yr(25), yr(-30)], numYears: 3, base: 50 });
    const a = historicalPlanIrrs(crashFirst).irrs[0];
    const b = historicalPlanIrrs(crashLast).irrs[0];
    expect(a).toBeLessThan(b);

    // Without cash flows the order of the same years is irrelevant.
    const aHold = historicalPlanIrrs({ ...crashFirst, portfolio: { ...crashFirst.portfolio, base: 0 } });
    const bHold = historicalPlanIrrs({ ...crashLast, portfolio: { ...crashLast.portfolio, base: 0 } });
    expect(aHold.irrs[0]).toBeCloseTo(bHold.irrs[0], 8);
  });

  it('reflects depletion: a plan that runs out mid-window has a negative IRR', () => {
    const params = makeParams({ years: [yr(-10), yr(-10), yr(-10)], numYears: 3, base: 400 });
    const { irrs } = historicalPlanIrrs(params);
    // Balances: 1000 -> 900-400=500 -> 450-400=50 -> 45-45=0 (depleted).
    // Flows: -1000, then +400, +400, +45: less recovered than invested.
    expect(irrs[0]).toBeLessThan(0);
  });

  it('wraps around a selection shorter than the horizon, one window per starting year', () => {
    const params = makeParams({ years: [yr(5), yr(5)], numYears: 35, base: 10 });
    const { irrs, wrapped } = historicalPlanIrrs(params);
    expect(wrapped).toBe(true);
    expect(irrs).toHaveLength(2);
    for (const irr of irrs) expect(irr).toBeCloseTo(0.05, 6);
  });
});

describe('historicalIrrBand', () => {
  it('matches the chart P5–P65 outcome band by default', () => {
    expect(HISTORICAL_IRR_PERCENTILES).toEqual({ low: 0.05, high: 0.65 });
  });

  it('reduces the window IRRs to their P5 and P65', () => {
    // Ten 1-year windows with distinct returns 1%..10%: P5 -> index
    // floor(10*0.05)=0 (1%), P65 -> index floor(10*0.65)=6 (7%).
    const years = Array.from({ length: 10 }, (_, i) => yr(i + 1));
    const band = historicalIrrBand(makeParams({ years, numYears: 1 }));
    expect(band.windows).toBe(10);
    expect(band.wrapped).toBe(false);
    expect(band.low).toBeCloseTo(0.01, 6);
    expect(band.high).toBeCloseTo(0.07, 6);
  });

  it('supports custom percentiles', () => {
    const years = Array.from({ length: 10 }, (_, i) => yr(i + 1));
    const band = historicalIrrBand(makeParams({ years, numYears: 1 }), { low: 0.1, high: 0.9 });
    expect(band.low).toBeCloseTo(0.02, 6);
    expect(band.high).toBeCloseTo(0.1, 6);
  });

  it('widens when the plan withdraws (sequence risk shows up in the band)', () => {
    const years = getSampleYears(1950, 2000);
    const numYears = 30;
    const hold = historicalIrrBand(makeParams({ years, numYears, start: 1000, base: 0 }));
    const spend = historicalIrrBand(makeParams({ years, numYears, start: 1000, base: 40 }));
    expect(hold.windows).toBe(2000 - 1950 + 1 - numYears + 1);
    expect(spend.windows).toBe(hold.windows);
    expect(spend.high - spend.low).toBeGreaterThan(hold.high - hold.low);
  });

  it('returns null when the backtest cannot run', () => {
    expect(historicalIrrBand(makeParams({ years: [], numYears: 3 }))).toBeNull();
    expect(historicalIrrBand(makeParams({ years: [yr(5)], numYears: 0 }))).toBeNull();
    expect(historicalIrrBand(null)).toBeNull();
    expect(historicalIrrBand({ numYears: 3 })).toBeNull();
  });
});
