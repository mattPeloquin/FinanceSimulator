import { describe, it, expect } from 'vitest';
import {
  CASHFLOW_SERIES_VERSION,
  createEmptyCashflowSeries,
  normalizeCashflowSeries,
  deflateNominalSeries,
  buildCashflowSeries,
  remapAgeCashflowToYears,
} from '../src/state/cashflowSeries.js';
import { buildExportEnvelope, parseScenarioPayload } from '../src/state/persistence.js';
import { buildAccumulationCashflowSeries } from '../src/core/accumulation.js';
import { FEATURE_HOUSE_EQUITY } from '../src/state/storageKeys.js';

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

  it('builds from annual-by-strategy maps and remaps age streams', () => {
    const built = buildCashflowSeries({
      sourceFeature: 'ss-timing',
      startAge: 65,
      numYears: 3,
      annualByStrategy: { early: [1, 2] },
    });
    expect(built.years).toEqual([0, 1, 2]);
    expect(built.seriesByStrategy.early.annual).toEqual([1, 2, 0]);

    const remapped = remapAgeCashflowToYears(
      { years: [67, 68, 69], annual: [12_000, 12_000, 12_000] },
      65,
      5,
    );
    expect(remapped).toEqual([0, 0, 12_000, 12_000, 12_000]);
  });

  it('round-trips on the export envelope without touching state', () => {
    const series = buildCashflowSeries({
      sourceFeature: 'house-equity',
      startAge: 70,
      sessionName: 'Access Now',
      numYears: 2,
      annualByStrategy: { simplifiedRm: [1000, 500] },
    });
    const envelope = buildExportEnvelope(
      { homeValue: 800 },
      {
        feature: FEATURE_HOUSE_EQUITY,
        name: 'Access Now',
        cashflowSeries: series,
      },
    );
    expect(envelope.cashflowSeries.sourceFeature).toBe('house-equity');
    const parsed = parseScenarioPayload(envelope);
    expect(parsed.state).toEqual({ homeValue: 800 });
    expect(parsed.cashflowSeries.seriesByStrategy.simplifiedRm.annual).toEqual([1000, 500]);
  });

  it('builds Accumulation series from config (contrib outflows + events)', () => {
    const series = buildAccumulationCashflowSeries({
      numYears: 3,
      sleeves: {
        ira: { contributionTiers: [{ amount: 10, growthPct: 0 }] },
        roth: { contributionTiers: [{ amount: 0, growthPct: 0 }] },
        afterTax: { contributionTiers: [{ amount: 0, growthPct: 0 }] },
      },
      events: [{ amount: -50, startYear: 2, years: 1 }],
    });
    expect(series.sourceFeature).toBe('accumulation');
    // Med scale: −$10k/yr contrib; year 1 (index 1) also −$50k event.
    expect(series.seriesByStrategy.med.annual[0]).toBeCloseTo(-10_000, 0);
    expect(series.seriesByStrategy.med.annual[1]).toBeCloseTo(-60_000, 0);
    expect(series.seriesByStrategy.low.annual[0]).toBeCloseTo(-5_000, 0);
    expect(series.seriesByStrategy.high.annual[0]).toBeCloseTo(-15_000, 0);
  });
});
