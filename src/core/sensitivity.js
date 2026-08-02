// Sensitivity / tornado analysis helpers. Pure and DOM-free so they can run
// inside the simulation worker and be unit-tested directly.
//
// A Lab sweep stores response *curves* (metric bundles at each design point),
// not pre-ranked tornado bars. Visualizations re-derive bars, fans, and tables
// from this general shape without re-running Monte Carlo.

import {
  successRate,
  withdrawalTargetSuccessRate,
  percentileValue,
  mean,
  meanYearlyWithdrawals,
  isEarlyWeightingActive,
  perRunWithdrawalMetric,
  resolveEarlyWeighting,
} from './statistics.js';
import {
  buildPerRunPlanBenchmarks,
  plannedYearlySchedule,
} from './goalSeek.js';

export const SENSITIVITY_SCHEMA_VERSION = 1;

/** Percentile ranks stored for every per-path metric (P5…P95 step 5). */
export const PERCENTILE_GRID = Object.freeze(
  Array.from({ length: 19 }, (_, i) => 5 + i * 5),
);

/** Metric catalog shared by the worker summarizer and Lab UI selectors. */
export const METRIC_DEFS = Object.freeze([
  {
    id: 'successRate',
    label: 'Success rate',
    kind: 'rate',
    unit: 'fraction',
    higherIsBetter: true,
  },
  {
    id: 'onTargetRate',
    label: 'On-plan rate',
    kind: 'rate',
    unit: 'fraction',
    higherIsBetter: true,
  },
  {
    id: 'depletionRate',
    label: 'Depletion rate',
    kind: 'rate',
    unit: 'fraction',
    higherIsBetter: false,
  },
  {
    id: 'endingBalance',
    label: 'Ending balance',
    kind: 'perPath',
    unit: 'dollars',
    higherIsBetter: true,
  },
  {
    id: 'lifetimeSpend',
    label: 'Lifetime spending',
    kind: 'perPath',
    unit: 'dollars',
    higherIsBetter: true,
  },
  {
    id: 'medianYearlySpend',
    label: 'Median yearly spending',
    kind: 'perPath',
    unit: 'dollars',
    higherIsBetter: true,
  },
  {
    id: 'meanYearlySpend',
    label: 'Mean yearly spending',
    kind: 'perPath',
    unit: 'dollars',
    higherIsBetter: true,
  },
  {
    id: 'irr',
    label: 'IRR',
    kind: 'perPath',
    unit: 'fraction',
    higherIsBetter: true,
  },
  {
    id: 'depletionYear',
    label: 'Depletion year',
    kind: 'perPath',
    unit: 'years',
    higherIsBetter: true,
  },
]);

const METRIC_BY_ID = new Map(METRIC_DEFS.map((m) => [m.id, m]));

export function getMetricDef(metricId) {
  return METRIC_BY_ID.get(metricId) || null;
}

/**
 * Binomial standard error for a rate estimated from `n` independent Bernoulli
 * trials. Common-random-number differences between sweep points are tighter
 * than this, but the SE is still a useful noise-floor display for rate bars.
 */
export function binomialStandardError(rate, n) {
  const paths = Math.max(0, Math.floor(Number(n) || 0));
  if (paths <= 0) return 0;
  const p = Math.min(Math.max(Number(rate) || 0, 0), 1);
  return Math.sqrt((p * (1 - p)) / paths);
}

function rateEntry(value, n) {
  const v = Number.isFinite(value) ? value : 0;
  return { value: v, se: binomialStandardError(v, n) };
}

/** Percentile vector over PERCENTILE_GRID for one per-path series. */
export function percentileVector(values, grid = PERCENTILE_GRID) {
  const out = new Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    out[i] = percentileValue(values, grid[i] / 100);
  }
  return out;
}

function summarizePerPath(values) {
  if (!values || values.length === 0) {
    return { mean: 0, percentiles: percentileVector([]) };
  }
  return {
    mean: mean(values),
    percentiles: percentileVector(values),
  };
}

/**
 * Compact metric bundle for one Monte Carlo design point.
 * Never calls buildRunResult — Lab stores hundreds of points.
 *
 * @param {object} raw — stitched ParallelPool / runMonteCarlo result
 * @param {object} params — sim params used for that point (portfolio, scoring)
 * @returns {object} MetricBundle
 */
