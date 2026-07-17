// Statistical helpers operating on the packed simulation summaries.

export const WITHDRAWAL_METRICS = ['total', 'medianYearly', 'meanYearly'];
/** Five-stop Withdrawals slider: slot → blend strength toward the Advanced curve. */
export const EARLY_WEIGHT_SLOT_STRENGTHS = [0, 25, 50, 75, 100];

export function isMedianYearlyMetric(metric) {
  return metric === 'medianYearly';
}

export function isMeanYearlyMetric(metric) {
  return metric === 'meanYearly';
}

/** True when early-year weighting should change ranking / on-plan scoring. */
export function isEarlyWeightingActive(weighting) {
  if (!weighting) return false;
  const strength = Number(weighting.strengthPct);
  return Number.isFinite(strength) && strength > 0;
}

/** Map the 0–4 Withdrawals slot to a 0–100 blend strength. */
export function earlyWeightStrengthFromSlot(slot) {
  const index = Math.min(Math.max(Math.round(Number(slot) || 0), 0), EARLY_WEIGHT_SLOT_STRENGTHS.length - 1);
  return EARLY_WEIGHT_SLOT_STRENGTHS[index];
}

/** Snap a legacy 0–100 strength percentage to the nearest 5-stop slot. */
export function earlyWeightSlotFromStrengthPct(strengthPct) {
  const pct = Math.min(Math.max(Number(strengthPct) || 0, 0), 100);
  return Math.min(4, Math.max(0, Math.round(pct / 25)));
}

/**
 * Normalize scenario/params fields into the weighting object yearWeights expects.
 * Slot (or legacy strengthPct) sets blend; Advanced knobs set curve shape.
 */
export function resolveEarlyWeighting({
  earlyWeightSlot,
  earlyWeightStrengthPct,
  earlyWeightEmphasisPct,
  earlyWeightLateFloorPct,
  strengthPct,
  earlyEmphasisPct,
  lateFloorPct,
} = {}) {
  let strength = strengthPct;
  if (strength == null && earlyWeightSlot != null) {
    strength = earlyWeightStrengthFromSlot(earlyWeightSlot);
  }
  if (strength == null) {
    strength = earlyWeightStrengthPct ?? 0;
  }
  return {
    strengthPct: Math.min(Math.max(Number(strength) || 0, 0), 100),
    earlyEmphasisPct: Math.min(
      Math.max(Number(earlyEmphasisPct ?? earlyWeightEmphasisPct) || 0, 0),
      100,
    ),
    lateFloorPct: Math.min(
      Math.max(Number(lateFloorPct ?? earlyWeightLateFloorPct) || 0, 0),
      100,
    ),
  };
}

/** Display labels for primary vs secondary withdrawal metrics in results UI. */
export function withdrawalMetricLabels(metric, weighting = null) {
  if (isEarlyWeightingActive(weighting)) {
    if (isMeanYearlyMetric(metric)) {
      return { primary: 'Early-weighted Mean / Year', secondary: 'Total Withdrawn' };
    }
    return { primary: 'Early-weighted Spending', secondary: 'Total Withdrawn' };
  }
  if (isMedianYearlyMetric(metric)) return { primary: 'Median / Year', secondary: 'Total Withdrawn' };
  if (isMeanYearlyMetric(metric)) return { primary: 'Mean / Year', secondary: 'Total Withdrawn' };
  return { primary: 'Total Withdrawn', secondary: 'Median / Year' };
}

// Per-run mean yearly withdrawal — the horizon-normalized lifetime total, so
// dollars in a minority of years (boost/bonus years) still count. Derived on
// demand; never stored on the summary. `horizonYears` may be a single number
// (fixed horizon) or a per-run array.
export function meanYearlyWithdrawals(totalWithdrawn, horizonYears) {
  const n = totalWithdrawn.length;
  const out = new Float64Array(n);
  const fixedHorizon = typeof horizonYears === 'number';
  for (let i = 0; i < n; i++) {
    const h = fixedHorizon ? horizonYears : horizonYears[i];
    out[i] = h > 0 ? totalWithdrawn[i] / h : 0;
  }
  return out;
}

