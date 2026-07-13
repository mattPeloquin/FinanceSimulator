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
  isMeanYearlyMetric,
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
  plannedScheduleBenchmark,
  plannedYearlySchedule,
  buildPerRunPlanBenchmarks,
} from './goalSeek.js';

const PERCENTILES = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65];
const SURFACE_SAMPLES = 200;
const HISTOGRAM_BINS = 75;
// Withdrawal Heatmap: cap the number of run-coherent columns. Below the cap
// every column IS a single run; above it each column averages a narrow band of
// adjacent ranks (≈13 runs per column at 10,000 simulations).
const HEATMAP_MAX_COLUMNS = 480;
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

// The heatmap grid is built out to this upper outcome percentile; the
// renderer's "show from/to" sliders crop the displayed columns without
// re-running the worker.
const HEATMAP_MAX_PERCENTILE = 90;

// Aggregate the full per-run withdrawal matrix (allYearsWithdrawals, one row
// per simulation) into the compact grid the Withdrawal Heatmap renders:
// columns = runs ranked P5..P65 by the lifetime-withdrawal metric (run-coherent
// — each column is one run or a narrow band of adjacent ranks, so a lean year
// inside an otherwise-good run stays visible), rows = years, cell = mean actual
// withdrawal that year across the column's band. Built worker-side so the raw
// numSimulations×maxYears matrix (megabytes) never crosses to the main thread.
export function buildWithdrawalHeatmap(result, rankW, p5Rank, hiRank, planByYear, maxYears) {
  const matrix = result.allYearsWithdrawals;
  // Number of runs in the P5..P{HEATMAP_MAX_PERCENTILE} window (inclusive of
  // both endpoint ranks); the renderer crops the displayed upper end.
  const span = Math.max(1, hiRank - p5Rank + 1);
  const numCols = Math.min(HEATMAP_MAX_COLUMNS, span);

  const values = new Float64Array(numCols * maxYears);
  values.fill(NaN);
  const colCenterRank = new Int32Array(numCols);
  const colSimIndex = new Int32Array(numCols);
  const colRunCount = new Int32Array(numCols);
  let maxBandSize = 1;

  for (let c = 0; c < numCols; c++) {
    // Partition the rank window evenly: column c covers ranks [bandLo, bandHi).
    // Integer rounding via floor keeps bands contiguous and non-overlapping.
    const bandLo = p5Rank + Math.floor((c * span) / numCols);
    const bandHi = p5Rank + Math.floor(((c + 1) * span) / numCols);
    const bandSize = Math.max(1, bandHi - bandLo);
    const centerRank = bandLo + Math.floor((bandSize - 1) / 2);
    colCenterRank[c] = centerRank;
    colSimIndex[c] = rankW[centerRank];
    colRunCount[c] = bandSize;
    if (bandSize > maxBandSize) maxBandSize = bandSize;

    for (let j = 0; j < maxYears; j++) {
      // Mean over the band's runs, skipping NaN (a run whose sampled horizon
      // ended before year j). Depleted-but-active years contribute their true
      // ~$0 withdrawal — that's real data, not a gap.
      let sum = 0;
      let count = 0;
      for (let r = bandLo; r < bandLo + bandSize; r++) {
        const v = matrix[rankW[r] * maxYears + j];
        if (!Number.isNaN(v)) {
          sum += v;
          count++;
        }
      }
      if (count > 0) values[c * maxYears + j] = sum / count;
    }
  }

  // Animation frames: when columns are averaged bands (window wider than the
  // column cap), pre-slice up to HEATMAP_MAX_FRAMES per-run snapshots so
  // "Animate runs" can cycle the actual simulations. Frame f of column c shows
  // the raw withdrawals of one real run from that column's rank band; the
  // matching sim index rides along for truthful tooltips and drill-down.
  // Float32 keeps the payload modest (≤ 24 × 480 × maxYears × 4 bytes).
  const numFrames = Math.min(maxBandSize, HEATMAP_MAX_FRAMES);
  let frameValues = null;
  let frameSimIndex = null;
  if (numFrames > 1) {
    frameValues = new Float32Array(numFrames * numCols * maxYears);
    frameValues.fill(NaN);
    frameSimIndex = new Int32Array(numFrames * numCols);
    for (let c = 0; c < numCols; c++) {
      // Same band partition as the averaging loop above.
      const bandLo = p5Rank + Math.floor((c * span) / numCols);
      const bandHi = p5Rank + Math.floor(((c + 1) * span) / numCols);
      const bandSize = Math.max(1, bandHi - bandLo);
      for (let f = 0; f < numFrames; f++) {
        const simIndex = rankW[bandLo + heatmapFrameMember(f, bandSize, numFrames)];
        frameSimIndex[f * numCols + c] = simIndex;
        const base = (f * numCols + c) * maxYears;
        for (let j = 0; j < maxYears; j++) {
          frameValues[base + j] = matrix[simIndex * maxYears + j];
        }
      }
    }
  }

  // Anchors and color clamps are NOT computed here: the renderer derives the
  // per-year mean/median and clamp domain from the VISIBLE window's cells so
  // the neutral midpoint stays anchored to the middle of whatever percentile
  // range is on screen.
  return {
    numCols,
    numYears: maxYears,
    // Rank window + population size, kept here so the renderer can place
    // percentile tick labels without reaching into surfaceMeta.
    numSimulations: result.numSimulations,
    p5Rank,
    hiRank,
    hiPercentile: HEATMAP_MAX_PERCENTILE,
    // Column-major: cell (col, year) lives at values[col * numYears + year].
    values,
    colCenterRank,
    colSimIndex,
    colRunCount,
    planByYear,
    // Per-run animation data: 1 frame means every column is already a single
    // run and there is nothing to animate (frameValues/frameSimIndex stay null).
    // Frame-major: cell (f, col, year) at frameValues[(f*numCols + col)*numYears + year].
    numFrames,
    frameValues,
    frameSimIndex,
  };
}

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

