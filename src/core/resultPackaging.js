// Turns a raw Monte Carlo run (from simulation.js) into the compact,
// chart-ready package the UI renders. Pulled out of the worker so both a
// normal "Run Simulation" and the Goal Seek search's final confirmation run
// can share the exact same rendering path.

import { regeneratePath } from './simulation.js';
import {
  rankByWithdrawn,
  percentileIndex,
  successRate,
  withdrawalTargetSuccessRate,
  median,
  buildHistogram,
  summarizeReturns,
} from './statistics.js';

const PERCENTILES = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const SURFACE_SAMPLES = 200;
const HISTOGRAM_BINS = 75;

// Build a smoothed "representative" outcome for a percentile by triangular-kernel
// averaging the band of runs whose total-withdrawn rank sits within ±halfW of the
// target rank. halfW = 0 collapses to the single run at that rank (no smoothing).
function smoothedPercentile(params, result, rankW, centerRank, halfW) {
  const n = rankW.length;
  const lo = Math.max(0, centerRank - halfW);
  const hi = Math.min(n - 1, centerRank + halfW);

  let balances = null;
  let withdrawals = null;
  let returns = null;
  let unadjustedWithdrawals = null;
  let totalWithdrawn = 0;
  let finalBalance = 0;
  let avgReturn = 0;
  let wSum = 0;

  for (let r = lo; r <= hi; r++) {
    const simIndex = rankW[r];
    const w = halfW > 0 ? 1 - Math.abs(r - centerRank) / (halfW + 1) : 1;
    const { path } = regeneratePath(params, result.baseSeed, simIndex);

    if (balances === null) {
      balances = new Array(path.balances.length).fill(0);
      withdrawals = new Array(path.withdrawals.length).fill(0);
      returns = new Array(path.returns.length).fill(0);
      unadjustedWithdrawals = path.unadjustedWithdrawals;
    }
    for (let t = 0; t < balances.length; t++) balances[t] += w * path.balances[t];
    for (let t = 0; t < withdrawals.length; t++) withdrawals[t] += w * path.withdrawals[t];
    for (let t = 0; t < returns.length; t++) returns[t] += w * path.returns[t];

    totalWithdrawn += w * result.totalWithdrawn[simIndex];
    finalBalance += w * result.finalBalance[simIndex];
    avgReturn += w * result.avgReturn[simIndex];
    wSum += w;
  }

  for (let t = 0; t < balances.length; t++) balances[t] /= wSum;
  for (let t = 0; t < withdrawals.length; t++) withdrawals[t] /= wSum;
  for (let t = 0; t < returns.length; t++) returns[t] /= wSum;

  return {
    totalWithdrawn: totalWithdrawn / wSum,
    finalBalance: finalBalance / wSum,
    avgReturn: avgReturn / wSum,
    path: { balances, withdrawals, returns, unadjustedWithdrawals },
    windowCount: hi - lo + 1,
  };
}

// Build the full chart-ready result package from a raw runMonteCarlo() output.
export function buildRunResult(params, result, { shortfallTolerance } = {}) {
  const tolerance = shortfallTolerance ?? params.shortfallTolerance ?? 0.05;
  const n = result.numSimulations;
  const numYears = params.numYears;

  // Percentile cards & timelines use the total-withdrawn ranking. Each is a
  // kernel-weighted average of the band of runs around the target rank, which
  // greatly reduces the run-to-run noise of a single representative path.
  const rankW = rankByWithdrawn(result);
  const halfW = Math.round((params.smoothFraction || 0) * n);
  const percentiles = {};
  for (const p of PERCENTILES) {
    const centerRank = percentileIndex(n, p);
    percentiles[`p${Math.round(p * 100)}`] = smoothedPercentile(params, result, rankW, centerRank, halfW);
  }

  // 3D topography samples paths across the SAME total-withdrawn ranking used
  // by the percentile cards, so the X axis P5..P60 is consistent.
  const p5i = percentileIndex(n, 0.05);
  const p60i = percentileIndex(n, 0.6);
  const step = Math.max(1, Math.floor((p60i - p5i) / SURFACE_SAMPLES));
  const surfacePaths = [];
  for (let i = 0; i < SURFACE_SAMPLES; i++) {
    const rankIndex = Math.min(p5i + i * step, p60i);
    const simIndex = rankW[rankIndex];
    const re = regeneratePath(params, result.baseSeed, simIndex);
    surfacePaths.push({
      balances: re.path.balances,
      returns: re.path.returns,
      withdrawals: re.path.withdrawals,
      unadjustedWithdrawals: re.path.unadjustedWithdrawals,
      totalWithdrawn: result.totalWithdrawn[simIndex],
      avgReturn: result.avgReturn[simIndex],
    });
  }

  const histogram = buildHistogram(result.avgReturn, HISTOGRAM_BINS);
  const returnSummary = summarizeReturns(result.avgReturn);
  const allYearsHistogram = buildHistogram(result.allYearsReturns, HISTOGRAM_BINS);
  const allYearsSummary = summarizeReturns(result.allYearsReturns);

  // The planned (unadjusted) withdrawal schedule ignores market returns, so it
  // is identical in every run — sum it once from the p50 path already in hand.
  const plannedWithdrawn = percentiles.p50.path.unadjustedWithdrawals.reduce((a, b) => a + b, 0);

  return {
    numSimulations: n,
    numYears,
    seed: result.baseSeed,
    successRate: successRate(result.depletionYear, numYears),
    withdrawalTargetSuccessRate: withdrawalTargetSuccessRate(
      result.totalWithdrawn,
      plannedWithdrawn,
      tolerance,
    ),
    shortfallTolerance: tolerance,
    medianBalance: median(result.finalBalance),
    medianWithdrawn: median(result.totalWithdrawn),
    plannedWithdrawn,
    percentiles,
    surfacePaths,
    surfaceMeta: {
      numSimulations: n,
      rankW,
      p5Rank: p5i,
      p60Rank: p60i,
      surfaceSamples: SURFACE_SAMPLES,
    },
    histogram,
    returnSummary,
    allYearsHistogram,
    allYearsSummary,
  };
}