/**
 * Raw early-weight curve (year 1 = 1, last year = lateFloor) before blending
 * with flat years or mean-rescaling. Exposed for tests and the Advanced preview
 * caption ("late years keep X% of year 1").
 *
 * - lateFloorPct 0–100 → last year as a fraction of year 1 in [0.05, 1]
 * - earlyEmphasisPct 0–100 → power p in [1, 4]; higher drops faster early
 *   while still landing on the late floor (no cliff to ~0).
 */
export function earlyWeightRawCurve(
  horizonYears,
  { earlyEmphasisPct = 30, lateFloorPct = 40 } = {},
) {
  const horizon = Math.max(0, Math.floor(horizonYears) || 0);
  const raw = new Float64Array(horizon);
  if (horizon === 0) return raw;
  if (horizon === 1) {
    raw[0] = 1;
    return raw;
  }

  const emphasis = Math.min(Math.max(Number(earlyEmphasisPct) || 0, 0), 100) / 100;
  const lateFloor = 0.05 + 0.95 * (Math.min(Math.max(Number(lateFloorPct) || 0, 0), 100) / 100);
  // p = 1 → linear fade from 1 to lateFloor; p = 4 → steeper early drop.
  const power = 1 + 3 * emphasis;

  for (let t = 0; t < horizon; t++) {
    const u = t / (horizon - 1);
    raw[t] = lateFloor + (1 - lateFloor) * (1 - u) ** power;
  }
  return raw;
}

/**
 * Per-year importance weights for ranking / on-plan scoring.
 *
 * Strength 0 → every year counts equally (all ones) — same as today's lifetime
 * total. Strength 100 blends fully toward the Advanced curve (early emphasis +
 * late floor). After blending we rescale so the average weight is 1, which keeps
 * Σ w_t × withdrawal_t in the same dollar units as a lifetime total.
 */
export function yearWeights(
  horizonYears,
  { strengthPct = 0, earlyEmphasisPct = 30, lateFloorPct = 40 } = {},
) {
  const horizon = Math.max(0, Math.floor(horizonYears) || 0);
  const weights = new Float64Array(horizon);
  if (horizon === 0) return weights;

  const strength = Math.min(Math.max(Number(strengthPct) || 0, 0), 100) / 100;
  if (strength <= 0) {
    weights.fill(1);
    return weights;
  }

  const raw = earlyWeightRawCurve(horizon, { earlyEmphasisPct, lateFloorPct });

  // Blend toward the curve, then force mean(weight) = 1 so a flat schedule's
  // weighted total still matches its unweighted lifetime total.
  let sum = 0;
  for (let t = 0; t < horizon; t++) {
    const blended = (1 - strength) * 1 + strength * raw[t];
    weights[t] = blended;
    sum += blended;
  }
  const meanWeight = sum / horizon;
  if (meanWeight > 0) {
    for (let t = 0; t < horizon; t++) weights[t] /= meanWeight;
  }
  return weights;
}

/** Series for the Advanced weight preview (full curve at strength 100). */
export function weightPreviewSeries(horizonYears, knobs = {}) {
  const weights = yearWeights(horizonYears, { ...knobs, strengthPct: 100 });
  const raw = earlyWeightRawCurve(horizonYears, knobs);
  const horizon = weights.length;
  const year1 = horizon > 0 ? weights[0] : 0;
  const yearLast = horizon > 0 ? weights[horizon - 1] : 0;
  const rawLateSharePct = horizon > 0 ? Math.round((raw[horizon - 1] / raw[0]) * 100) : 100;
  return {
    weights,
    year1Weight: year1,
    yearLastWeight: yearLast,
    year1VsLast: yearLast > 0 ? year1 / yearLast : Infinity,
    rawLateSharePct,
  };
}

/**
 * Early-weighted spending score for one Monte Carlo run: sum over years of
 * (weight × withdrawal). Negative "withdrawals" are deposits — they count as
 * $0 here so an early inflow cannot push a cut-heavy path up the ranks.
 */
