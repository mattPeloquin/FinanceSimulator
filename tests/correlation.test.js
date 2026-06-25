import { describe, it, expect } from 'vitest';
import {
  computeCorrelationMatrix,
  choleskyDecompose,
  correlationCholesky,
} from '../src/core/history.js';
import { simulatePath } from '../src/core/simulation.js';
import { createRng, deriveSeed } from '../src/core/rng.js';

// Pearson correlation over two paired series.
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    sx += (xs[i] - mx) ** 2;
    sy += (ys[i] - my) ** 2;
  }
  return cov / Math.sqrt(sx * sy);
}

describe('correlation matrix + cholesky', () => {
  const keys = ['a', 'b'];
  // b is perfectly correlated with a (b = 2a + const) -> corr 1.
  const records = [
    { a: 1, b: 3 },
    { a: 2, b: 5 },
    { a: 3, b: 7 },
    { a: 4, b: 9 },
  ];

  it('produces a symmetric matrix with unit diagonal', () => {
    const M = computeCorrelationMatrix(records, keys);
    expect(M[0][0]).toBeCloseTo(1, 12);
    expect(M[1][1]).toBeCloseTo(1, 12);
    expect(M[0][1]).toBeCloseTo(M[1][0], 12);
    expect(M[0][1]).toBeCloseTo(1, 6);
  });

  it('cholesky reconstructs the original matrix (L·Lᵀ = M)', () => {
    const M = [
      [1, 0.5],
      [0.5, 1],
    ];
    const L = choleskyDecompose(M);
    const r00 = L[0][0] * L[0][0];
    const r10 = L[1][0] * L[0][0];
    const r11 = L[1][0] * L[1][0] + L[1][1] * L[1][1];
    expect(r00).toBeCloseTo(1, 12);
    expect(r10).toBeCloseTo(0.5, 12);
    expect(r11).toBeCloseTo(1, 12);
  });

  it('returns null without enough records', () => {
    expect(correlationCholesky([], keys)).toBeNull();
    expect(correlationCholesky([{ a: 1, b: 1 }], keys)).toBeNull();
  });
});

describe('log-normal simulation honours correlation', () => {
  // Two assets target a strong positive correlation; the rest are neutral.
  function chol7(rho) {
    const M = Array.from({ length: 7 }, (_, i) =>
      Array.from({ length: 7 }, (_, j) => (i === j ? 1 : 0))
    );
    M[0][1] = rho;
    M[1][0] = rho;
    return choleskyDecompose(M);
  }

  function profiles(chol) {
    const a = { mean: 0.08, stdDev: 0.18 };
    return {
      usLgGrowth: a,
      usLgValue: a,
      usSmMid: a,
      exUs: a,
      bond: { mean: 0.03, stdDev: 0.06 },
      cash: { mean: 0.02, stdDev: 0.01 },
      inflation: { mean: 0.025, stdDev: 0.02 },
      chol,
    };
  }

  function baseParams(chol) {
    return {
      numYears: 200,
      distMethod: 'lognormal',
      blockSize: 1,
      allocation: { usLgGrowth: 1, usLgValue: 0, usSmMid: 0, exUs: 0, bond: 0, cash: 0 },
      logNormal: profiles(chol),
      portfolio: {
        start: 1e9,
        base: 0,
        floorBalance: 0,
        floorPenalty: 0,
        ceilingBalance: Infinity,
        ceilingBonus: 0,
      },
      dynConfig: {
        low: { ret: -100, bal: 0, adj: 0 },
        med: { ret: 0, bal: 1e12, adj: 0 },
        high: { ret: 100, bal: 1e12, adj: 0 },
      },
      samples: null,
    };
  }

  // Run many years and collect the two leading assets' realised returns to
  // measure their empirical correlation. We reconstruct per-asset returns by
  // weighting allocation entirely on one asset at a time.
  function assetSeries(chol, assetIndex) {
    const params = baseParams(chol);
    const alloc = [0, 0, 0, 0, 0, 0];
    alloc[assetIndex] = 1;
    params.allocation = {
      usLgGrowth: alloc[0], usLgValue: alloc[1], usSmMid: alloc[2],
      exUs: alloc[3], bond: alloc[4], cash: alloc[5],
    };
    // Use the SAME seed so the underlying normal draws line up across calls.
    const rng = createRng(deriveSeed(42, 0));
    const s = simulatePath(params, rng, true);
    return s.path.returns;
  }

  it('induces positive correlation between assets when requested', () => {
    const chol = chol7(0.9);
    const seriesA = assetSeries(chol, 0);
    const seriesB = assetSeries(chol, 1);
    expect(pearson(seriesA, seriesB)).toBeGreaterThan(0.6);
  });

  it('leaves assets roughly uncorrelated without a cholesky factor', () => {
    const seriesA = assetSeries(null, 0);
    const seriesB = assetSeries(null, 1);
    expect(Math.abs(pearson(seriesA, seriesB))).toBeLessThan(0.3);
  });
});
