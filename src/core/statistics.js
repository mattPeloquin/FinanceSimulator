// Statistical helpers operating on the packed simulation summaries.

export const WITHDRAWAL_METRICS = ['total', 'medianYearly'];

export function isMedianYearlyMetric(metric) {
  return metric === 'medianYearly';
}

/** Display labels for primary vs secondary withdrawal metrics in results UI. */
export function withdrawalMetricLabels(useMedianYearly) {
  return useMedianYearly
    ? { primary: 'Median / Year', secondary: 'Total Withdrawn' }
    : { primary: 'Total Withdrawn', secondary: 'Median / Year' };
}

// Indices sorted by the chosen withdrawal metric (asc), tie-broken by total
// withdrawn then final balance (asc). Used for percentile cards and timelines.
export function rankByWithdrawn(summary, metric = 'total') {
  const n = summary.numSimulations;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const { totalWithdrawn, finalBalance, medianYearlyWithdrawal } = summary;
  const primary = isMedianYearlyMetric(metric) ? medianYearlyWithdrawal : totalWithdrawn;
  return Array.prototype.sort.call(idx, (a, b) => {
    if (primary[a] !== primary[b]) return primary[a] - primary[b];
    if (totalWithdrawn[a] !== totalWithdrawn[b]) return totalWithdrawn[a] - totalWithdrawn[b];
    return finalBalance[a] - finalBalance[b];
  });
}

// Indices sorted by average real return (asc). Used for the distribution
// histogram and the 3D topography sampling.
export function rankByReturn(summary) {
  const n = summary.numSimulations;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const { avgReturn } = summary;
  return Array.prototype.sort.call(idx, (a, b) => avgReturn[a] - avgReturn[b]);
}

export function percentileIndex(n, p) {
  return Math.floor(n * p);
}

// Value at a percentile rank in a sorted copy of the array (return distribution).
export function percentileValue(values, p) {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[percentileIndex(sorted.length, p)];
}

