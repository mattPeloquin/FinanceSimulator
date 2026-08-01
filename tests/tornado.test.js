import { describe, it, expect } from 'vitest';
import { buildTornadoGeometry } from '../src/features/sor-lab/ui/charts/tornado.js';

const rateMetric = { id: 'successRate', kind: 'rate', unit: 'fraction', label: 'Success rate' };
const perPathMetric = { id: 'endingBalance', kind: 'perPath', unit: 'dollars', label: 'Ending balance' };

describe('buildTornadoGeometry', () => {
  it('places a straddling rate row at the true signed deltas (not always-to-the-right)', () => {
    // Regression for the stacked-bar Chart.js bug: baseline 0.60, low 0.28, high 0.67
    // must paint around [-0.32, +0.07], never [0, +0.39].
    const row = {
      baselineValue: 0.60,
      lowValue: 0.28,
      highValue: 0.67,
      se: 0.01,
      belowNoise: false,
    };
    const g = buildTornadoGeometry(row, rateMetric);
    expect(g.lowSeg[0]).toBeCloseTo(-0.32, 5);
    expect(g.lowSeg[1]).toBeCloseTo(0, 5);
    expect(g.highSeg[0]).toBeCloseTo(0, 5);
    expect(g.highSeg[1]).toBeCloseTo(0.07, 5);
    // Painted union of the two segments.
    const unionLo = Math.min(g.lowSeg[0], g.highSeg[0]);
    const unionHi = Math.max(g.lowSeg[1], g.highSeg[1]);
    expect(unionLo).toBeCloseTo(-0.32, 5);
    expect(unionHi).toBeCloseTo(0.07, 5);
    expect(unionLo).not.toBeCloseTo(0, 5);
    // Spine includes SE whiskers past the bar ends.
    expect(g.spine[0]).toBeCloseTo(-0.33, 5);
    expect(g.spine[1]).toBeCloseTo(0.08, 5);
    expect(g.caps).toBe(true);
  });

  it('keeps an entirely-below-baseline rate row on the left', () => {
    const row = {
      baselineValue: 0.80,
      lowValue: 0.50,
      highValue: 0.70,
      se: 0.02,
      belowNoise: false,
    };
    const g = buildTornadoGeometry(row, rateMetric);
    expect(g.lowSeg[0]).toBeCloseTo(-0.30, 5);
    expect(g.lowSeg[1]).toBeCloseTo(0, 5);
    expect(g.highSeg[0]).toBeCloseTo(-0.10, 5);
    expect(g.highSeg[1]).toBeCloseTo(0, 5);
    expect(Math.max(g.lowSeg[1], g.highSeg[1])).toBeCloseTo(0, 5);
  });

  it('keeps an entirely-above-baseline rate row on the right', () => {
    const row = {
      baselineValue: 0.40,
      lowValue: 0.50,
      highValue: 0.70,
      se: 0,
      belowNoise: false,
    };
    const g = buildTornadoGeometry(row, rateMetric);
    expect(g.lowSeg[0]).toBeCloseTo(0, 5);
    expect(g.lowSeg[1]).toBeCloseTo(0.10, 5);
    expect(g.highSeg[0]).toBeCloseTo(0, 5);
    expect(g.highSeg[1]).toBeCloseTo(0.30, 5);
  });

  it('builds band-style segments from each end\'s percentile span', () => {
    const row = {
      baselineValue: { pLow: 80, pMid: 100, pHigh: 120 },
      lowValue: { pLow: 40, pMid: 60, pHigh: 90 },
      highValue: { pLow: 110, pMid: 140, pHigh: 180 },
      belowNoise: false,
    };
    const g = buildTornadoGeometry(row, perPathMetric, 'band');
    // low end relative to baseline mid 100: [40-100, 90-100] = [-60, -10]
    expect(g.lowSeg[0]).toBeCloseTo(-60, 5);
    expect(g.lowSeg[1]).toBeCloseTo(-10, 5);
    // high end: [110-100, 180-100] = [10, 80]
    expect(g.highSeg[0]).toBeCloseTo(10, 5);
    expect(g.highSeg[1]).toBeCloseTo(80, 5);
    // Spine = medians: 60-100 = -40, 140-100 = 40
    expect(g.spine[0]).toBeCloseTo(-40, 5);
    expect(g.spine[1]).toBeCloseTo(40, 5);
    expect(g.caps).toBe(false);
  });

  it('anchors median-style segments at zero with no spine', () => {
    const row = {
      baselineValue: { pMid: 100 },
      lowValue: { pMid: 70 },
      highValue: { pMid: 130 },
      belowNoise: false,
    };
    const g = buildTornadoGeometry(row, perPathMetric, 'median');
    expect(g.lowSeg).toEqual([-30, 0]);
    expect(g.highSeg).toEqual([0, 30]);
    expect(g.spine).toBeNull();
    expect(g.caps).toBe(false);
  });

  it('preserves belowNoise on geometry', () => {
    const row = {
      baselineValue: 0.5,
      lowValue: 0.5,
      highValue: 0.51,
      se: 0,
      belowNoise: true,
    };
    const g = buildTornadoGeometry(row, rateMetric);
    expect(g.belowNoise).toBe(true);
  });
});
