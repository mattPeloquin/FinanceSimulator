// Runs the Monte Carlo off the main thread so the UI never freezes.
// Receives a `params` object, streams progress, and posts back a compact,
// chart-ready result (only the ~106 paths that are actually visualised).
//
// Acts as either the Master Orchestrator (run / goalSeek) or a Sub-Worker
// (chunk) depending on the message type.

import { runMonteCarlo } from '../core/simulation.js';
import { buildRunResult } from '../core/resultPackaging.js';
import { runGoalSeek } from '../core/goalSeek.js';
import { ParallelPool } from './parallelPool.js';

// Vite resolves this to the worker entry in dev and to the bundled worker in production.
const SUB_WORKER_URL = new URL('./simulation.worker.js', import.meta.url);

function postChunkResult(startIndex, numSimulations, result) {
  self.postMessage(
    {
      type: 'chunkDone',
      startIndex,
      numSimulations,
      buffers: {
        avgReturn: result.avgReturn.buffer,
        finalBalance: result.finalBalance.buffer,
        totalWithdrawn: result.totalWithdrawn.buffer,
        earlyWithdrawn: result.earlyWithdrawn.buffer,
        depletionYear: result.depletionYear.buffer,
        allYearsReturns: result.allYearsReturns.buffer,
      },
    },
    [
      result.avgReturn.buffer,
      result.finalBalance.buffer,
      result.totalWithdrawn.buffer,
      result.earlyWithdrawn.buffer,
      result.depletionYear.buffer,
      result.allYearsReturns.buffer,
    ],
  );
}

self.onmessage = async (e) => {
  const { type, params, goalSeekConfig, numCores, startIndex, numSimulations } = e.data || {};

  if (type === 'chunk') {
    try {
      const result = runMonteCarlo(
        { ...params, numSimulations },
        { startIndex },
      );
      postChunkResult(startIndex, numSimulations, result);
    } catch (err) {
      self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
    return;
  }

  const pool = new ParallelPool(SUB_WORKER_URL, numCores || 1);
  const simulateAsync = (simParams) => pool.run(simParams);

  if (type === 'run') {
    try {
      const result = await pool.run(params, {
        onProgress: (fraction) => self.postMessage({ type: 'progress', fraction }),
      });
      self.postMessage({ type: 'done', result: buildRunResult(params, result) });
    } catch (err) {
      self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    } finally {
      pool.terminate();
    }
    return;
  }

  if (type === 'goalSeek') {
    try {
      const { params: finalParams, summary } = await runGoalSeek(params, goalSeekConfig, simulateAsync, {
        onProgress: (stage, fraction) => self.postMessage({ type: 'progress', stage, fraction }),
      });

      if (!summary.feasible) {
        self.postMessage({ type: 'done', result: null, goalSeekSummary: summary });
        return;
      }

      const confirmation = await pool.run(finalParams, {
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
    } finally {
      pool.terminate();
    }
    return;
  }
};