export function weightedWithdrawalScore(
  allYearsWithdrawals,
  maxYears,
  simIndex,
  horizonYears,
  weighting,
) {
  const horizon = Math.max(0, Math.min(horizonYears || 0, maxYears || 0));
  if (horizon <= 0 || !allYearsWithdrawals) return 0;
  const weights = yearWeights(horizon, weighting);
  const base = simIndex * maxYears;
  let score = 0;
  for (let t = 0; t < horizon; t++) {
    const raw = allYearsWithdrawals[base + t];
    if (!Number.isFinite(raw)) continue;
    // Deposits arrive as negative withdrawals in the sim; ignore them for rank.
    const withdrawal = Math.max(0, raw);
    score += weights[t] * withdrawal;
  }
  return score;
}

/** Weighted sum of a planned yearly schedule (same clamp / weight rules). */
export function weightedScheduleScore(yearlyAmounts, weighting) {
  const horizon = yearlyAmounts?.length ?? 0;
  if (horizon <= 0) return 0;
  if (!isEarlyWeightingActive(weighting)) {
    let total = 0;
    for (let t = 0; t < horizon; t++) total += Math.max(0, yearlyAmounts[t] || 0);
    return total;
  }
  const weights = yearWeights(horizon, weighting);
  let score = 0;
  for (let t = 0; t < horizon; t++) {
    score += weights[t] * Math.max(0, yearlyAmounts[t] || 0);
  }
  return score;
}

// Per-run values of the chosen withdrawal metric. When early-weight strength
// is above 0, score from the year-by-year matrix instead of lifetime totals so
// bad early spending (classic sequence risk) sinks toward the low percentiles.
// Median/yr only applies at strength 0; with weighting we use the weighted sum
// (same path as total) so there is one clear early-weighted primary.
export function perRunWithdrawalMetric(summary, metric, weighting = null) {
  if (!isEarlyWeightingActive(weighting) || !summary.allYearsWithdrawals) {
    if (isMedianYearlyMetric(metric)) return summary.medianYearlyWithdrawal;
    if (isMeanYearlyMetric(metric)) {
      return meanYearlyWithdrawals(summary.totalWithdrawn, summary.horizonYears);
    }
    return summary.totalWithdrawn;
  }

  const n = summary.numSimulations;
  const maxYears = summary.allYearsWithdrawals.length / n;
  const out = new Float64Array(n);
  const { horizonYears } = summary;
  for (let i = 0; i < n; i++) {
    const horizon = horizonYears[i];
    const weightedTotal = weightedWithdrawalScore(
      summary.allYearsWithdrawals,
      maxYears,
      i,
      horizon,
      weighting,
    );
    out[i] = isMeanYearlyMetric(metric) && horizon > 0
      ? weightedTotal / horizon
      : weightedTotal;
  }
  return out;
}

