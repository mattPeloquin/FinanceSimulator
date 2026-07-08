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
  isMedianYearlyMetric,
  buildHistogram,
  summarizeReturns,
  irrFromPath,
} from './statistics.js';
import {
  plannedScheduleTotal,
  plannedScheduleMedianYearly,
  plannedYearlySchedule,
  buildPerRunPlanBenchmarks,
} from './goalSeek.js';

const PERCENTILES = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const SURFACE_SAMPLES = 200;
const HISTOGRAM_BINS = 75;

// Build a smoothed "representative" outcome for a percentile by triangular-kernel
// averaging the band of runs whose withdrawal rank sits within ±halfW of the
// target rank. When horizons differ, each year renormalizes weights over runs
// still active at that year.
function smoothedPercentile(params, result, rankW, centerRank, halfW) {
  const lo = Math.max(0, centerRank - halfW);
  const hi = Math.min(rankW.length - 1, centerRank + halfW);

  const entries = [];
  for (let r = lo; r <= hi; r++) {
    const simIndex = rankW[r];
    const w = halfW > 0 ? 1 - Math.abs(r - centerRank) / (halfW + 1) : 1;
    const re = regeneratePath(params, result.baseSeed, simIndex);
    entries.push({ w, path: re.path, simIndex, horizonYears: re.horizonYears });
  }

  let maxLen = 0;
  let totalWithdrawn = 0;
  let finalBalance = 0;
  let avgReturn = 0;
  let irr = 0;
  let irrWSum = 0;
  let medianYearlyWithdrawal = 0;
  let horizonYearsWeighted = 0;
  let wSum = 0;

  for (const e of entries) {
    maxLen = Math.max(maxLen, e.path.balances.length);
    totalWithdrawn += e.w * result.totalWithdrawn[e.simIndex];
    finalBalance += e.w * result.finalBalance[e.simIndex];
    avgReturn += e.w * result.avgReturn[e.simIndex];
    // IRR is NaN for pathological paths (no positive inflows); average the rest.
    const runIrr = result.irr[e.simIndex];
    if (!Number.isNaN(runIrr)) {
      irr += e.w * runIrr;
      irrWSum += e.w;
    }
    medianYearlyWithdrawal += e.w * result.medianYearlyWithdrawal[e.simIndex];
    horizonYearsWeighted += e.w * e.horizonYears;
    wSum += e.w;
  }

  const numYearsInPath = Math.max(0, maxLen - 1);
  const balances = new Array(maxLen).fill(0);
  const withdrawals = new Array(numYearsInPath).fill(0);
  const returns = new Array(numYearsInPath).fill(0);
  const weightByYearBal = new Array(maxLen).fill(0);
  const weightByYearWd = new Array(numYearsInPath).fill(0);

  for (const e of entries) {
    const p = e.path;
    for (let t = 0; t < p.balances.length; t++) {
      balances[t] += e.w * p.balances[t];
      weightByYearBal[t] += e.w;
    }
    for (let t = 0; t < p.withdrawals.length; t++) {
      withdrawals[t] += e.w * p.withdrawals[t];
      returns[t] += e.w * p.returns[t];
      weightByYearWd[t] += e.w;
    }
  }

  for (let t = 0; t < maxLen; t++) {
    if (weightByYearBal[t] > 0) balances[t] /= weightByYearBal[t];
  }
  for (let t = 0; t < numYearsInPath; t++) {
    if (weightByYearWd[t] > 0) {
      withdrawals[t] /= weightByYearWd[t];
      returns[t] /= weightByYearWd[t];
    }
  }

  return {
    totalWithdrawn: totalWithdrawn / wSum,
    medianYearlyWithdrawal: medianYearlyWithdrawal / wSum,
    finalBalance: finalBalance / wSum,
    avgReturn: avgReturn / wSum,
    irr: irrWSum > 0 ? irr / irrWSum : NaN,
    horizonYears: Math.round(horizonYearsWeighted / wSum),
    path: {
      balances,
      withdrawals,
      returns,
      unadjustedWithdrawals: entries[0]?.path.unadjustedWithdrawals ?? [],
    },
    windowCount: hi - lo + 1,
  };
}

function buildSurfacePathEntry(params, result, simIndex, benchmarkCache, useMedianYearly) {
  const re = regeneratePath(params, result.baseSeed, simIndex);
  const h = re.horizonYears;
  if (!benchmarkCache.has(h)) {
    benchmarkCache.set(
      h,
      useMedianYearly ? plannedScheduleMedianYearly(params.portfolio, h) : plannedScheduleTotal(params.portfolio, h),
    );
  }
  return {
    balances: re.path.balances,
    returns: re.path.returns,
    withdrawals: re.path.withdrawals,
    unadjustedWithdrawals: re.path.unadjustedWithdrawals,
    totalWithdrawn: result.totalWithdrawn[simIndex],
    medianYearlyWithdrawal: result.medianYearlyWithdrawal[simIndex],
    avgReturn: result.avgReturn[simIndex],
    irr: result.irr[simIndex],
    horizonYears: h,
    planBenchmark: benchmarkCache.get(h),
  };
}

