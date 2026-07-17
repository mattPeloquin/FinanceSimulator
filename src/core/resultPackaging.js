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
  isEarlyWeightingActive,
  meanYearlyWithdrawals,
  perRunWithdrawalMetric,
  buildHistogram,
  summarizeReturns,
  irrFromPath,
} from './statistics.js';
import {
  plannedScheduleTotal,
  plannedScheduleMedianYearly,
  plannedScheduleMeanYearly,
  weightedPlannedBenchmark,
  plannedYearlySchedule,
  buildPerRunPlanBenchmarks,
} from './goalSeek.js';
import { CLASSIC_FOUR_PERCENT_RATE } from './fourPercentComparison.js';

const PERCENTILES = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65];
const SURFACE_SAMPLES = 200;
const HISTOGRAM_BINS = 75;
// Cap on pre-sliced animation frames for the heatmap's "Animate runs" mode
// (a hypothetical-outcome plot: each frame shows one real run per column
// instead of the band average). Bounds the extra payload to
// frames × columns × years regardless of how many runs the window holds.
const HEATMAP_MAX_FRAMES = 24;

// Which band member frame f shows: spread the numFrames frames evenly across
// the band so every member gets roughly equal screen time, and bands smaller
// than the frame count simply repeat members instead of going blank.
export function heatmapFrameMember(frame, bandSize, numFrames) {
  return Math.floor((frame * bandSize) / numFrames);
}

// The heatmap source is built out to this upper outcome percentile; the
// renderer rebands the active Show from/to window to fill the plot width.
const HEATMAP_MAX_PERCENTILE = 90;

/** Flat real classic 4% schedule: start × 0.04 every year (today's dollars). */
export function buildClassicFourPercentByYear(startBalance, maxYears) {
  const classicByYear = new Float64Array(Math.max(0, maxYears));
  const amount = (startBalance ?? 0) * CLASSIC_FOUR_PERCENT_RATE;
  classicByYear.fill(amount);
  return classicByYear;
}

// Compact per-run source for ranks P5..P90: one row per rank in the built
// window. The renderer rebands this to fill the plot pixel width whenever
// from/to or chart size changes — no worker round-trip.
export function buildWithdrawalHeatmapSource(
  result,
  rankW,
  p5Rank,
  hiRank,
  planByYear,
  maxYears,
  classicByYear = null,
) {
  const matrix = result.allYearsWithdrawals;
  const span = Math.max(1, hiRank - p5Rank + 1);
  const sourceValues = new Float32Array(span * maxYears);
  sourceValues.fill(NaN);
  const sourceSimIndex = new Int32Array(span);

  for (let i = 0; i < span; i++) {
    const rank = p5Rank + i;
    const simIndex = rankW[rank];
    sourceSimIndex[i] = simIndex;
    const srcBase = i * maxYears;
    const matBase = simIndex * maxYears;
    for (let j = 0; j < maxYears; j++) {
      sourceValues[srcBase + j] = matrix[matBase + j];
    }
  }

  return {
    numYears: maxYears,
    numSimulations: result.numSimulations,
    p5Rank,
    hiRank,
    hiPercentile: HEATMAP_MAX_PERCENTILE,
    sourceSpan: span,
    sourceValues,
    sourceSimIndex,
    planByYear,
    // Anchor for the "vs 4%" delta encoding (flat start × 4% schedule).
    classicByYear: classicByYear ?? buildClassicFourPercentByYear(0, maxYears),
  };
}

