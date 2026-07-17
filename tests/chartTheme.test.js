// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sampleRunTooltipXAlign } from '../src/ui/charts/chartTheme.js';
import { withdrawalComparisonDatasets } from '../src/ui/charts/surface3d.js';

describe('sampleRunTooltipXAlign', () => {
  const area = { left: 10, right: 110 };

  it('places the tooltip on the right when the point is in the left half', () => {
    expect(sampleRunTooltipXAlign(30, area)).toBe('right');
  });

  it('places the tooltip on the left when the point is in the right half', () => {
    expect(sampleRunTooltipXAlign(80, area)).toBe('left');
  });
});

describe('withdrawalComparisonDatasets minimum overlay', () => {
  it('draws the minimum line smoothly without stepped rendering', () => {
    const series = {
      labels: [1, 2, 3],
      unadjustedData: [100_000, 100_000, 100_000],
      actualData: [95_000, 95_000, 95_000],
    };
    const portfolio = {
      strategy: 'base',
      withdrawalFloorSeries: [50_000, 50_000, 40_000],
      giftingSeries: [{ amount: 0 }, { amount: 0 }, { amount: 0 }],
    };

    const minimum = withdrawalComparisonDatasets(series, { portfolio })
      .find((dataset) => dataset.label === 'Minimum');

    expect(minimum).toBeDefined();
    expect(minimum.stepped).toBeUndefined();
    expect(minimum.tension).toBe(0.1);
  });

  it('lists 4% rule first and draws it last (highest order)', () => {
    const series = {
      labels: [1, 2, 3],
      unadjustedData: [100_000, 100_000, 100_000],
      actualData: [95_000, 95_000, 95_000],
    };
    const portfolio = {
      strategy: 'base',
      start: 1_000_000,
      withdrawalFloorSeries: [50_000, 50_000, 40_000],
      giftingSeries: [{ amount: 0 }, { amount: 0 }, { amount: 0 }],
    };

    const datasets = withdrawalComparisonDatasets(series, { portfolio });
    const classic = datasets.find((dataset) => dataset.label === '4% rule');

    expect(classic).toBeDefined();
    expect(classic.data).toEqual([40_000, 40_000, 40_000]);
    expect(classic.borderWidth).toBe(1);
    expect(classic.borderDash).toEqual([2, 5]);
    expect(classic.order).toBe(10);
    expect(datasets[0].label).toBe('4% rule');
    // Actual still immediately follows Original Plan for fill target '-1'.
    const planIdx = datasets.findIndex((d) => d.label === 'Original Plan');
    expect(datasets[planIdx + 1].label).toBe('Actual Withdrawal');
  });
});
