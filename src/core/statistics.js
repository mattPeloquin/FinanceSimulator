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

// Fraction of simulations whose portfolio was never depleted within the horizon.
export function successRate(depletionYear, numYears) {
  let survived = 0;
  for (let i = 0; i < depletionYear.length; i++) {
    if (depletionYear[i] > numYears) survived++;
  }
  return survived / depletionYear.length;
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

// Histogram binning that mirrors the original distribution chart.
export function buildHistogram(values, numBins) {
  let minResult = Infinity;
  let maxResult = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < minResult) minResult = values[i];
    if (values[i] > maxResult) maxResult = values[i];
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
