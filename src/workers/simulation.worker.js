// Runs the Monte Carlo off the main thread so the UI never freezes.
// Receives a `params` object, streams progress, and posts back a compact,
// chart-ready result (only the ~106 paths that are actually visualised).

import { runMonteCarlo, regeneratePath } from '../core/simulation.js';
import {
  rankByWithdrawn,
  percentileIndex,
  successRate,
  median,
  buildHistogram,
} from '../core/statistics.js';

const PERCENTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const SURFACE_SAMPLES = 200;
const HISTOGRAM_BINS = 75;

self.onmessage = (e) => {
  const { type, params } = e.data || {};
  if (type !== 'run') return;

  try {
    const result = runMonteCarlo(params, {
      onProgress: (fraction) => self.postMessage({ type: 'progress', fraction }),
    });

    const n = result.numSimulations;
    const numYears = params.numYears;

    // Percentile cards & timelines use the total-withdrawn ranking.
    const rankW = rankByWithdrawn(result);
    const percentiles = {};
    for (const p of PERCENTILES) {
      const simIndex = rankW[percentileIndex(n, p)];
      const re = regeneratePath(params, result.baseSeed, simIndex);
      percentiles[`p${Math.round(p * 100)}`] = {
        totalWithdrawn: result.totalWithdrawn[simIndex],
        finalBalance: result.finalBalance[simIndex],
        avgReturn: result.avgReturn[simIndex],
        path: re.path,
      };
    }

    // 3D topography samples paths across the SAME total-withdrawn ranking used
    // by the percentile cards, so the X axis P10..P60 is consistent.
    const p10i = percentileIndex(n, 0.1);
    const p60i = percentileIndex(n, 0.6);
    const step = Math.max(1, Math.floor((p60i - p10i) / SURFACE_SAMPLES));
    const surfacePaths = [];
    for (let i = 0; i < SURFACE_SAMPLES; i++) {
      const rankIndex = Math.min(p10i + i * step, p60i);
      const simIndex = rankW[rankIndex];
      const re = regeneratePath(params, result.baseSeed, simIndex);
      surfacePaths.push({
        balances: re.path.balances,
        returns: re.path.returns,
        withdrawals: re.path.withdrawals,
        totalWithdrawn: result.totalWithdrawn[simIndex],
        avgReturn: result.avgReturn[simIndex],
      });
    }

    const histogram = buildHistogram(result.avgReturn, HISTOGRAM_BINS);

    self.postMessage({
      type: 'done',
      result: {
        numSimulations: n,
        numYears,
        seed: result.baseSeed,
        successRate: successRate(result.depletionYear, numYears),
        medianBalance: median(result.finalBalance),
        medianWithdrawn: median(result.totalWithdrawn),
        percentiles,
        surfacePaths,
        histogram,
      },
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
