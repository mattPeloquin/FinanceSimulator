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

function postChunkResult(target, startIndex, numSimulations, result) {
  target.postMessage(
    {
      type: 'chunkDone',
      startIndex,
      numSimulations,
      buffers: {
        avgReturn: result.avgReturn.buffer,
        finalBalance: result.finalBalance.buffer,
        totalWithdrawn: result.totalWithdrawn.buffer,
        medianYearlyWithdrawal: result.medianYearlyWithdrawal.buffer,
        earlyWithdrawn: result.earlyWithdrawn.buffer,
        depletionYear: result.depletionYear.buffer,
        horizonYears: result.horizonYears.buffer,
        allYearsReturns: result.allYearsReturns.buffer,
      },
    },
    [
      result.avgReturn.buffer,
      result.finalBalance.buffer,
      result.totalWithdrawn.buffer,
      result.medianYearlyWithdrawal.buffer,
      result.earlyWithdrawn.buffer,
      result.depletionYear.buffer,
      result.horizonYears.buffer,
      result.allYearsReturns.buffer,
    ],
  );
}

function handleChunkMessage(target, data) {
  const { params, startIndex, numSimulations } = data;
  try {
    const result = runMonteCarlo(
      { ...params, numSimulations },
      { startIndex },
    );
    postChunkResult(target, startIndex, numSimulations, result);
  } catch (err) {
    target.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
}

self.onmessage = async (e) => {
  const { type, params, goalSeekConfig, numCores, subWorkerPorts } = e.data || {};

  // Sub-worker role: chunk requests arrive over a MessagePort wired up by the
  // main thread (workers can't reliably spawn their own sub-workers on file://).
  if (type === 'connect') {
    const port = e.data.port;
    port.onmessage = (pe) => {
      if (pe.data && pe.data.type === 'chunk') handleChunkMessage(port, pe.data);
    };
    return;
  }

  if (type === 'chunk') {
    handleChunkMessage(self, e.data);
    return;
  }

  const pool = new ParallelPool(subWorkerPorts || [], numCores || 1);
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
        finalParams,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    } finally {
      pool.terminate();
    }
    return;
  }
};