// Band a rank window [loRank, hiRank] into ≤maxCols columns. Each column is
// one run or a narrow band of adjacent ranks; animation frames carry raw
// per-run snapshots when bands hold more than one run.
export function bandWithdrawalHeatmap(source, loRank, hiRank, maxCols) {
  const {
    p5Rank,
    numYears,
    planByYear,
    classicByYear,
    sourceValues,
    sourceSimIndex,
    numSimulations,
    hiPercentile,
  } = source;
  const span = Math.max(1, hiRank - loRank + 1);
  const numCols = Math.min(Math.max(1, maxCols), span);

  const values = new Float64Array(numCols * numYears);
  values.fill(NaN);
  const colCenterRank = new Int32Array(numCols);
  const colSimIndex = new Int32Array(numCols);
  const colRunCount = new Int32Array(numCols);
  let maxBandSize = 1;

  for (let c = 0; c < numCols; c++) {
    const bandLo = loRank + Math.floor((c * span) / numCols);
    const bandHi = loRank + Math.floor(((c + 1) * span) / numCols);
    const bandSize = Math.max(1, bandHi - bandLo);
    const centerRank = bandLo + Math.floor((bandSize - 1) / 2);
    colCenterRank[c] = centerRank;
    colSimIndex[c] = sourceSimIndex[centerRank - p5Rank];
    colRunCount[c] = bandSize;
    if (bandSize > maxBandSize) maxBandSize = bandSize;

    for (let j = 0; j < numYears; j++) {
      let sum = 0;
      let count = 0;
      for (let r = bandLo; r < bandLo + bandSize; r++) {
        const v = sourceValues[(r - p5Rank) * numYears + j];
        if (!Number.isNaN(v)) {
          sum += v;
          count++;
        }
      }
      if (count > 0) values[c * numYears + j] = sum / count;
    }
  }

  const numFrames = Math.min(maxBandSize, HEATMAP_MAX_FRAMES);
  let frameValues = null;
  let frameSimIndex = null;
  if (numFrames > 1) {
    frameValues = new Float32Array(numFrames * numCols * numYears);
    frameValues.fill(NaN);
    frameSimIndex = new Int32Array(numFrames * numCols);
    for (let c = 0; c < numCols; c++) {
      const bandLo = loRank + Math.floor((c * span) / numCols);
      const bandHi = loRank + Math.floor(((c + 1) * span) / numCols);
      const bandSize = Math.max(1, bandHi - bandLo);
      for (let f = 0; f < numFrames; f++) {
        const memberRank = bandLo + heatmapFrameMember(f, bandSize, numFrames);
        const simIndex = sourceSimIndex[memberRank - p5Rank];
        frameSimIndex[f * numCols + c] = simIndex;
        const base = (f * numCols + c) * numYears;
        for (let j = 0; j < numYears; j++) {
          frameValues[base + j] = sourceValues[(memberRank - p5Rank) * numYears + j];
        }
      }
    }
  }

  return {
    numCols,
    numYears,
    numSimulations,
    p5Rank: source.p5Rank,
    hiRank: source.hiRank,
    hiPercentile,
    loRank,
    windowHiRank: hiRank,
    values,
    colCenterRank,
    colSimIndex,
    colRunCount,
    planByYear,
    classicByYear,
    numFrames,
    frameValues,
    frameSimIndex,
  };
}

// Legacy alias kept for tests that call the old name directly.
export function buildWithdrawalHeatmap(result, rankW, p5Rank, hiRank, planByYear, maxYears, classicByYear) {
  const source = buildWithdrawalHeatmapSource(
    result,
    rankW,
    p5Rank,
    hiRank,
    planByYear,
    maxYears,
    classicByYear,
  );
  return bandWithdrawalHeatmap(source, p5Rank, hiRank, source.sourceSpan);
}