// Indices sorted by the chosen withdrawal metric (asc), tie-broken by total
// withdrawn then final balance (asc). Used for percentile cards and timelines.
export function rankByWithdrawn(summary, metric = 'total', weighting = null) {
  const n = summary.numSimulations;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const { totalWithdrawn, finalBalance } = summary;
  const primary = perRunWithdrawalMetric(summary, metric, weighting);
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

// Fraction of simulations that (a) never depleted within the horizon and
// (b) ended with a balance at or above the target ending balance.
// Find Best Plan's Desired Success % uses this legacy gate alone; spending
// shortfall vs plan is checked separately at P(100 − Desired Success %).
// `horizonYears` may be a scalar or a per-run array.
export function legacyGoalSuccessRate(
  finalBalance,
  depletionYear,
  horizonYears,
  targetEndingBalance,
) {
  const n = finalBalance.length;
  if (n === 0) return 0;
  const fixedHorizon = typeof horizonYears === 'number';
  let met = 0;
  for (let i = 0; i < n; i++) {
    const h = fixedHorizon ? horizonYears : horizonYears[i];
    if (depletionYear[i] <= h) continue;
    if (finalBalance[i] < targetEndingBalance) continue;
    met++;
  }
  return met / n;
}

// Fraction of simulations that (a) never depleted within the horizon,
// (b) ended with a balance at or above the target ending balance, and
// (c) when plannedBenchmark > 0, withdrew at least (1 - shortfallTolerance)
// of the planned schedule total. Joint gate kept for tests / callers that
// still want one combined rate; Find Best Plan uses the split helpers below.
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

// Alias used by Find Best Plan for the separate on-plan (within RT) rate.
export function spendingTailRate(actualWithdrawn, plannedBenchmark, shortfallTolerance = 0) {
  return withdrawalTargetSuccessRate(actualWithdrawn, plannedBenchmark, shortfallTolerance);
}

// Actual/plan ratio at percentile p (e.g. p = 0.05 for P5 when Desired Success
// is 95%). Skips non-positive plan benchmarks. Returns null when no eligible
// runs exist (no spending floor to enforce).
export function withdrawalPlanRatioPercentile(actualWithdrawn, plannedBenchmark, p) {
  const n = actualWithdrawn?.length ?? 0;
  if (n === 0) return null;

  const ratios = [];
  if (typeof plannedBenchmark === 'number') {
    if (plannedBenchmark <= 0) return null;
    for (let i = 0; i < n; i++) {
      ratios.push(actualWithdrawn[i] / plannedBenchmark);
    }
  } else if (plannedBenchmark != null) {
    for (let i = 0; i < n; i++) {
      const benchmark = plannedBenchmark[i];
      if (!(benchmark > 0)) continue;
      ratios.push(actualWithdrawn[i] / benchmark);
    }
  } else {
    return null;
  }

  if (ratios.length === 0) return null;
  return percentileValue(ratios, p);
}

// Money-weighted annual return (IRR) of one simulated path, in the same real
// terms as the path itself. Solves for r in:
//   -start + Σ_{t=1..H} wd[t-1]/(1+r)^t + final/(1+r)^H = 0
// matching the sim loop's end-of-year withdrawal convention. Deposits arrive
// as negative withdrawals, so flows can be mixed-sign with multiple roots;
// Newton seeded from `guess` (the path's time-weighted return) picks the
// economically sensible one, with bracketed bisection as the fallback.
// Returns NaN when no root exists (e.g. no positive inflows at all).
export function irrFromPath(startBalance, yearlyWithdrawals, finalBalance, guess = 0) {
  const n = yearlyWithdrawals.length;
  if (n === 0) return 0;

  // NPV and its derivative at rate r (r > -1).
  const npv = (r) => {
    const g = 1 + r;
    let v = -startBalance;
    let d = 1;
    for (let t = 0; t < n; t++) {
      d /= g;
      v += yearlyWithdrawals[t] * d;
    }
    return v + finalBalance * d;
  };
  const npvDeriv = (r) => {
    const g = 1 + r;
    let v = 0;
    let d = 1;
    for (let t = 1; t <= n; t++) {
      d /= g;
      v -= (t * yearlyWithdrawals[t - 1] * d) / g;
    }
    return v - (n * finalBalance * d) / g;
  };

  const R_MIN = -0.9999;
  const tol = 1e-9 * Math.max(1, Math.abs(startBalance));

  let r = Math.max(R_MIN, Number.isFinite(guess) ? guess : 0);
  for (let iter = 0; iter < 50; iter++) {
    const f = npv(r);
    if (Math.abs(f) < tol) return r;
    const fp = npvDeriv(r);
    if (fp === 0 || !Number.isFinite(fp)) break;
    const step = f / fp;
    r = Math.max(R_MIN, r - step);
    if (Math.abs(step) < 1e-12) {
      return Math.abs(npv(r)) < tol ? r : Number.NaN;
    }
  }

  // Newton wandered: bracket a sign change on a coarse grid and bisect.
  const grid = [R_MIN, -0.9, -0.5, -0.2, -0.05, 0, 0.05, 0.15, 0.3, 0.6, 1, 2, 5, 10];
  let lo = Number.NaN;
  let hi = Number.NaN;
  let prev = npv(grid[0]);
  for (let i = 1; i < grid.length; i++) {
    const cur = npv(grid[i]);
    if ((prev < 0 && cur > 0) || (prev > 0 && cur < 0)) {
      lo = grid[i - 1];
      hi = grid[i];
      break;
    }
    prev = cur;
  }
  if (Number.isNaN(lo)) return Number.NaN;

  let fLo = npv(lo);
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < tol || hi - lo < 1e-12) return mid;
    if ((fLo < 0) === (fMid < 0)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
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
