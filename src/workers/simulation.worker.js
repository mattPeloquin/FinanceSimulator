// Runs the Monte Carlo off the main thread so the UI never freezes.
// Receives a `params` object, streams progress, and posts back a compact,
// chart-ready result (only the ~106 paths that are actually visualised).

import { runMonteCarlo } from '../core/simulation.js';
import { buildRunResult } from '../core/resultPackaging.js';
import { runGoalSeek } from '../core/goalSeek.js';

self.onmessage = (e) => {
  const { type, params, goalSeekConfig } = e.data || {};

  if (type === 'run') {
    try {
      const result = runMonteCarlo(params, {
        onProgress: (fraction) => self.postMessage({ type: 'progress', fraction }),
      });
      self.postMessage({ type: 'done', result: buildRunResult(params, result) });
    } catch (err) {
      self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
    return;
  }

  if (type === 'goalSeek') {
    try {
      const { params: finalParams, summary } = runGoalSeek(params, goalSeekConfig, {
        onProgress: (stage, fraction) => self.postMessage({ type: 'progress', stage, fraction }),
      });

      if (!summary.feasible) {
        self.postMessage({ type: 'done', result: null, goalSeekSummary: summary });
        return;
      }

      const confirmation = runMonteCarlo(finalParams, {
        onProgress: (fraction) =>
          self.postMessage({ type: 'progress', stage: 'Confirming final plan', fraction }),
      });
      self.postMessage({
        type: 'done',
        result: buildRunResult(finalParams, confirmation, {
          shortfallTolerance: goalSeekConfig.shortfallTolerance ?? 0.05,
        }),
        goalSeekSummary: summary,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
    return;
  }
};