// Build the full chart-ready result package from a raw runMonteCarlo() output.
export function buildRunResult(params, result, { shortfallTolerance } = {}) {
  const tolerance = shortfallTolerance ?? params.shortfallTolerance ?? 0.05;
  const n = result.numSimulations;
  const endpointYears = params.numYears;
  const maxYears = params.maxYears ?? endpointYears;
  const horizonVariable = params.horizonRange != null;
  const withdrawalMetric = params.withdrawalMetric || 'total';
  const useMedianYearly = isMedianYearlyMetric(withdrawalMetric);

  const rankW = rankByWithdrawn(result, withdrawalMetric);
  const halfW = Math.round((params.smoothFraction || 0) * n);
  const percentiles = {};
  for (const p of PERCENTILES) {
    const centerRank = percentileIndex(n, p);
    percentiles[`p${Math.round(p * 100)}`] = smoothedPercentile(params, result, rankW, centerRank, halfW);
  }

  const benchmarkCache = new Map();
  const p5i = percentileIndex(n, 0.05);
  const p60i = percentileIndex(n, 0.6);
  const step = Math.max(1, Math.floor((p60i - p5i) / SURFACE_SAMPLES));
  const surfacePaths = [];
  for (let i = 0; i < SURFACE_SAMPLES; i++) {
    const rankIndex = Math.min(p5i + i * step, p60i);
    const simIndex = rankW[rankIndex];
    surfacePaths.push(buildSurfacePathEntry(params, result, simIndex, benchmarkCache, useMedianYearly));
  }

  const histogram = buildHistogram(result.avgReturn, HISTOGRAM_BINS);
  const returnSummary = summarizeReturns(result.avgReturn);
  const irrSummary = summarizeReturns(result.irr);
  const irrHistogram = buildHistogram(result.irr, HISTOGRAM_BINS);
  const allYearsHistogram = buildHistogram(result.allYearsReturns, HISTOGRAM_BINS);
  const allYearsSummary = summarizeReturns(result.allYearsReturns);

  const plannedWithdrawn = plannedScheduleTotal(params.portfolio, endpointYears);
  const plannedMedianYearly = plannedScheduleMedianYearly(params.portfolio, endpointYears);
  const onPlanBenchmark = useMedianYearly ? plannedMedianYearly : plannedWithdrawn;
  const onPlanActuals = useMedianYearly ? result.medianYearlyWithdrawal : result.totalWithdrawn;
  const perRunBenchmarks = buildPerRunPlanBenchmarks(
    params.portfolio,
    result.horizonYears,
    useMedianYearly,
  );

  // Per-path outcome tags for the IRR-vs-avg-return scatter: 0 = met plan,
  // 1 = below plan (within horizon but short of the benchmark), 2 = ran out.
  const scatterOutcome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (result.depletionYear[i] <= result.horizonYears[i]) {
      scatterOutcome[i] = 2;
    } else if (perRunBenchmarks[i] > 0 && onPlanActuals[i] < perRunBenchmarks[i] * (1 - tolerance)) {
      scatterOutcome[i] = 1;
    }
  }
  // The money-weighted return at which the planned schedule exactly exhausts
  // the starting balance at the endpoint horizon — the plan's break-even IRR.
  const requiredIrr = irrFromPath(
    params.portfolio.start,
    plannedYearlySchedule(params.portfolio, endpointYears),
    0,
    0.03,
  );

  return {
    numSimulations: n,
    numYears: endpointYears,
    maxYears,
    horizonVariable,
    metricWasAuto: !!params.metricWasAuto,
    seed: result.baseSeed,
    withdrawalMetric,
    successRate: successRate(result.depletionYear, result.horizonYears),
    withdrawalTargetSuccessRate: withdrawalTargetSuccessRate(
      onPlanActuals,
      perRunBenchmarks,
      tolerance,
    ),
    shortfallTolerance: tolerance,
    medianBalance: median(result.finalBalance),
    medianWithdrawn: median(result.totalWithdrawn),
    medianYearlyWithdrawn: median(result.medianYearlyWithdrawal),
    plannedWithdrawn,
    plannedMedianYearly,
    onPlanBenchmark,
    percentiles,
    surfacePaths,
    surfaceMeta: {
      numSimulations: n,
      rankW,
      withdrawalMetric,
      maxYears,
      p5Rank: p5i,
      p60Rank: p60i,
      surfaceSamples: SURFACE_SAMPLES,
      benchmarkCache: Object.fromEntries(benchmarkCache),
    },
    returnScatter: {
      avgReturn: result.avgReturn,
      irr: result.irr,
      outcome: scatterOutcome,
      requiredIrr: Number.isNaN(requiredIrr) ? null : requiredIrr,
    },
    histogram,
    returnSummary,
    irrSummary,
    irrHistogram,
    allYearsHistogram,
    allYearsSummary,
  };
}
