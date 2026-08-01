// Sub-worker chunk: run a Monte Carlo slice and transfer TypedArray buffers back.

import { runMonteCarlo } from '../../core/simulation.js';

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

/** Run one chunk; `target` is `self` or a MessagePort. */
export function handleChunkMessage(target, data) {
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

/** Dispatcher entry for `type: 'chunk'` on the worker itself. */
export function handleChunk(_ctx, data) {
  handleChunkMessage(self, data);
}