// Bin whose center is nearest to a reference return value (for histogram markers).
export function closestHistogramBin(value, labels, binSize) {
  if (labels.length === 0) return 0;
  if (binSize === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < labels.length; i++) {
    const center = labels[i] + binSize / 2;
    const dist = Math.abs(value - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// Fraction of simulations whose portfolio was never depleted within the horizon.
// `horizonYears` may be a single number (fixed horizon) or a per-run Int32Array.
export function successRate(depletionYear, horizonYears) {
  const n = depletionYear.length;
  if (n === 0) return 0;
  const fixedHorizon = typeof horizonYears === 'number';
  let survived = 0;
  for (let i = 0; i < n; i++) {
    const h = fixedHorizon ? horizonYears : horizonYears[i];
    if (depletionYear[i] > h) survived++;
  }
  return survived / n;
}

// Fraction of simulations that (a) never depleted within the horizon,
// (b) ended with a balance at or above the target ending balance, and
// (c) when plannedBenchmark > 0, withdrew at least (1 - shortfallTolerance)
// of the planned schedule total. Used by Goal Seek.
// `horizonYears` and `plannedBenchmark` may be scalars (fixed horizon) or
// per-run arrays aligned with `finalBalance`.
export function goalSuccessRate(
  finalBalance,
  depletionYear,
  horizonYears,
  targetEndingBalance,
  actualWithdrawn = null,
  plannedBenchmark = null,
  shortfallTolerance = 0,
) {
  const n = finalBalance.length;
  if (n === 0) return 0;
  const fixedHorizon = typeof horizonYears === 'number';
  const fixedBenchmark = plannedBenchmark == null || typeof plannedBenchmark === 'number';
  const checkOnPlan = actualWithdrawn != null && plannedBenchmark != null
    && (fixedBenchmark ? plannedBenchmark > 0 : true);
  let met = 0;
  for (let i = 0; i < n; i++) {
    const h = fixedHorizon ? horizonYears : horizonYears[i];
    if (depletionYear[i] <= h) continue;
    if (finalBalance[i] < targetEndingBalance) continue;
    if (checkOnPlan) {
      const benchmark = fixedBenchmark ? plannedBenchmark : plannedBenchmark[i];
      // Non-positive benchmark = no on-plan requirement for this run (same as scalar 0).
      if (benchmark > 0) {
        const minimumAcceptable = benchmark * (1 - shortfallTolerance);
        if (actualWithdrawn[i] < minimumAcceptable) continue;
      }
    }
    met++;
  }
  return met / n;
}

// Whether one run's withdrawals are within the allowed shortfall of plan.
export function meetsWithdrawalTarget(actualWithdrawn, plannedBenchmark, tolerance = 0.05) {
  if (plannedBenchmark <= 0) return true;
  return actualWithdrawn >= plannedBenchmark * (1 - tolerance);
}

// Fraction of simulations whose withdrawals reached at least (1 - tolerance)
// of the planned benchmark — i.e. within tolerance below target, or above it.
// `plannedBenchmark` may be a scalar or per-run Float64Array.
export function withdrawalTargetSuccessRate(actualWithdrawn, plannedBenchmark, tolerance = 0.05) {
  const n = actualWithdrawn.length;
  if (n === 0) return null;

  if (typeof plannedBenchmark === 'number') {
    if (plannedBenchmark <= 0) return null;
    let metTarget = 0;
    for (let i = 0; i < n; i++) {
      if (meetsWithdrawalTarget(actualWithdrawn[i], plannedBenchmark, tolerance)) metTarget++;
    }
    return metTarget / n;
  }

  let metTarget = 0;
  let eligible = 0;
  for (let i = 0; i < n; i++) {
    const benchmark = plannedBenchmark[i];
    if (benchmark <= 0) continue;
    eligible++;
    if (meetsWithdrawalTarget(actualWithdrawn[i], benchmark, tolerance)) metTarget++;
  }
  return eligible > 0 ? metTarget / eligible : null;
}

export function mean(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

// Median of a typed array (does not mutate the input).
export function median(values) {
  const copy = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

// Population standard deviation — spread of outcomes across all simulations.
export function stdDev(values) {
  const n = values.length;
  if (n === 0) return 0;
  const avg = mean(values);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = values[i] - avg;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / n);
}

// Summary stats for the histogram of average annual real returns.
export function summarizeReturns(values) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    count++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (count === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0, p5: 0, p95: 0 };
  }
  const finite = [];
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) finite.push(values[i]);
  }
  const finiteArr = Float64Array.from(finite);
  return {
    mean: mean(finiteArr),
    median: median(finiteArr),
    min,
    max,
    stdDev: stdDev(finiteArr),
    p5: percentileValue(finiteArr, 0.05),
    p95: percentileValue(finiteArr, 0.95),
  };
}

// Histogram binning that mirrors the original distribution chart.
export function buildHistogram(values, numBins) {
  let minResult = Infinity;
  let maxResult = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < minResult) minResult = v;
    if (v > maxResult) maxResult = v;
  }

  // All values identical (e.g. a single simulation): a zero-width range cannot
  // be split into bins, so return one bin holding everything.
  if (minResult === Infinity || maxResult === minResult) {
    const only = minResult === Infinity ? 0 : minResult;
    let binCount = 0;
    for (let i = 0; i < values.length; i++) {
      if (!Number.isNaN(values[i])) binCount++;
    }
    return { labels: [only], bins: [binCount], binSize: 0, min: only, max: only };
  }

  const binSize = (maxResult - minResult) / numBins;
  const bins = new Array(numBins).fill(0);
  const labels = Array.from({ length: numBins }, (_, i) => minResult + i * binSize);

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (Number.isNaN(value)) continue;
    const binIndex = value === maxResult ? numBins - 1 : Math.floor((value - minResult) / binSize);
    if (binIndex >= 0 && binIndex < numBins) bins[binIndex]++;
  }

  return { labels, bins, binSize, min: minResult, max: maxResult };
}