export function summarizeSweepPoint(raw, params) {
  const n = raw?.numSimulations ?? raw?.finalBalance?.length ?? 0;
  const surv = n > 0 ? successRate(raw.depletionYear, raw.horizonYears) : 0;
  const deplete = 1 - surv;

  const withdrawalMetric = params?.withdrawalMetric ?? 'total';
  const rankingWeighting = resolveEarlyWeighting({
    earlyWeightSlot: params?.earlyWeightSlot,
    earlyWeightStrengthPct: params?.earlyWeightStrengthPct,
    earlyWeightEmphasisPct: params?.earlyWeightEmphasisPct,
    earlyWeightLateFloorPct: params?.earlyWeightLateFloorPct,
  });
  const tolerance = params?.shortfallTolerance ?? 0.2;
  const maxYears = params?.maxYears ?? params?.numYears ?? 0;

  let onPlan = null;
  if (n > 0 && params?.portfolio) {
    const actuals = perRunWithdrawalMetric(raw, withdrawalMetric, rankingWeighting);
    const benchmarks = buildPerRunPlanBenchmarks(
      params.portfolio,
      raw.horizonYears,
      withdrawalMetric,
      rankingWeighting,
    );
    const onTargetScoring = params.onTargetScoring
      ?? { measure: 'blend', yearlyEmphasisPct: 100, yearlyLateFloorPct: 100 };
    const onTargetContext = {
      measure: onTargetScoring.measure ?? 'blend',
      yearlyEmphasisPct: onTargetScoring.yearlyEmphasisPct ?? 100,
      yearlyLateFloorPct: onTargetScoring.yearlyLateFloorPct ?? 100,
      allYearsNetSpend: raw.allYearsNetSpend ?? raw.allYearsWithdrawals,
      maxYears,
      horizonYears: raw.horizonYears,
      targetByYearForHorizon: (h) => plannedYearlySchedule(params.portfolio, h),
    };
    onPlan = withdrawalTargetSuccessRate(
      actuals,
      benchmarks,
      tolerance,
      onTargetContext,
    );
  }

  // Prefer net spend (after modeled withdrawal tax) when present so Lab
  // spending metrics match the Plan results "spend you keep" view.
  const lifetime = raw.totalNetSpend ?? raw.totalWithdrawn;
  const yearly = raw.medianYearlyNetSpend ?? raw.medianYearlyWithdrawal;
  // Per-run mean yearly = lifetime ÷ that run's horizon (horizon-independent
  // when range is on — same construction Plan results use for mean/yr).
  const meanYearly = n > 0 && lifetime
    ? meanYearlyWithdrawals(lifetime, raw.horizonYears)
    : [];

  return {
    rates: {
      successRate: rateEntry(surv, n),
      onTargetRate: rateEntry(onPlan == null ? 0 : onPlan, n),
      depletionRate: rateEntry(deplete, n),
    },
    perPath: {
      endingBalance: summarizePerPath(raw.finalBalance || []),
      lifetimeSpend: summarizePerPath(lifetime || []),
      medianYearlySpend: summarizePerPath(yearly || []),
      meanYearlySpend: summarizePerPath(meanYearly),
      irr: summarizePerPath(raw.irr || []),
      depletionYear: summarizePerPath(raw.depletionYear || []),
    },
    // Kept for selectors that need to know whether on-plan was undefined
    // (no positive plan benchmark) vs genuinely zero.
    onTargetDefined: onPlan != null,
  };
}

/**
 * Assemble a LabSweepResult from evaluated design points.
 * `evaluated` entries: { kind, variableId, value, bundle }.
 * `variableDefs` entries mirror the registry metadata for each swept variable.
 */
