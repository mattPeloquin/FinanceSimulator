import { describe, it, expect } from 'vitest';
import { getDynamicAdjustment, resolveAdjustment } from '../src/core/withdrawal.js';

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
  const portfolio = {
    floorBalance: 2_000_000,
    floorPenalty: 0.5,
    ceilingBalance: 5_000_000,
    ceilingBonus: 0.5,
  };

  it('forces low adj when balance is below the low balance override', () => {
    // balance below 1M -> forced to low.adj (0), guardrail floor also applies but |0| => 0.
    expect(resolveAdjustment(500_000, 30, portfolio, dynConfig)).toBe(0);
  });

  it('applies the floor penalty between low-bal and floor', () => {
    // balance 1.5M (above 1M override, below 2M floor), high market return.
    // market 30% -> high.adj 200k; floor penalty cuts 50% -> 100k.
    const adj = resolveAdjustment(1_500_000, 30, portfolio, dynConfig);
    expect(adj).toBeCloseTo(100_000, 6);
  });

  it('applies the ceiling bonus above the ceiling balance', () => {
    // balance 6M (> high.bal 8M? no; > med.bal 5M yes) market 30% -> base high.adj 200k,
    // balance override med raises to max(200k,100k)=200k; ceiling (>5M) adds 50% -> 300k.
    const adj = resolveAdjustment(6_000_000, 30, portfolio, dynConfig);
    expect(adj).toBeCloseTo(300_000, 6);
  });
});
