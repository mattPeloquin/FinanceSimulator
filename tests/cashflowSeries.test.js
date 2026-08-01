import { describe, it, expect } from 'vitest';
import {
  CASHFLOW_SERIES_VERSION,
  createEmptyCashflowSeries,
  normalizeCashflowSeries,
  deflateNominalSeries,
} from '../src/state/cashflowSeries.js';

describe('cashflowSeries', () => {
  it('creates an empty v1 series', () => {
    const s = createEmptyCashflowSeries({ sourceFeature: 'house-equity', startAge: 65 });
    expect(s.version).toBe(CASHFLOW_SERIES_VERSION);
    expect(s.units).toBe('real-dollars');
    expect(s.sourceFeature).toBe('house-equity');
    expect(s.startAge).toBe(65);
    expect(s.seriesByStrategy).toEqual({});
  });

  it('normalizes malformed input', () => {
    expect(normalizeCashflowSeries(null).version).toBe(CASHFLOW_SERIES_VERSION);
    const out = normalizeCashflowSeries({
      version: 1,
      sourceFeature: 'house-equity',
      sessionName: 'Demo',
      years: [0, 1, 2],
      seriesByStrategy: {
        heloc: { annual: [100, -50, 'x'] },
        bad: null,
      },
    });
    expect(out.sessionName).toBe('Demo');
    expect(out.seriesByStrategy.heloc.annual).toEqual([100, -50, 0]);
    expect(out.seriesByStrategy.bad).toBeUndefined();
  });

  it('deflates nominal series with cumulative inflation', () => {
    // Year 0 cash stays at face; year 1 is deflated by year-0 inflation.
    const real = deflateNominalSeries([100, 110], [0.10, 0.0]);
    expect(real[0]).toBeCloseTo(100, 6);
    expect(real[1]).toBeCloseTo(100, 6);
  });
});
