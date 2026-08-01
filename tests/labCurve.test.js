import { describe, it, expect } from 'vitest';
import {
  normalizedPosition,
  denormalizePosition,
  slopePer10Pct,
  findThresholdCrossings,
  describeMonotonicity,
  buildCurveModel,
  toggleSelection,
  MAX_CURVE_SELECTION,
} from '../src/features/sor-lab/ui/curveModel.js';
import { normalizeLabUiPrefs } from '../src/state/labUiPrefs.js';

describe('normalizedPosition / denormalizePosition', () => {
  const envelope = { low: 0, high: 10 };
  const baseline = 4;

  it('maps envelope low to -1, baseline to 0, high to +1', () => {
    expect(normalizedPosition(0, envelope, baseline)).toBeCloseTo(-1, 10);
    expect(normalizedPosition(4, envelope, baseline)).toBeCloseTo(0, 10);
    expect(normalizedPosition(10, envelope, baseline)).toBeCloseTo(1, 10);
  });

  it('handles an asymmetric baseline (off-center)', () => {
    // low span 4, high span 6 — halfway toward high is +0.5
    expect(normalizedPosition(7, envelope, baseline)).toBeCloseTo(0.5, 10);
    // halfway toward low is -0.5
    expect(normalizedPosition(2, envelope, baseline)).toBeCloseTo(-0.5, 10);
  });

  it('guards a collapsed side when baseline sits on an endpoint', () => {
    expect(normalizedPosition(0, { low: 0, high: 10 }, 0)).toBe(0);
    expect(normalizedPosition(5, { low: 0, high: 10 }, 0)).toBeCloseTo(0.5, 10);
    expect(normalizedPosition(10, { low: 0, high: 10 }, 10)).toBe(0);
    expect(normalizedPosition(5, { low: 0, high: 10 }, 10)).toBeCloseTo(-0.5, 10);
  });

  it('round-trips native values through normalize → denormalize', () => {
    for (const v of [0, 2, 4, 7, 10]) {
      const t = normalizedPosition(v, envelope, baseline);
      expect(denormalizePosition(t, envelope, baseline)).toBeCloseTo(v, 10);
    }
  });
});

describe('slopePer10Pct', () => {
  it('recovers a known linear slope', () => {
    // y = 0.5 * t  → per +0.1 on t, dy = 0.05
    const ts = [-1, -0.5, 0, 0.5, 1];
    const ys = ts.map((t) => 0.5 * t);
    expect(slopePer10Pct(ts, ys)).toBeCloseTo(0.05, 10);
  });

  it('handles a baseline sitting at an endpoint', () => {
    const ts = [0, 0.5, 1];
    const ys = [1, 1.5, 2];
    // dy/dt = 1, per 10% → 0.1
    expect(slopePer10Pct(ts, ys)).toBeCloseTo(0.1, 10);
  });
});