// Build a smoothed "representative" outcome for a percentile by triangular-kernel
// averaging the band of runs whose withdrawal rank sits within ±halfW of the
// target rank. When horizons differ, each year renormalizes weights over runs
// still active at that year.
function smoothedPercentile(params, result, rankW, centerRank, halfW, rankedMetric = null) {
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
  let earlyWeightedWithdrawn = 0;
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
    if (rankedMetric) earlyWeightedWithdrawn += e.w * rankedMetric[e.simIndex];
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
    earlyWeightedWithdrawn: rankedMetric ? earlyWeightedWithdrawn / wSum : totalWithdrawn / wSum,
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

function buildSurfacePathEntry(
  params,
  result,
  simIndex,
  benchmarkCache,
  withdrawalMetric,
  rankingWeighting,
  rankedMetric,
) {
  const re = regeneratePath(params, result.baseSeed, simIndex);
  const h = re.horizonYears;
  if (!benchmarkCache.has(h)) {
    benchmarkCache.set(
      h,
      weightedPlannedBenchmark(params.portfolio, h, withdrawalMetric, rankingWeighting),
    );
  }
  return {
    balances: re.path.balances,
    returns: re.path.returns,
    withdrawals: re.path.withdrawals,
    unadjustedWithdrawals: re.path.unadjustedWithdrawals,
    withdrawalBreakdown: re.path.withdrawalBreakdown,
    totalWithdrawn: result.totalWithdrawn[simIndex],
    earlyWeightedScore: rankedMetric ? rankedMetric[simIndex] : result.totalWithdrawn[simIndex],
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
  const rankingWeighting = {
    strengthPct: params.earlyWeightStrengthPct ?? 0,
    earlyEmphasisPct: params.earlyWeightEmphasisPct ?? 30,
    lateFloorPct: params.earlyWeightLateFloorPct ?? 40,
  };
  const earlyWeightingActive = isEarlyWeightingActive(rankingWeighting);

  const rankedMetric = perRunWithdrawalMetric(result, withdrawalMetric, rankingWeighting);
  const rankW = rankByWithdrawn(result, withdrawalMetric, rankingWeighting);
  const halfW = Math.round((params.smoothFraction || 0) * n);
  const percentiles = {};
  for (const p of PERCENTILES) {
    const centerRank = percentileIndex(n, p);
    percentiles[`p${Math.round(p * 100)}`] = smoothedPercentile(
      params,
      result,
      rankW,
      centerRank,
      halfW,
      rankedMetric,
    );
  }

  const benchmarkCache = new Map();
  const p5i = percentileIndex(n, 0.05);
  const p65i = percentileIndex(n, 0.65);
  const step = Math.max(1, Math.floor((p65i - p5i) / SURFACE_SAMPLES));
  const surfacePaths = [];
  for (let i = 0; i < SURFACE_SAMPLES; i++) {
    const rankIndex = Math.min(p5i + i * step, p65i);
    const simIndex = rankW[rankIndex];
    surfacePaths.push(buildSurfacePathEntry(
      params,
      result,
      simIndex,
      benchmarkCache,
      withdrawalMetric,
      rankingWeighting,
      rankedMetric,
    ));
  }

  // The heatmap's deviation baseline: the planned schedule is a pure function
  // of year index (growth factors accumulate by year, and specific-withdrawal
  // lists are pre-fitted to maxYears in buildSimParams), so one per-year array
  // is the correct plan for every run regardless of its sampled horizon.
  const heatmapPlanByYear = Float64Array.from(plannedYearlySchedule(params.portfolio, maxYears));
  // Flat classic 4% of start — second baseline for the "vs 4%" delta encoding.
  const heatmapClassicByYear = buildClassicFourPercentByYear(params.portfolio?.start, maxYears);
  // Heatmap and 3D "show to" sliders can widen past P65 up to P90 without a re-run.
  const p90i = percentileIndex(n, 0.9);
  const withdrawalHeatmap = buildWithdrawalHeatmapSource(
    result,
    rankW,
    p5i,
    p90i,
    heatmapPlanByYear,
    maxYears,
    heatmapClassicByYear,
  );

  const histogram = buildHistogram(result.avgReturn, HISTOGRAM_BINS);
  const returnSummary = summarizeReturns(result.avgReturn);
  const irrSummary = summarizeReturns(result.irr);
  const irrHistogram = buildHistogram(result.irr, HISTOGRAM_BINS);
  const allYearsHistogram = buildHistogram(result.allYearsReturns, HISTOGRAM_BINS);
  const allYearsSummary = summarizeReturns(result.allYearsReturns);

  const plannedWithdrawn = plannedScheduleTotal(params.portfolio, endpointYears);
  const plannedMedianYearly = plannedScheduleMedianYearly(params.portfolio, endpointYears);
  const plannedMeanYearly = plannedScheduleMeanYearly(params.portfolio, endpointYears);
  const onPlanBenchmark = weightedPlannedBenchmark(
    params.portfolio,
    endpointYears,
    withdrawalMetric,
    rankingWeighting,
  );
  const onPlanActuals = rankedMetric;
  const perRunBenchmarks = buildPerRunPlanBenchmarks(
    params.portfolio,
    result.horizonYears,
    withdrawalMetric,
    rankingWeighting,
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
    earlyWeightStrengthPct: rankingWeighting.strengthPct,
    earlyWeightEmphasisPct: rankingWeighting.earlyEmphasisPct,
    earlyWeightLateFloorPct: rankingWeighting.lateFloorPct,
    earlyWeightingActive,
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
    meanYearlyWithdrawn: median(meanYearlyWithdrawals(result.totalWithdrawn, result.horizonYears)),
    medianEarlyWeightedWithdrawn: median(onPlanActuals),
    plannedWithdrawn,
    plannedMedianYearly,
    plannedMeanYearly,
    onPlanBenchmark,
    percentiles,
    surfacePaths,
    surfaceMeta: {
      numSimulations: n,
      rankW,
      withdrawalMetric,
      earlyWeightStrengthPct: rankingWeighting.strengthPct,
      earlyWeightEmphasisPct: rankingWeighting.earlyEmphasisPct,
      earlyWeightLateFloorPct: rankingWeighting.lateFloorPct,
      maxYears,
      p5Rank: p5i,
      p65Rank: p65i,
      p90Rank: p90i,
      surfaceSamples: SURFACE_SAMPLES,
      benchmarkCache: Object.fromEntries(benchmarkCache),
    },
    returnScatter: {
      avgReturn: result.avgReturn,
      irr: result.irr,
      totalWithdrawn: result.totalWithdrawn,
      finalBalance: result.finalBalance,
      outcome: scatterOutcome,
      requiredIrr: Number.isNaN(requiredIrr) ? null : requiredIrr,
    },
    withdrawalHeatmap,
    histogram,
    returnSummary,
    irrSummary,
    irrHistogram,
    allYearsHistogram,
    allYearsSummary,
  };
}
