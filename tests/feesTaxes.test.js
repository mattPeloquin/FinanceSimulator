import { describe, it, expect } from 'vitest';
import {
  taxOnNetSlice,
  grossUpNet,
  buildWithdrawalTaxSeries,
  grossUpPlanSchedule,
  withdrawalTaxSeriesActive,
  ZERO_WITHDRAWAL_TAX,
} from '../src/core/feesTaxes.js';

describe('taxOnNetSlice / grossUpNet', () => {
  it('returns 0 tax when rate is 0', () => {
    expect(taxOnNetSlice(100_000, 0, ZERO_WITHDRAWAL_TAX)).toBe(0);
    expect(grossUpNet(100_000, 0, ZERO_WITHDRAWAL_TAX)).toEqual({
      net: 100_000,
      tax: 0,
      gross: 100_000,
    });
  });

  it('applies a flat rate as tax = rate × net', () => {
    const yearTax = { taxRate: 0.2, applyToGifts: true, spendBrackets: [] };
    expect(taxOnNetSlice(100_000, 0, yearTax)).toBeCloseTo(20_000, 6);
    expect(grossUpNet(100_000, 0, yearTax).gross).toBeCloseTo(120_000, 6);
  });

  it('uses a one-bracket schedule on cumulative net (not a cliff)', () => {
    const yearTax = {
      taxRate: 0.1,
      applyToGifts: true,
      spendBrackets: [{ threshold: 100_000, rate: 0.3 }],
    };
    // First $100k at 10%, next $50k at 30% → 10k + 15k = 25k
    expect(taxOnNetSlice(150_000, 0, yearTax)).toBeCloseTo(25_000, 6);

    // Prior already used the low band; this $50k slice is all high band
    expect(taxOnNetSlice(50_000, 100_000, yearTax)).toBeCloseTo(15_000, 6);

    // Slice straddling the threshold with prior $80k: $20k low + $30k high
    expect(taxOnNetSlice(50_000, 80_000, yearTax)).toBeCloseTo(20_000 * 0.1 + 30_000 * 0.3, 6);
  });

  it('applies three progressive brackets across a mid-year slice', () => {
    const yearTax = {
      taxRate: 0.1,
      applyToGifts: true,
      spendBrackets: [
        { threshold: 100_000, rate: 0.2 },
        { threshold: 200_000, rate: 0.3 },
      ],
    };
    // Prior $90k; slice $130k covers: $10k@10% + $100k@20% + $20k@30%
    expect(taxOnNetSlice(130_000, 90_000, yearTax)).toBeCloseTo(
      10_000 * 0.1 + 100_000 * 0.2 + 20_000 * 0.3,
      6,
    );
  });

  it('clamps extreme rates so gross stays finite', () => {
    const yearTax = { taxRate: 2, applyToGifts: true, spendBrackets: [] };
    const { tax, gross } = grossUpNet(100, 0, yearTax);
    expect(tax).toBeCloseTo(99, 6);
    expect(gross).toBeCloseTo(199, 6);
  });
});

describe('buildWithdrawalTaxSeries', () => {
  it('returns zero tax for every year when tiers are empty', () => {
    const series = buildWithdrawalTaxSeries([], 5, (k) => k * 1000);
    expect(series).toHaveLength(5);
    expect(withdrawalTaxSeriesActive(series)).toBe(false);
    expect(series.every((y) => y.taxRate === 0)).toBe(true);
  });

  it('fills intermediate spans and lets the last tier cover the remainder', () => {
    const series = buildWithdrawalTaxSeries(
      [
        { taxPct: 10, years: 2, applyToGifts: false, spendBrackets: [] },
        {
          taxPct: 25,
          applyToGifts: true,
          spendBrackets: [{ above: 150, taxPct: 35 }],
        },
      ],
      5,
      (k) => k * 1000,
    );
    expect(series[0].taxRate).toBeCloseTo(0.1, 6);
    expect(series[0].applyToGifts).toBe(false);
    expect(series[1].taxRate).toBeCloseTo(0.1, 6);
    expect(series[2].taxRate).toBeCloseTo(0.25, 6);
    expect(series[4].taxRate).toBeCloseTo(0.25, 6);
    expect(series[2].spendBrackets).toEqual([{ threshold: 150_000, rate: 0.35 }]);
    expect(withdrawalTaxSeriesActive(series)).toBe(true);
  });
});

describe('grossUpPlanSchedule', () => {
  it('grosses up positive plan years and leaves deposits unchanged', () => {
    const taxSeries = buildWithdrawalTaxSeries(
      [{ taxPct: 20, applyToGifts: true, spendBrackets: [] }],
      3,
      (k) => k * 1000,
    );
    const gross = grossUpPlanSchedule([80_000, -10_000, 50_000], taxSeries);
    expect(gross[0]).toBeCloseTo(96_000, 6);
    expect(gross[1]).toBe(-10_000);
    expect(gross[2]).toBeCloseTo(60_000, 6);
  });
});