function buildSurfacePathEntry(params, result, simIndex, benchmarkCache, withdrawalMetric) {
  const re = regeneratePath(params, result.baseSeed, simIndex);
  const h = re.horizonYears;
  if (!benchmarkCache.has(h)) {
    benchmarkCache.set(h, plannedScheduleBenchmark(params.portfolio, h, withdrawalMetric));
  }
  return {
    balances: re.path.balances,
    returns: re.path.returns,
    withdrawals: re.path.withdrawals,
    unadjustedWithdrawals: re.path.unadjustedWithdrawals,
    withdrawalBreakdown: re.path.withdrawalBreakdown,
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

  const rankW = rankByWithdrawn(result, withdrawalMetric);
  const halfW = Math.round((params.smoothFraction || 0) * n);
  const percentiles = {};
  for (const p of PERCENTILES) {
    const centerRank = percentileIndex(n, p);
    percentiles[`p${Math.round(p * 100)}`] = smoothedPercentile(params, result, rankW, centerRank, halfW);
  }

  const benchmarkCache = new Map();
  const p5i = percentileIndex(n, 0.05);
  const p65i = percentileIndex(n, 0.65);
  const step = Math.max(1, Math.floor((p65i - p5i) / SURFACE_SAMPLES));
  const surfacePaths = [];
  for (let i = 0; i < SURFACE_SAMPLES; i++) {
    const rankIndex = Math.min(p5i + i * step, p65i);
    const simIndex = rankW[rankIndex];
    surfacePaths.push(buildSurfacePathEntry(params, result, simIndex, benchmarkCache, withdrawalMetric));
  }

  // The heatmap's deviation baseline: the planned schedule is a pure function
  // of year index (growth factors accumulate by year, and specific-withdrawal
  // lists are pre-fitted to maxYears in buildSimParams), so one per-year array
  // is the correct plan for every run regardless of its sampled horizon.
  const heatmapPlanByYear = Float64Array.from(plannedYearlySchedule(params.portfolio, maxYears));
  // The heatmap's own rank window extends past the surface's P65 so the
  // renderer's "show to" slider can widen the axis without a re-run.
  const heatmapHiRank = percentileIndex(n, 0.9);
  const withdrawalHeatmap = buildWithdrawalHeatmap(result, rankW, p5i, heatmapHiRank, heatmapPlanByYear, maxYears);

  const histogram = buildHistogram(result.avgReturn, HISTOGRAM_BINS);
  const returnSummary = summarizeReturns(result.avgReturn);
  const irrSummary = summarizeReturns(result.irr);
  const irrHistogram = buildHistogram(result.irr, HISTOGRAM_BINS);
  const allYearsHistogram = buildHistogram(result.allYearsReturns, HISTOGRAM_BINS);
  const allYearsSummary = summarizeReturns(result.allYearsReturns);

  const plannedWithdrawn = plannedScheduleTotal(params.portfolio, endpointYears);
  const plannedMedianYearly = plannedScheduleMedianYearly(params.portfolio, endpointYears);
  const plannedMeanYearly = plannedScheduleMeanYearly(params.portfolio, endpointYears);
  const onPlanBenchmark = isMedianYearlyMetric(withdrawalMetric)
    ? plannedMedianYearly
    : isMeanYearlyMetric(withdrawalMetric)
      ? plannedMeanYearly
      : plannedWithdrawn;
  const onPlanActuals = perRunWithdrawalMetric(result, withdrawalMetric);
  const perRunBenchmarks = buildPerRunPlanBenchmarks(
    params.portfolio,
    result.horizonYears,
    withdrawalMetric,
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
    meanYearlyWithdrawn: median(meanYearlyWithdrawals(result.totalWithdrawn, result.horizonYears)),
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
      maxYears,
      p5Rank: p5i,
      p65Rank: p65i,
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
