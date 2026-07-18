import { describe, it, expect } from 'vitest';
import {
  rankForOverviewColumn,
  expandRankWindow,
  sampleRanks,
  percentileLabelForRank,
  ranksForPercentileWindow,
  SURFACE_DRILLDOWN_SAMPLES,
  SURFACE_OVERVIEW_SAMPLES,
} from '../src/core/surfaceDrilldown.js';
import { percentileIndex } from '../src/core/statistics.js';

describe('rankForOverviewColumn', () => {
  const meta = { p5Rank: 50, p65Rank: 600, surfaceSamples: 200 };

  it('matches the worker step formula', () => {
    const step = Math.max(1, Math.floor((600 - 50) / 200));
    expect(step).toBe(2);
    expect(rankForOverviewColumn(0, meta)).toBe(50);
    expect(rankForOverviewColumn(1, meta)).toBe(52);
    expect(rankForOverviewColumn(199, meta)).toBe(448);
  });

  it('handles small simulation counts', () => {
    const small = { p5Rank: 5, p65Rank: 65, surfaceSamples: 200 };
    expect(rankForOverviewColumn(0, small)).toBe(5);
    expect(rankForOverviewColumn(60, small)).toBe(65);
  });

  it('samples evenly across an arbitrary rank window', () => {
    const lo = 100;
    const hi = 900;
    const step = Math.max(1, Math.floor((hi - lo) / 200));
    expect(rankForOverviewColumn(0, meta, lo, hi)).toBe(lo);
    expect(rankForOverviewColumn(1, meta, lo, hi)).toBe(lo + step);
    expect(rankForOverviewColumn(199, meta, lo, hi)).toBe(
      Math.min(lo + 199 * step, hi),
    );
  });
});

describe('ranksForPercentileWindow', () => {
  it('matches percentileIndex for slider endpoints', () => {
    const n = 1000;
    const { loRank, hiRank } = ranksForPercentileWindow(n, 5, 65);
    expect(loRank).toBe(percentileIndex(n, 0.05));
    expect(hiRank).toBe(percentileIndex(n, 0.65));
  });

  it('clamps P100 to the last valid rank', () => {
    const n = 1000;
    const { loRank, hiRank } = ranksForPercentileWindow(n, 0, 100);
    expect(loRank).toBe(0);
    expect(hiRank).toBe(n - 1);
  });
});

describe('expandRankWindow', () => {
  it('expands symmetrically from a single rank', () => {
    const { lo, hi } = expandRankWindow(500, 10_000, 200);
    expect(hi - lo + 1).toBe(200);
    expect(lo).toBe(400);
    expect(hi).toBe(599);
  });

  it('stops at simulation bounds', () => {
    const { lo, hi } = expandRankWindow(50, 100, 200);
    expect(lo).toBe(0);
    expect(hi).toBe(99);
    expect(hi - lo + 1).toBe(100);
  });
});

describe('sampleRanks', () => {
  it('is deterministic for the same seed', () => {
    const a = sampleRanks(100, 400, 50, 12345);
    const b = sampleRanks(100, 400, 50, 12345);
    expect(a).toEqual(b);
  });

  it('returns the requested count sorted ascending', () => {
    const ranks = sampleRanks(0, 999, SURFACE_DRILLDOWN_SAMPLES, 99);
    expect(ranks.length).toBe(SURFACE_DRILLDOWN_SAMPLES);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it('returns unique ranks when the window is wide enough', () => {
    const ranks = sampleRanks(0, 499, 200, 7);
    expect(new Set(ranks).size).toBe(200);
  });

  it('allows duplicates when the window is narrower than the sample count', () => {
    const ranks = sampleRanks(10, 15, 20, 42);
    expect(ranks.length).toBe(20);
    expect(new Set(ranks).size).toBeLessThan(20);
  });
});

describe('percentileLabelForRank', () => {
  it('rounds to whole percentiles by default', () => {
    expect(percentileLabelForRank(351, 1000)).toBe('P35');
  });

  it('supports fixed decimal places for drill-down labels', () => {
    expect(percentileLabelForRank(350, 1000, 2)).toBe('P35.00');
    expect(percentileLabelForRank(351, 1000, 2)).toBe('P35.10');
  });
});

describe('SURFACE_OVERVIEW_SAMPLES', () => {
  it('matches the packaged overview column count', () => {
    expect(SURFACE_OVERVIEW_SAMPLES).toBe(200);
  });
});