describe('findThresholdCrossings', () => {
  it('finds the interpolated crossing on a monotonic curve', () => {
    const ts = [-1, -0.5, 0, 0.5, 1];
    const ys = [0.2, 0.4, 0.6, 0.8, 1.0];
    const crossings = findThresholdCrossings(ts, ys, 0.7);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].t).toBeCloseTo(0.25, 5);
    expect(crossings[0].y).toBe(0.7);
  });

  it('finds both crossings on a curve that turns around', () => {
    const ts = [-1, -0.5, 0, 0.5, 1];
    const ys = [0.5, 0.9, 0.7, 0.4, 0.2];
    const crossings = findThresholdCrossings(ts, ys, 0.6);
    expect(crossings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('describeMonotonicity', () => {
  it('reports a turn only when it exceeds the tolerance', () => {
    const mono = describeMonotonicity([1, 2, 3, 4], 0.1);
    expect(mono.monotonic).toBe(true);
    expect(mono.direction).toBe('up');

    const wiggly = describeMonotonicity([1, 2, 1.95, 3], 0.1);
    expect(wiggly.monotonic).toBe(true); // 0.05 wiggle < 0.1 tolerance

    const turns = describeMonotonicity([1, 3, 1.5, 4], 0.1);
    expect(turns.monotonic).toBe(false);
    expect(turns.turningIndex).toBe(1);
  });
});

describe('buildCurveModel', () => {
  function fakeSeries(id, label, ys, envelope = { low: 0, high: 10 }, baseline = 5) {
    const x = [0, 2.5, 5, 7.5, 10];
    return {
      variable: { id, label, unit: '%', envelope, baselineValue: baseline },
      metric: { id: 'successRate', kind: 'rate', unit: 'fraction', label: 'Success rate' },
      band: { low: 10, high: 90 },
      x,
      series: {
        value: ys,
        se: ys.map(() => 0.01),
      },
      baselineValue: baseline,
      envelope,
    };
  }

  it('assigns distinct palette colors and marks exactly one curve focused', () => {
    const model = buildCurveModel({
      seriesList: [
        fakeSeries('a', 'A', [0.5, 0.55, 0.6, 0.65, 0.7]),
        fakeSeries('b', 'B', [0.4, 0.5, 0.6, 0.7, 0.8]),
      ],
      metric: { id: 'successRate', kind: 'rate', unit: 'fraction', label: 'Success rate' },
      band: { low: 10, high: 90 },
      noiseFloor: 0.02,
      focusedId: 'b',
      threshold: 0.9,
      palette: ['#111', '#222', '#333'],
    });
    expect(model.curves).toHaveLength(2);
    expect(model.curves[0].color).toBe('#111');
    expect(model.curves[1].color).toBe('#222');
    expect(model.curves.filter((c) => c.focused)).toHaveLength(1);
    expect(model.curves[1].focused).toBe(true);
    expect(model.baselineMetric).toBeCloseTo(0.6, 5);
  });

  it('emits fan ranks only for the focused per-path curve', () => {
    const makePerPath = (id, focusedYs) => {
      const x = [0, 5, 10];
      const pct = (offset) => focusedYs.map((y) => y + offset);
      return {
        variable: { id, label: id, unit: '$000s', envelope: { low: 0, high: 10 }, baselineValue: 5 },
        metric: { id: 'endingBalance', kind: 'perPath', unit: 'dollars', label: 'Ending balance' },
        band: { low: 10, high: 90 },
        x,
        series: {
          percentiles: {
            5: pct(-30),
            10: pct(-20),
            25: pct(-10),
            50: focusedYs,
            75: pct(10),
            90: pct(20),
            95: pct(30),
          },
          mean: focusedYs.map((y) => y + 2),
        },
        baselineValue: 5,
        envelope: { low: 0, high: 10 },
      };
    };
    const model = buildCurveModel({
      seriesList: [makePerPath('a', [100, 110, 120]), makePerPath('b', [90, 100, 110])],
      metric: { id: 'endingBalance', kind: 'perPath', unit: 'dollars', label: 'Ending balance' },
      band: { low: 10, high: 90 },
      focusedId: 'a',
      palette: ['#a', '#b'],
    });
    expect(model.curves[0].fan?.length).toBe(3);
    expect(model.curves[0].mean).toBeTruthy();
    expect(model.curves[1].fan).toBeNull();
    expect(model.curves[1].mean).toBeNull();
    expect(model.curves[0].band).toBeTruthy();
    expect(model.curves[1].band).toBeTruthy();
  });
});

describe('toggleSelection', () => {
  it('caps at MAX and drops the oldest when over capacity', () => {
    let ids = [];
    for (let i = 0; i < MAX_CURVE_SELECTION; i++) {
      ids = toggleSelection(ids, `v${i}`);
    }
    expect(ids).toHaveLength(MAX_CURVE_SELECTION);
    ids = toggleSelection(ids, 'vX');
    expect(ids).toHaveLength(MAX_CURVE_SELECTION);
    expect(ids[0]).toBe('v1');
    expect(ids).toContain('vX');
    expect(ids).not.toContain('v0');
  });
});

describe('normalizeLabUiPrefs selection migration', () => {
  it('seeds selectedVariableIds from legacy selectedVariableId', () => {
    const prefs = normalizeLabUiPrefs({ selectedVariableId: 'inflation' });
    expect(prefs.selectedVariableIds).toEqual(['inflation']);
    expect(prefs.focusedVariableId).toBe('inflation');
  });

  it('dedupes and caps selectedVariableIds at 5', () => {
    const prefs = normalizeLabUiPrefs({
      selectedVariableIds: ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g'],
    });
    expect(prefs.selectedVariableIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
