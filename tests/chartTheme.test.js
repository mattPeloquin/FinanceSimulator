// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  applySampleRunDomTooltipStyle,
  sampleRunTooltipOptions,
  sampleRunTooltipXAlign,
  SAMPLE_RUN_TOOLTIP_STYLE,
} from '../src/ui/charts/chartTheme.js';
import {
  largeWithdrawalLegendOptions,
  withdrawalAmountRows,
  withdrawalComparisonDatasets,
} from '../src/ui/charts/surface3d.js';

describe('sampleRunTooltipXAlign', () => {
  const area = { left: 10, right: 110 };

  it('places the tooltip on the right when the point is in the left half', () => {
    expect(sampleRunTooltipXAlign(30, area)).toBe('right');
  });

  it('places the tooltip on the left when the point is in the right half', () => {
    expect(sampleRunTooltipXAlign(80, area)).toBe('left');
  });
});

describe('sample-run tooltip style', () => {
  it('uses a black translucent background for Chart.js and DOM tips', () => {
    const opts = sampleRunTooltipOptions({});
    expect(opts.backgroundColor).toBe('rgba(0, 0, 0, 0.8)');
    expect(opts.titleColor).toBe('#ffffff');
    expect(opts.bodyColor).toBe('#ffffff');
    expect(opts.titleFont.size).toBe(11);
    expect(sampleRunTooltipOptions({}, { large: true }).titleFont.size).toBe(11);
    expect(SAMPLE_RUN_TOOLTIP_STYLE.backgroundColor).toBe(opts.backgroundColor);

    const el = document.createElement('div');
    applySampleRunDomTooltipStyle(el);
    // jsdom may normalize #fff → rgb(...); accept either form.
    expect(el.style.backgroundColor || el.style.background).toMatch(/rgba?\(0,\s*0,\s*0/);
    expect(el.style.color).toMatch(/rgb\(255,\s*255,\s*255\)|#ffffff/i);
    expect(['transparent', ''].includes(el.style.borderColor) || el.style.borderColor === 'rgba(0, 0, 0, 0)').toBe(true);
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

  it('clamps deposit years (negative withdrawals) to zero on the chart', () => {
    const series = {
      labels: [1, 2, 3],
      unadjustedData: [-50_000, 100_000, 100_000],
      actualData: [-50_000, 90_000, 100_000],
    };
    const portfolio = { start: 1_000_000 };

    const datasets = withdrawalComparisonDatasets(series, { portfolio });
    const plan = datasets.find((dataset) => dataset.label === 'Original Plan');
    const actual = datasets.find((dataset) => dataset.label === 'Actual Withdrawal');

    expect(plan.data).toEqual([0, 100_000, 100_000]);
    expect(actual.data).toEqual([0, 90_000, 100_000]);
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

describe('largeWithdrawalLegendOptions', () => {
  it('sets fontColor on each item so Chart.js can paint legend text', () => {
    const opts = largeWithdrawalLegendOptions({ legend: '#112233' });
    const chart = {
      legend: { options: { labels: { color: '#112233' } } },
      data: {
        datasets: [
          { label: 'Actual Withdrawal', borderColor: '#f00', borderWidth: 2 },
          { label: '4% rule', borderColor: '#0f0', borderWidth: 1, borderDash: [2, 5] },
        ],
      },
      isDatasetVisible: () => true,
    };
    const items = opts.labels.generateLabels(chart);
    expect(items.map((i) => i.text)).toEqual(['Actual Withdrawal', '4% rule']);
    expect(items.every((i) => i.fontColor === '#112233')).toBe(true);
  });
});

describe('withdrawalAmountRows', () => {
  const total = 1_200_000;
  const horizon = 30;
  const meanYr = total / horizon;

  it('lists Total then Mean / Year when ranking by total (no Median / Year)', () => {
    expect(withdrawalAmountRows(total, horizon, 'total')).toEqual([
      { label: 'Total', value: total },
      { label: 'Mean / Year', value: meanYr },
    ]);
  });

  it('puts Mean / Year first when that metric ranks the runs', () => {
    expect(withdrawalAmountRows(total, horizon, 'meanYearly')).toEqual([
      { label: 'Mean / Year', value: meanYr },
      { label: 'Total', value: total },
    ]);
  });

  it('keeps Total ahead of Mean when ranking by median yearly', () => {
    expect(withdrawalAmountRows(total, horizon, 'medianYearly')).toEqual([
      { label: 'Total', value: total },
      { label: 'Mean / Year', value: meanYr },
    ]);
  });
});
