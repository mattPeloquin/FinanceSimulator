import { describe, it, expect } from 'vitest';
import {
  belowArmEnd,
  divergingColor,
  heatmapColumnAtX,
  heatmapYearAtY,
  heatmapRowLayout,
  smoothColumnSeries,
  tickMsForSpeed,
  windowAnchorSeries,
  windowDeltaDomain,
  windowAbsoluteDomain,
  formatHeatmapTooltip,
} from '../src/ui/charts/withdrawalHeatmap.js';

function channels(rgb) {
  return rgb.match(/\d+/g).map(Number);
}

describe('divergingColor (asymmetric PuOr transfer)', () => {
  // Shallow cuts vs deep boosts — the common case the below-arm floor fixes.
  const shallowLo = { lo: 33_000, hi: 169_000 };
  // Deep cuts vs smaller boosts — below arm uses its own lo end.
  const deepLo = { lo: 40_000, hi: 10_000 };
  const dom = shallowLo;

  it('returns the mode-specific neutral midpoint exactly on the anchor', () => {
    expect(divergingColor(0, dom, false)).toBe('rgb(152, 148, 176)'); // #9894b0 (light)
    expect(divergingColor(0, dom, true)).toBe('rgb(74, 72, 98)'); // #4a4862 (dark)
  });

  it('floors the below arm at the above arm so shallow cuts do not peak early', () => {
    expect(belowArmEnd(shallowLo)).toBe(169_000);
    expect(belowArmEnd(deepLo)).toBe(40_000);
    // −33k on a +169k above arm matches coloring as if the spectrum ran to −169k.
    expect(divergingColor(-33_000, shallowLo, false)).toBe(divergingColor(-33_000, { lo: 169_000, hi: 169_000 }, false));
    // Peak orange only once |delta| reaches the floored below end (= hi here).
    expect(divergingColor(-shallowLo.hi, shallowLo, false)).toBe('rgb(230, 97, 1)'); // #e66101
    expect(divergingColor(-shallowLo.lo, shallowLo, false)).not.toBe('rgb(230, 97, 1)');
  });

  it('reaches the poles at each arm’s effective end', () => {
    expect(divergingColor(-belowArmEnd(shallowLo), shallowLo, false)).toBe('rgb(230, 97, 1)'); // #e66101
    expect(divergingColor(shallowLo.hi, shallowLo, false)).toBe('rgb(13, 148, 136)'); // #0d9488
    expect(divergingColor(-belowArmEnd(deepLo), deepLo, false)).toBe('rgb(230, 97, 1)');
    expect(divergingColor(deepLo.hi, deepLo, false)).toBe('rgb(13, 148, 136)');
    expect(divergingColor(-belowArmEnd(shallowLo), shallowLo, true)).toBe('rgb(230, 97, 1)');
    expect(divergingColor(shallowLo.hi, shallowLo, true)).toBe('rgb(13, 148, 136)');
  });

  it('keeps a wide neutral band near the anchor (gamma > 1)', () => {
    const mid = channels(divergingColor(0, dom, false));
    const justAbove = channels(divergingColor(dom.hi * 0.02, dom, false));
    const justBelow = channels(divergingColor(-belowArmEnd(dom) * 0.02, dom, false));
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    // At 2% of each arm, color barely moves — the middle stays wide.
    expect(dist(mid, justAbove)).toBeLessThan(25);
    expect(dist(mid, justBelow)).toBeLessThan(25);
  });

  it('keeps below-arm saturation when cuts exceed the top range', () => {
    // Same absolute delta on a deep-lo domain: 8k is 20% of the below end (40k)
    // but 80% of the above end (10k), so above sits closer to its pole.
    const below = channels(divergingColor(-8_000, deepLo, false));
    const above = channels(divergingColor(8_000, deepLo, false));
    const poleBelow = channels(divergingColor(-belowArmEnd(deepLo), deepLo, false));
    const poleAbove = channels(divergingColor(deepLo.hi, deepLo, false));
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    expect(dist(above, poleAbove)).toBeLessThan(dist(below, poleBelow));
  });

  it('clamps deltas beyond each arm’s effective end to the poles', () => {
    const belowEnd = belowArmEnd(shallowLo);
    expect(divergingColor(-3 * belowEnd, shallowLo, false)).toBe(divergingColor(-belowEnd, shallowLo, false));
    expect(divergingColor(3 * shallowLo.hi, shallowLo, false)).toBe(divergingColor(shallowLo.hi, shallowLo, false));
  });

  it('degrades to the midpoint when a domain side is zero', () => {
    expect(divergingColor(5_000, { lo: 1, hi: 0 }, false)).toBe(divergingColor(0, dom, false));
  });
});

