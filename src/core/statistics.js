// Statistical helpers operating on the packed simulation summaries.

// Indices sorted by total withdrawn (asc), tie-broken by final balance (asc).
// Matches the original ranking used for the percentile cards and timelines.
export function rankByWithdrawn(summary) {
  const n = summary.numSimulations;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const { totalWithdrawn, finalBalance } = summary;
  return Array.prototype.sort.call(idx, (a, b) => {
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
export function successRate(depletionYear, numYears) {
  let survived = 0;
  for (let i = 0; i < depletionYear.length; i++) {
    if (depletionYear[i] > numYears) survived++;
  }
  return survived / depletionYear.length;
}

// Fraction of simulations that (a) never depleted within the horizon,
// (b) ended with a balance at or above the target ending balance, and
// (c) when plannedTotal > 0, withdrew at least (1 - shortfallTolerance)
// of the planned schedule total. Used by Goal Seek.
export function goalSuccessRate(
  finalBalance,
  depletionYear,
  numYears,
  targetEndingBalance,
  totalWithdrawn = null,
  plannedTotal = null,
  shortfallTolerance = 0,
) {
  const n = finalBalance.length;
  if (n === 0) return 0;
  const checkOnPlan = totalWithdrawn != null && plannedTotal != null && plannedTotal > 0;
  const minimumAcceptable = checkOnPlan ? plannedTotal * (1 - shortfallTolerance) : 0;
  let met = 0;
  for (let i = 0; i < n; i++) {
    if (depletionYear[i] <= numYears) continue;
    if (finalBalance[i] < targetEndingBalance) continue;
    if (checkOnPlan && totalWithdrawn[i] < minimumAcceptable) continue;
    met++;
  }
  return met / n;
}

// Fraction of simulations whose total withdrawn reached at least (1 - tolerance)
// of the planned schedule total — i.e. within tolerance below target, or above it.
export function withdrawalTargetSuccessRate(totalWithdrawn, plannedWithdrawn, tolerance = 0.05) {
  const n = totalWithdrawn.length;
  if (n === 0 || plannedWithdrawn <= 0) return null;

  const minimumAcceptable = plannedWithdrawn * (1 - tolerance);
  let metTarget = 0;
  for (let i = 0; i < n; i++) {
    if (totalWithdrawn[i] >= minimumAcceptable) metTarget++;
  }
  return metTarget / n;
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
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  if (values.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0, p5: 0, p95: 0 };
  }
  return {
    mean: mean(values),
    median: median(values),
    min,
    max,
    stdDev: stdDev(values),
    p5: percentileValue(values, 0.05),
    p95: percentileValue(values, 0.95),
  };
}

// Histogram binning that mirrors the original distribution chart.
export function buildHistogram(values, numBins) {
  let minResult = Infinity;
  let maxResult = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < minResult) minResult = values[i];
    if (values[i] > maxResult) maxResult = values[i];
  }

  // All values identical (e.g. a single simulation): a zero-width range cannot
  // be split into bins, so return one bin holding everything.
  if (maxResult === minResult) {
    return { labels: [minResult], bins: [values.length], binSize: 0, min: minResult, max: maxResult };
  }

  const binSize = (maxResult - minResult) / numBins;
  const bins = new Array(numBins).fill(0);
  const labels = Array.from({ length: numBins }, (_, i) => minResult + i * binSize);

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const binIndex = value === maxResult ? numBins - 1 : Math.floor((value - minResult) / binSize);
    if (binIndex >= 0 && binIndex < numBins) bins[binIndex]++;
  }

  return { labels, bins, binSize, min: minResult, max: maxResult };
}
