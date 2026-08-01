// Pure selectors over a LabSweepResult. Visualizations never touch the stored
// curve shape directly — add a chart by adding a selector here.

import {
  getMetricDef,
  readMetricValue,
  readMetricSe,
  readMetricMean,
  PERCENTILE_GRID,
} from '../../../core/sensitivity.js';

function clampBand(low, high) {
  const grid = PERCENTILE_GRID;
  let lo = Number(low);
  let hi = Number(high);
  if (!Number.isFinite(lo)) lo = 10;
  if (!Number.isFinite(hi)) hi = 90;
  // Snap to the stored percentile grid.
  const snap = (p) => {
    let best = grid[0];
    let bestDist = Infinity;
    for (const g of grid) {
      const d = Math.abs(g - p);
      if (d < bestDist) {
        bestDist = d;
        best = g;
      }
    }
    return best;
  };
  lo = snap(lo);
  hi = snap(hi);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { low: lo, high: hi };
}

function noiseFloor(result, metricId, band) {
  let maxImpact = 0;
  for (const s of result.sentinels || []) {
    const impact = variableImpact(s, metricId, band);
    if (impact != null && impact > maxImpact) maxImpact = impact;
  }
  return maxImpact;
}

/**
 * Absolute impact of a variable for the active metric / band.
 * For perPath: |metric(P_high at high) - metric(P_low at low)| style span
 *   using the max absolute deviation of low/high endpoints from baseline
 *   across the band (low percentile at left, high at right).
 * For rates: |rate(high) - rate(low)| on the curve endpoints.
 */
export function variableImpact(variable, metricId, band) {
  if (!variable?.values?.length || !variable.points?.length) return null;
  const def = getMetricDef(metricId);
  if (!def) return null;
  const { low: pLow, high: pHigh } = clampBand(band?.low, band?.high);

  const n = variable.values.length;
  const left = variable.points[0];
  const right = variable.points[n - 1];
  const baseline = (() => {
    // Prefer the point nearest the recorded baselineValue.
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(variable.values[i] - variable.baselineValue);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return variable.points[bestIdx];
  })();

  if (def.kind === 'rate') {
    const lo = readMetricValue(left, metricId);
    const hi = readMetricValue(right, metricId);
    if (lo == null || hi == null) return null;
    return Math.abs(hi - lo);
  }

  // Band-shaped impact: how far the low/high percentile endpoints move
  // relative to the baseline median (P50), taking the larger absolute swing.
  const baseMid = readMetricValue(baseline, metricId, 50);
  const leftLow = readMetricValue(left, metricId, pLow);
  const leftHigh = readMetricValue(left, metricId, pHigh);
  const rightLow = readMetricValue(right, metricId, pLow);
  const rightHigh = readMetricValue(right, metricId, pHigh);
  if ([baseMid, leftLow, leftHigh, rightLow, rightHigh].some((v) => v == null)) return null;

  const swings = [
    Math.abs(leftLow - baseMid),
    Math.abs(leftHigh - baseMid),
    Math.abs(rightLow - baseMid),
    Math.abs(rightHigh - baseMid),
    Math.abs(leftLow - rightLow),
    Math.abs(leftHigh - rightHigh),
  ];
  return Math.max(...swings);
}

/**
 * Tornado rows for the current view. Sorted by impact descending.
 *
 * @returns {{ rows: object[], noiseFloor: number, metric: object }}
 */