describe('heatmapRowLayout', () => {
  it('is a uniform grid at emphasis 0', () => {
    const b = heatmapRowLayout(10, 0);
    expect(b[0]).toBe(0);
    expect(b[10]).toBe(1);
    for (let j = 0; j <= 10; j++) expect(b[j]).toBeCloseTo(j / 10, 10);
  });

  it('makes the first year ~5× the last at emphasis 100', () => {
    const b = heatmapRowLayout(30, 100);
    const first = b[1] - b[0];
    const last = b[30] - b[29];
    expect(first / last).toBeCloseTo(5, 1);
    // Strictly decreasing heights, cumulative stays monotone and normalized.
    for (let j = 1; j < 30; j++) {
      expect(b[j + 1] - b[j]).toBeLessThan(b[j] - b[j - 1]);
    }
    expect(b[30]).toBe(1);
  });

  it('biases early years ~3× at the default mid emphasis (50)', () => {
    const b = heatmapRowLayout(30, 50);
    const first = b[1] - b[0];
    const last = b[30] - b[29];
    expect(first / last).toBeCloseTo(3, 1);
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

  it('maps plot-area y pixels to year indices (year 1 at the bottom)', () => {
    expect(heatmapYearAtY(10, geom, 20)).toBe(19);
    expect(heatmapYearAtY(19.9, geom, 20)).toBe(19);
    expect(heatmapYearAtY(20, geom, 20)).toBe(18);
    expect(heatmapYearAtY(209.9, geom, 20)).toBe(0);
  });

  it('agrees with a uniform layout and round-trips a distorted one', () => {
    const numYears = 20;
    const uniform = heatmapRowLayout(numYears, 0);
    for (const y of [10, 19.9, 20, 105, 209.9]) {
      expect(heatmapYearAtY(y, geom, numYears, uniform)).toBe(heatmapYearAtY(y, geom, numYears));
    }
    const distorted = heatmapRowLayout(numYears, 100);
    for (let j = 0; j < numYears; j++) {
      const mid = (distorted[j] + distorted[j + 1]) / 2;
      const y = geom.plotY + geom.plotH * (1 - mid);
      expect(heatmapYearAtY(y, geom, numYears, distorted)).toBe(j);
    }
  });
});

describe('smoothColumnSeries', () => {
  it('keeps a flat series flat', () => {
    const out = smoothColumnSeries([10, 10, 10, 10], 4);
    expect(out.length).toBe(16);
    for (const v of out) expect(v).toBeCloseTo(10, 10);
  });

  it('turns a step between years into a monotone gradient', () => {
    const out = smoothColumnSeries([10, 20], 8);
    for (let k = 1; k < out.length; k++) {
      expect(out[k]).toBeGreaterThanOrEqual(out[k - 1]);
    }
    expect(out[0]).toBeLessThan(out[out.length - 1]);
  });

  it('never bleeds values across a NaN horizon boundary', () => {
    const out = smoothColumnSeries([5, 5, NaN, NaN], 4);
    // Sub-samples whose nearest year is finite keep the value; the rest are
    // NaN — the horizon edge stays hard at the half-year boundary.
    for (let k = 0; k < 8; k++) expect(out[k]).toBeCloseTo(5, 10);
    for (let k = 8; k < 16; k++) expect(Number.isNaN(out[k])).toBe(true);
  });
});

describe('tickMsForSpeed', () => {
  it('maps the 10 slider settings to the cadence range, biased fast', () => {
    expect(tickMsForSpeed(1)).toBe(800);
    expect(tickMsForSpeed(10)).toBe(40);
    for (let s = 2; s <= 10; s++) {
      expect(tickMsForSpeed(s)).toBeLessThan(tickMsForSpeed(s - 1));
    }
    // Quadratic bias: the midpoint setting is already well under the linear
    // midpoint of the interval range.
    expect(tickMsForSpeed(5)).toBeLessThan((800 + 40) / 2);
  });
});

describe('windowAnchorSeries', () => {
  // 3 columns × 2 years, column-major values[col*numYears + year].
  const values = Float64Array.from([
    10, 100, // col 0
    20, 200, // col 1
    60, NaN, // col 2 (year 1 past its horizon)
  ]);
  const counts = Int32Array.from([1, 1, 2]);

  it('computes the band-size-weighted mean and cell median per year', () => {
    const { mean, median } = windowAnchorSeries(values, counts, 2, 0, 3);
    // Year 0: (10·1 + 20·1 + 60·2) / 4 = 37.5; median of [10, 20, 60] = 20.
    expect(mean[0]).toBeCloseTo(37.5, 10);
    expect(median[0]).toBe(20);
    // Year 1: col 2 is NaN → (100·1 + 200·1) / 2; median of [100, 200] = 150.
    expect(mean[1]).toBeCloseTo(150, 10);
    expect(median[1]).toBe(150);
  });

  it('responds to the window bounds', () => {
    const { mean } = windowAnchorSeries(values, counts, 2, 0, 2);
    expect(mean[0]).toBeCloseTo(15, 10);
    const narrow = windowAnchorSeries(values, counts, 2, 2, 3);
    expect(narrow.mean[0]).toBe(60);
    // A year with no finite cells in the window anchors to NaN.
    expect(Number.isNaN(narrow.mean[1])).toBe(true);
    expect(Number.isNaN(narrow.median[1])).toBe(true);
  });
});

describe('windowDeltaDomain', () => {
  it('mirrors the delta tails so a centered window stays balanced', () => {
    // One column, many years, deltas from -50..+49 around a zero anchor.
    const numYears = 100;
    const values = new Float64Array(numYears);
    for (let j = 0; j < numYears; j++) values[j] = j - 50;
    const anchor = new Float64Array(numYears); // all zeros
    const domain = windowDeltaDomain(values, anchor, numYears, 0, 1);
    // lo = |P2| = |-48|; hi = P98 = +48 — mirrored, not tied to the axis.
    expect(domain.lo).toBe(48);
    expect(domain.hi).toBe(48);
  });

  it('uses only the visible column slice', () => {
    // Three columns × one year: left-heavy cuts, right-heavy boosts.
    const values = Float64Array.from([-100, 0, 100]);
    const fullMean = Float64Array.from([0]);
    const leftMean = Float64Array.from([-50]);
    const full = windowDeltaDomain(values, fullMean, 1, 0, 3);
    const left = windowDeltaDomain(values, leftMean, 1, 0, 2);
    // Left window deltas vs its own mean are −50 and +50 → mirrored clamps.
    expect(left.lo).toBe(50);
    expect(left.hi).toBe(50);
    // Full window has larger tails than the left crop alone.
    expect(full.lo).toBeGreaterThanOrEqual(left.lo);
    expect(full.hi).toBeGreaterThanOrEqual(left.hi);
  });

  it('guards degenerate spreads', () => {
    const values = Float64Array.from([5, 5, 5]);
    const anchor = Float64Array.from([5]);
    const domain = windowDeltaDomain(values, anchor, 1, 0, 3);
    expect(domain.lo).toBe(1);
    expect(domain.hi).toBe(1);
  });
});

describe('windowAbsoluteDomain', () => {
  it('uses P2/P98 of finite cells in the visible window', () => {
    const values = Float64Array.from([
      10, 100,
      20, 200,
      60, 300,
    ]);
    const domain = windowAbsoluteDomain(values, 2, 0, 3);
    expect(domain.lo).toBe(10);
    expect(domain.hi).toBe(300);
    expect(domain.mid).toBeCloseTo(155, 10);
  });

  it('responds to the window bounds', () => {
    const values = Float64Array.from([10, 100, 20, 200, 60, 300]);
    const narrow = windowAbsoluteDomain(values, 2, 0, 2);
    expect(narrow.lo).toBe(10);
    expect(narrow.hi).toBe(200);
  });

  it('guards degenerate spreads', () => {
    const values = Float64Array.from([5, 5, 5]);
    const domain = windowAbsoluteDomain(values, 1, 0, 3);
    expect(domain.hi).toBeGreaterThan(domain.lo);
  });
});

describe('formatHeatmapTooltip', () => {
  it('names the single run and shows signed deltas vs plan and median', () => {
    const tip = formatHeatmapTooltip({
      year: 12,
      pctLabel: 'P37',
      simIndex: 41,
      value: 58_000,
      plan: 55_000,
      median: 52_000,
      runCount: 1,
    });
    expect(tip.title).toBe('Year 12 · P37 · Simulation #42');
    expect(tip.rows[0]).toBe('Withdrawal 58');
    expect(tip.rows[1]).toBe('+3 vs plan (55)');
    expect(tip.rows[2]).toBe('+6 vs year median (52)');
    expect(tip.footer).toBe('Click to see this path');
  });

  it('shows the band size instead of a run id for averaged columns', () => {
    const tip = formatHeatmapTooltip({
      year: 3,
      pctLabel: 'P20',
      simIndex: 7,
      value: 40_000,
      plan: 55_000,
      median: 52_000,
      runCount: 13,
    });
    expect(tip.title).toBe('Year 3 · P20');
    expect(tip.rows).toContain('avg of 13 runs');
    expect(tip.rows.find((r) => r.includes('vs year median')).startsWith('−')).toBe(true);
    expect(tip.rows.find((r) => r.includes('vs plan')).startsWith('−')).toBe(true);
  });
});
