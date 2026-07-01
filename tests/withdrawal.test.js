import { describe, it, expect } from 'vitest';
import { getDynamicAdjustment, resolveAdjustment, balanceScaleMultiplier } from '../src/core/withdrawal.js';

const dynConfig = {
  low: { ret: -15, bal: 1_000_000, adj: 0 },
  med: { ret: 5, bal: 5_000_000, adj: 100_000 },
  high: { ret: 20, bal: 8_000_000, adj: 200_000 },
};

describe('getDynamicAdjustment', () => {
  it('clamps to low adj at or below the low trigger', () => {
    expect(getDynamicAdjustment(-15, dynConfig)).toBe(0);
    expect(getDynamicAdjustment(-30, dynConfig)).toBe(0);
  });

  it('clamps to high adj at or above the high trigger', () => {
    expect(getDynamicAdjustment(20, dynConfig)).toBe(200_000);
    expect(getDynamicAdjustment(50, dynConfig)).toBe(200_000);
  });

  it('interpolates linearly between low and med', () => {
    // Midpoint between -15 and 5 is -5 -> halfway between 0 and 100k.
    expect(getDynamicAdjustment(-5, dynConfig)).toBeCloseTo(50_000, 6);
  });

  it('interpolates linearly between med and high', () => {
    // Midpoint between 5 and 20 is 12.5 -> halfway between 100k and 200k.
    expect(getDynamicAdjustment(12.5, dynConfig)).toBeCloseTo(150_000, 6);
  });

  it('returns med adj exactly at the med trigger', () => {
    expect(getDynamicAdjustment(5, dynConfig)).toBeCloseTo(100_000, 6);
  });

  it('never returns NaN when anchors share the same trigger return', () => {
    const degenerate = {
      low: { ret: 5, bal: 0, adj: 0 },
      med: { ret: 5, bal: 0, adj: 100_000 },
      high: { ret: 20, bal: 0, adj: 200_000 },
    };
    // Strictly between med and high still interpolates normally...
    expect(getDynamicAdjustment(12.5, degenerate)).toBeCloseTo(150_000, 6);
    // ...and the zero-width low..med segment falls back to the med anchor.
    const highDegenerate = {
      low: { ret: -15, bal: 0, adj: 0 },
      med: { ret: 20, bal: 0, adj: 100_000 },
      high: { ret: 20, bal: 0, adj: 200_000 },
    };
    const adj = getDynamicAdjustment(19.9, highDegenerate);
    expect(Number.isNaN(adj)).toBe(false);
  });
});

describe('resolveAdjustment', () => {
  it('forces low adj when balance is below the low balance override', () => {
    expect(resolveAdjustment(500_000, 30, dynConfig)).toBe(0);
  });

  it('raises the adjustment via the med balance override', () => {
    // balance 6M (> med.bal 5M): market 30% -> high.adj 200k, med override keeps max.
    expect(resolveAdjustment(6_000_000, 30, dynConfig)).toBeCloseTo(200_000, 6);
  });

  it('raises the adjustment via the high balance override even in a crash', () => {
    // balance 9M (> high.bal 8M): market -30% -> low.adj 0, override lifts to high.adj.
    expect(resolveAdjustment(9_000_000, -30, dynConfig)).toBeCloseTo(200_000, 6);
  });
});

describe('balanceScaleMultiplier', () => {
  const portfolio = {
    floorBalance: 2_000_000,
    floorPenalty: 0.5,
    ceilingBalance: 5_000_000,
    ceilingBonus: 0.5,
  };

  it('is neutral (1x) between the floor and the ceiling', () => {
    expect(balanceScaleMultiplier(2_000_000, portfolio)).toBe(1);
    expect(balanceScaleMultiplier(3_500_000, portfolio)).toBe(1);
    expect(balanceScaleMultiplier(5_000_000, portfolio)).toBe(1);
  });

  it('ramps down smoothly below the floor, reaching the max cut at $0', () => {
    // Halfway to broke -> half the penalty applied.
    expect(balanceScaleMultiplier(1_000_000, portfolio)).toBeCloseTo(0.75, 9);
    expect(balanceScaleMultiplier(0, portfolio)).toBeCloseTo(0.5, 9);
  });

  it('ramps up above the ceiling without any cap', () => {
    // One extra ceiling-multiple -> full bonus; keeps growing beyond that.
    expect(balanceScaleMultiplier(10_000_000, portfolio)).toBeCloseTo(1.5, 9);
    expect(balanceScaleMultiplier(20_000_000, portfolio)).toBeCloseTo(2.5, 9);
  });

  it('clamps at zero when the penalty exceeds 100%', () => {
    const harsh = { ...portfolio, floorPenalty: 2 };
    expect(balanceScaleMultiplier(0, harsh)).toBe(0);
  });

  it('disables each ramp when its threshold is unset', () => {
    const noFloor = { ...portfolio, floorBalance: 0 };
    expect(balanceScaleMultiplier(100_000, noFloor)).toBe(1);
    const noCeiling = { ...portfolio, ceilingBalance: Infinity };
    expect(balanceScaleMultiplier(50_000_000, noCeiling)).toBe(1);
  });
});
