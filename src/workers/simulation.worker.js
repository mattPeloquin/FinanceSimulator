// Runs the Monte Carlo off the main thread so the UI never freezes.
// Receives a `params` object, streams progress, and posts back a compact,
// chart-ready result (only the ~106 paths that are actually visualised).
//
// Acts as either the Master Orchestrator (run / goalSeek) or a Sub-Worker
// (chunk) depending on the message type.

import { runMonteCarlo } from '../core/simulation.js';
import { buildRunResult } from '../core/resultPackaging.js';
import { runGoalSeek } from '../core/goalSeek.js';
import {
  buildClassicFourPercentParams,
  buildFourPercentComparison,
} from '../core/fourPercentComparison.js';
import { ParallelPool } from './parallelPool.js';

/** After the user's run, re-simulate a flat real 4% rule on the same paths. */
async function packageWithFourPercentComparison(pool, params, userRaw, {
  shortfallTolerance,
  userProgressScale = 0.5,
} = {}) {
  const userResult = shortfallTolerance == null
    ? buildRunResult(params, userRaw)
    : buildRunResult(params, userRaw, { shortfallTolerance });

  const classicParams = buildClassicFourPercentParams(params);
  const classicRaw = await pool.run(classicParams, {
    onProgress: (fraction) =>
      self.postMessage({
        type: 'progress',
        stage: 'Comparing to the classic 4% rule',
        // First half of the bar was the user plan; map this pass into the second half.
        fraction: userProgressScale + fraction * (1 - userProgressScale),
      }),
  });
  const classicResult = shortfallTolerance == null
    ? buildRunResult(classicParams, classicRaw)
    : buildRunResult(classicParams, classicRaw, { shortfallTolerance });
  const fourPercentComparison = buildFourPercentComparison(userResult, classicResult, params);
  return { userResult, classicResult, fourPercentComparison };
}

function postChunkResult(target, startIndex, numSimulations, result) {
  target.postMessage(
    {
      type: 'chunkDone',
      startIndex,
      numSimulations,
      buffers: {
        avgReturn: result.avgReturn.buffer,
        irr: result.irr.buffer,
        finalBalance: result.finalBalance.buffer,
        totalWithdrawn: result.totalWithdrawn.buffer,
        totalNetSpend: result.totalNetSpend.buffer,
        medianYearlyWithdrawal: result.medianYearlyWithdrawal.buffer,
        medianYearlyNetSpend: result.medianYearlyNetSpend.buffer,
        earlyWithdrawn: result.earlyWithdrawn.buffer,
        depletionYear: result.depletionYear.buffer,
        horizonYears: result.horizonYears.buffer,
        allYearsReturns: result.allYearsReturns.buffer,
        allYearsWithdrawals: result.allYearsWithdrawals.buffer,
        allYearsNetSpend: result.allYearsNetSpend.buffer,
        allYearsBalances: result.allYearsBalances.buffer,
      },
    },
    [
      result.avgReturn.buffer,
      result.irr.buffer,
      result.finalBalance.buffer,
      result.totalWithdrawn.buffer,
      result.totalNetSpend.buffer,
      result.medianYearlyWithdrawal.buffer,
      result.medianYearlyNetSpend.buffer,
      result.earlyWithdrawn.buffer,
      result.depletionYear.buffer,
      result.horizonYears.buffer,
      result.allYearsReturns.buffer,
      result.allYearsWithdrawals.buffer,
      result.allYearsNetSpend.buffer,
      result.allYearsBalances.buffer,
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
      const userRaw = await pool.run(params, {
        onProgress: (fraction) =>
          self.postMessage({
            type: 'progress',
            stage: 'Running your plan',
            // Reserve the second half of the bar for the classic 4% comparison.
            fraction: fraction * 0.5,
          }),
      });
      const { userResult, classicResult, fourPercentComparison } =
        await packageWithFourPercentComparison(pool, params, userRaw);
      self.postMessage({
        type: 'done',
        result: userResult,
        classicResult,
        fourPercentComparison,
      });
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

      // Confirmation + classic comparison share the final progress window:
      // 0–50% confirming the found plan, 50–100% classic 4% benchmark.
      const confirmation = await pool.run(finalParams, {
        onProgress: (fraction) =>
          self.postMessage({
            type: 'progress',
            stage: 'Confirming final plan',
            fraction: fraction * 0.5,
          }),
      });
      // Blue below-plan tags / on-plan success % use Advanced → Plan Risk
      // Tolerance (on sim params), not Find Best Plan's search Risk Tolerance.
      const shortfallTolerance = finalParams.shortfallTolerance ?? params.shortfallTolerance ?? 0.05;
      const { userResult, classicResult, fourPercentComparison } =
        await packageWithFourPercentComparison(pool, finalParams, confirmation, {
          shortfallTolerance,
        });
      self.postMessage({
        type: 'done',
        result: userResult,
        classicResult,
        fourPercentComparison,
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