export function tornadoRows(result, view = {}) {
  if (!result) return { rows: [], noiseFloor: 0, metric: null };
  const metricId = view.metric || 'successRate';
  const metric = getMetricDef(metricId);
  const band = clampBand(view.band?.low, view.band?.high);
  const categoryFilter = view.categoryFilter || 'all';
  const topN = Number.isFinite(view.topN) ? view.topN : 15;
  const showBelowNoise = !!view.showBelowNoise;
  const floor = noiseFloor(result, metricId, band);

  let variables = (result.variables || []).filter((v) => !v.gatedOff);
  if (categoryFilter === 'decision' || categoryFilter === 'uncertainty') {
    variables = variables.filter((v) => v.category === categoryFilter);
  }

  const rows = [];
  for (const variable of variables) {
    const impact = variableImpact(variable, metricId, band);
    if (impact == null) continue;
    const n = variable.values.length;
    const left = variable.points[0];
    const right = variable.points[n - 1];
    const baselineIdx = nearestIndex(variable.values, variable.baselineValue);
    const baseline = variable.points[baselineIdx];

    let lowValue;
    let highValue;
    let baselineValue;
    let se = null;

    if (metric?.kind === 'rate') {
      lowValue = readMetricValue(left, metricId);
      highValue = readMetricValue(right, metricId);
      baselineValue = readMetricValue(baseline, metricId);
      se = Math.max(
        readMetricSe(left, metricId) || 0,
        readMetricSe(right, metricId) || 0,
      );
    } else {
      // Band bar endpoints: metric at P_low / P_high for the worse/better
      // sweep ends — expose both percentiles at each end for the chart.
      lowValue = {
        pLow: readMetricValue(left, metricId, band.low),
        pMid: readMetricValue(left, metricId, 50),
        pHigh: readMetricValue(left, metricId, band.high),
      };
      highValue = {
        pLow: readMetricValue(right, metricId, band.low),
        pMid: readMetricValue(right, metricId, 50),
        pHigh: readMetricValue(right, metricId, band.high),
      };
      baselineValue = {
        pLow: readMetricValue(baseline, metricId, band.low),
        pMid: readMetricValue(baseline, metricId, 50),
        pHigh: readMetricValue(baseline, metricId, band.high),
      };
    }

    const belowNoise = impact <= floor + 1e-15;
    rows.push({
      id: variable.id,
      label: variable.label,
      group: variable.group,
      category: variable.category,
      unit: variable.unit,
      envelope: variable.envelope,
      paramLow: variable.values[0],
      paramHigh: variable.values[n - 1],
      baselineParam: variable.baselineValue,
      impact,
      belowNoise,
      lowValue,
      highValue,
      baselineValue,
      se,
    });
  }

  rows.sort((a, b) => b.impact - a.impact);

  let visible = rows;
  if (!showBelowNoise) {
    visible = rows.filter((r) => !r.belowNoise);
    // Always keep at least a few so an empty chart is rare when everything
    // is near the noise floor.
    if (visible.length === 0) visible = rows.slice(0, Math.min(5, rows.length));
  }
  if (topN > 0) visible = visible.slice(0, topN);

  return { rows: visible, allRows: rows, noiseFloor: floor, metric, band };
}

function nearestIndex(values, target) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Per-variable response curve for the multi-variable overlay chart.
 * Returns x values + percentile / rate / mean / se series for the active metric.
 */
export function curveSeries(result, variableId, view = {}) {
  if (!result || !variableId) return null;
  const variable = [...(result.variables || []), ...(result.sentinels || [])]
    .find((v) => v.id === variableId);
  if (!variable) return null;

  const metricId = view.metric || 'successRate';
  const metric = getMetricDef(metricId);
  const band = clampBand(view.band?.low, view.band?.high);
  const x = [...variable.values];

  const common = {
    variable,
    metric,
    band,
    x,
    envelope: variable.envelope,
    baselineValue: variable.baselineValue,
    crnSafe: variable.crnSafe !== false,
    isSentinel: !!variable.isSentinel,
  };

  if (metric?.kind === 'rate') {
    return {
      ...common,
      series: {
        value: variable.points.map((p) => readMetricValue(p, metricId)),
        se: variable.points.map((p) => readMetricSe(p, metricId)),
      },
    };
  }

  // Fan ranks plus the active band endpoints (all already on the stored grid).
  const ranks = new Set([5, 10, 25, 50, 75, 90, 95, band.low, band.high]);
  const percentiles = {};
  for (const p of ranks) {
    percentiles[p] = variable.points.map((pt) => readMetricValue(pt, metricId, p));
  }
  return {
    ...common,
    series: {
      percentiles,
      mean: variable.points.map((pt) => readMetricMean(pt, metricId)),
    },
  };
}

/** Flat ranked table (same ordering as tornado, all columns). */
export function rankedTable(result, view = {}) {
  const { allRows, rows, noiseFloor: floor, metric, band } = tornadoRows(result, {
    ...view,
    topN: 0,
    showBelowNoise: true,
  });
  return { rows: allRows || rows, noiseFloor: floor, metric, band };
}
