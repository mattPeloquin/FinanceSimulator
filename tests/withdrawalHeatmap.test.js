import { describe, it, expect } from 'vitest';
import {
  sequentialColor,
  divergingColor,
  heatmapColumnAtX,
  heatmapYearAtY,
  formatHeatmapTooltip,
} from '../src/ui/charts/withdrawalHeatmap.js';

describe('sequentialColor', () => {
  const domain = { lo: 20_000, hi: 100_000 };

  it('maps the domain endpoints to the ramp ends (light)', () => {
    expect(sequentialColor(domain.lo, domain, false)).toBe('rgb(205, 226, 251)'); // #cde2fb
    expect(sequentialColor(domain.hi, domain, false)).toBe('rgb(13, 54, 107)'); // #0d366b
  });

  it('inverts lightness direction in dark mode so low values recede', () => {
    expect(sequentialColor(domain.lo, domain, true)).toBe('rgb(22, 40, 60)'); // #16283c
    expect(sequentialColor(domain.hi, domain, true)).toBe('rgb(183, 211, 246)'); // #b7d3f6
  });

  it('clamps values beyond the domain to the ramp ends', () => {
    expect(sequentialColor(domain.lo - 50_000, domain, false)).toBe(sequentialColor(domain.lo, domain, false));
    expect(sequentialColor(domain.hi + 500_000, domain, false)).toBe(sequentialColor(domain.hi, domain, false));
  });
});

describe('divergingColor', () => {
  const max = 10_000;

  it('returns the neutral gray midpoint exactly on plan', () => {
    expect(divergingColor(0, max, false)).toBe('rgb(240, 239, 236)'); // #f0efec
    expect(divergingColor(0, max, true)).toBe('rgb(56, 56, 53)'); // #383835
  });

  it('runs cuts to the red pole and boosts to the blue pole', () => {
    expect(divergingColor(-max, max, false)).toBe('rgb(185, 28, 28)'); // #b91c1c
    expect(divergingColor(max, max, false)).toBe('rgb(28, 92, 171)'); // #1c5cab
  });

  it('clamps deltas beyond the symmetric domain to the poles', () => {
    expect(divergingColor(-3 * max, max, false)).toBe(divergingColor(-max, max, false));
    expect(divergingColor(3 * max, max, false)).toBe(divergingColor(max, max, false));
  });

  it('degrades to the midpoint when the domain is zero', () => {
    expect(divergingColor(5_000, 0, false)).toBe(divergingColor(0, 1, false));
  });
});

describe('heatmap hit testing', () => {
  const geom = { plotX: 50, plotY: 10, plotW: 100, plotH: 200 };

  it('maps plot-area x pixels to column indices', () => {
    expect(heatmapColumnAtX(50, geom, 10)).toBe(0);
    expect(heatmapColumnAtX(59.9, geom, 10)).toBe(0);
    expect(heatmapColumnAtX(60, geom, 10)).toBe(1);
    expect(heatmapColumnAtX(149.9, geom, 10)).toBe(9);
  });

  it('returns -1 outside the plot rect', () => {
    expect(heatmapColumnAtX(49, geom, 10)).toBe(-1);
    expect(heatmapColumnAtX(150, geom, 10)).toBe(-1);
    expect(heatmapYearAtY(9, geom, 20)).toBe(-1);
    expect(heatmapYearAtY(210, geom, 20)).toBe(-1);
  });

  it('maps plot-area y pixels to year indices (year 1 at the top)', () => {
    expect(heatmapYearAtY(10, geom, 20)).toBe(0);
    expect(heatmapYearAtY(19.9, geom, 20)).toBe(0);
    expect(heatmapYearAtY(20, geom, 20)).toBe(1);
    expect(heatmapYearAtY(209.9, geom, 20)).toBe(19);
  });
});

describe('formatHeatmapTooltip', () => {
  it('names the single run and shows a signed delta vs plan', () => {
    const tip = formatHeatmapTooltip({
      year: 12,
      pctLabel: 'P37',
      simIndex: 41,
      value: 58_000,
      plan: 55_000,
      runCount: 1,
    });
    expect(tip.title).toBe('Year 12 · P37 · Simulation #42');
    expect(tip.rows.some((r) => r.startsWith('Withdrawal '))).toBe(true);
    expect(tip.rows.some((r) => r.startsWith('Plan '))).toBe(true);
    expect(tip.rows.find((r) => r.endsWith('vs plan')).startsWith('+')).toBe(true);
    expect(tip.footer).toBe('Click to see this path');
  });

  it('shows the band size instead of a run id for averaged columns', () => {
    const tip = formatHeatmapTooltip({
      year: 3,
      pctLabel: 'P20',
      simIndex: 7,
      value: 40_000,
      plan: 55_000,
      runCount: 13,
    });
    expect(tip.title).toBe('Year 3 · P20');
    expect(tip.rows).toContain('avg of 13 runs');
    expect(tip.rows.find((r) => r.endsWith('vs plan')).startsWith('−')).toBe(true);
  });
});