export function assembleLabSweepResult({
  evaluated,
  variableDefs,
  baselineRef,
  meta,
}) {
  const baselineEval = evaluated.find((e) => e.kind === 'baseline');
  if (!baselineEval) {
    throw new Error('assembleLabSweepResult requires a baseline evaluation');
  }

  const byVariable = new Map();
  for (const ev of evaluated) {
    if (ev.kind === 'baseline' || !ev.variableId) continue;
    if (!byVariable.has(ev.variableId)) {
      byVariable.set(ev.variableId, []);
    }
    byVariable.get(ev.variableId).push(ev);
  }

  function buildVariableCurve(def) {
    const points = byVariable.get(def.id) || [];
    points.sort((a, b) => a.value - b.value);
    // Every variable curve includes the shared baseline as an interior point
    // when the baseline value falls inside the envelope (or at an endpoint).
    const values = [];
    const bundles = [];
    const baselineValue = def.baselineValue;
    let insertedBaseline = false;
    for (const p of points) {
      if (!insertedBaseline && baselineValue != null && p.value > baselineValue) {
        values.push(baselineValue);
        bundles.push(baselineEval.bundle);
        insertedBaseline = true;
      }
      if (baselineValue != null && Math.abs(p.value - baselineValue) < 1e-12) {
        // Design point landed exactly on baseline — use the shared baseline bundle.
        values.push(baselineValue);
        bundles.push(baselineEval.bundle);
        insertedBaseline = true;
        continue;
      }
      values.push(p.value);
      bundles.push(p.bundle);
    }
    if (!insertedBaseline && baselineValue != null) {
      values.push(baselineValue);
      bundles.push(baselineEval.bundle);
      // Keep values ascending after a trailing baseline insert.
      const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
      const sortedValues = order.map((i) => values[i]);
      const sortedBundles = order.map((i) => bundles[i]);
      return {
        id: def.id,
        label: def.label,
        group: def.group,
        category: def.category,
        unit: def.unit,
        baselineValue: def.baselineValue,
        envelope: { ...def.envelope },
        values: sortedValues,
        points: sortedBundles,
        crnSafe: def.crnSafe !== false,
        gatedOff: !!def.gatedOff,
        isSentinel: !!def.isSentinel,
      };
    }
    return {
      id: def.id,
      label: def.label,
      group: def.group,
      category: def.category,
      unit: def.unit,
      baselineValue: def.baselineValue,
      envelope: { ...def.envelope },
      values,
      points: bundles,
      crnSafe: def.crnSafe !== false,
      gatedOff: !!def.gatedOff,
      isSentinel: !!def.isSentinel,
    };
  }

  const variables = [];
  const sentinels = [];
  for (const def of variableDefs) {
    const curve = buildVariableCurve(def);
    if (def.isSentinel) sentinels.push(curve);
    else variables.push(curve);
  }

  return {
    schemaVersion: SENSITIVITY_SCHEMA_VERSION,
    meta: {
      startedAt: meta?.startedAt ?? null,
      durationMs: meta?.durationMs ?? null,
      seed: meta?.seed >>> 0,
      pathsPerPoint: meta?.pathsPerPoint ?? 0,
      sweepPoints: meta?.sweepPoints ?? 0,
      evaluationCount: evaluated.length,
    },
    baselineRef: baselineRef || null,
    percentileGrid: [...PERCENTILE_GRID],
    metricDefs: METRIC_DEFS.map((m) => ({ ...m })),
    baseline: baselineEval.bundle,
    variables,
    sentinels,
  };
}

/**
 * Read a scalar metric from a MetricBundle at a percentile rank (for perPath)
 * or the rate value (for rate metrics). `percentile` is 5…95; ignored for rates.
 */
export function readMetricValue(bundle, metricId, percentile = 50) {
  const def = getMetricDef(metricId);
  if (!def || !bundle) return null;
  if (def.kind === 'rate') {
    const entry = bundle.rates?.[metricId];
    return entry ? entry.value : null;
  }
  const series = bundle.perPath?.[metricId];
  if (!series) return null;
  const grid = PERCENTILE_GRID;
  const idx = grid.indexOf(percentile);
  if (idx >= 0 && series.percentiles?.[idx] != null) {
    return series.percentiles[idx];
  }
  // Fallback: interpolate nearest grid neighbors.
  if (!series.percentiles?.length) return series.mean ?? null;
  let lo = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] <= percentile) lo = i;
  }
  const hi = Math.min(lo + 1, grid.length - 1);
  if (lo === hi || grid[hi] === grid[lo]) return series.percentiles[lo];
  const t = (percentile - grid[lo]) / (grid[hi] - grid[lo]);
  return series.percentiles[lo] * (1 - t) + series.percentiles[hi] * t;
}

/** Sampling-error whisker half-width for a rate metric (null for perPath). */
export function readMetricSe(bundle, metricId) {
  const def = getMetricDef(metricId);
  if (!def || def.kind !== 'rate' || !bundle) return null;
  return bundle.rates?.[metricId]?.se ?? null;
}

/** Mean of a per-path metric series (null for rate metrics). */
export function readMetricMean(bundle, metricId) {
  const def = getMetricDef(metricId);
  if (!def || def.kind !== 'perPath' || !bundle) return null;
  const series = bundle.perPath?.[metricId];
  if (!series) return null;
  return Number.isFinite(series.mean) ? series.mean : null;
}

// Re-export for callers that already import early-weight helpers from statistics.
export { isEarlyWeightingActive };
