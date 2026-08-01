// Pure helpers for the multi-variable response-curve model. DOM- and
// Chart.js-free so Vitest can cover the axis math, slope, thresholds, and
// monotonicity without a canvas.

export const MAX_CURVE_SELECTION = 5;

/**
 * Map a native parameter value onto [-1, +1] relative to the baseline and
 * that variable's swept envelope. Baseline → 0, envelope low → -1, high → +1.
 * When the baseline sits on an endpoint the collapsed side maps to 0.
 */
export function normalizedPosition(value, envelope, baselineValue) {
  const v = Number(value);
  const base = Number(baselineValue);
  const low = Number(envelope?.low);
  const high = Number(envelope?.high);
  if (![v, base, low, high].every(Number.isFinite)) return 0;
  if (v >= base) {
    const span = high - base;
    if (span <= 1e-15) return 0;
    return Math.min(1, (v - base) / span);
  }
  const span = base - low;
  if (span <= 1e-15) return 0;
  return Math.max(-1, (v - base) / span);
}

/** Inverse of normalizedPosition: normalized t → native parameter value. */
export function denormalizePosition(t, envelope, baselineValue) {
  const tt = Number(t);
  const base = Number(baselineValue);
  const low = Number(envelope?.low);
  const high = Number(envelope?.high);
  if (![tt, base, low, high].every(Number.isFinite)) return base;
  if (tt >= 0) {
    const span = high - base;
    if (span <= 1e-15) return base;
    return base + Math.min(1, tt) * span;
  }
  const span = base - low;
  if (span <= 1e-15) return base;
  return base + Math.max(-1, tt) * span;
}

/**
 * Local steepness at baseline: metric change per +10% of the variable's range.
 * Uses a central difference across points bracketing t=0; falls back to
 * one-sided when the baseline is an endpoint.
 */
export function slopePer10Pct(ts, ys) {
  if (!ts?.length || !ys?.length || ts.length !== ys.length) return null;
  let left = -1;
  let right = -1;
  let atZero = -1;
  for (let i = 0; i < ts.length; i++) {
    if (!Number.isFinite(ts[i]) || !Number.isFinite(ys[i])) continue;
    if (Math.abs(ts[i]) < 1e-12) atZero = i;
    if (ts[i] < -1e-12) left = i;
    if (ts[i] > 1e-12 && right < 0) right = i;
  }

  let dy;
  let dt;
  if (left >= 0 && right >= 0) {
    dy = ys[right] - ys[left];
    dt = ts[right] - ts[left];
  } else if (atZero >= 0 && right >= 0) {
    dy = ys[right] - ys[atZero];
    dt = ts[right] - ts[atZero];
  } else if (left >= 0 && atZero >= 0) {
    dy = ys[atZero] - ys[left];
    dt = ts[atZero] - ts[left];
  } else if (ts.length >= 2) {
    dy = ys[ys.length - 1] - ys[0];
    dt = ts[ts.length - 1] - ts[0];
  } else {
    return null;
  }
  if (!Number.isFinite(dy) || !Number.isFinite(dt) || Math.abs(dt) < 1e-15) return null;
  // Per +0.1 on the normalized axis (= +10% of the swept range on that side).
  return (dy / dt) * 0.1;
}

/**
 * Sign-change scan with linear interpolation. A non-monotonic curve can cross
 * more than once; every crossing is returned as { t, y }.
 */
export function findThresholdCrossings(ts, ys, target) {
  const crossings = [];
  if (!Number.isFinite(target) || !ts?.length || ts.length !== ys?.length) return crossings;
  for (let i = 1; i < ts.length; i++) {
    const y0 = ys[i - 1];
    const y1 = ys[i];
    const t0 = ts[i - 1];
    const t1 = ts[i];
    if (![y0, y1, t0, t1].every(Number.isFinite)) continue;
    if (Math.abs(y0 - target) < 1e-12) {
      crossings.push({ t: t0, y: target });
      continue;
    }
    const d0 = y0 - target;
    const d1 = y1 - target;
    if (d0 * d1 > 0) continue;
    if (Math.abs(d1 - d0) < 1e-15) continue;
    const u = -d0 / (d1 - d0);
    crossings.push({ t: t0 + u * (t1 - t0), y: target });
  }
  return crossings;
}

/**
 * Detect whether a series is monotonic within `tolerance`. Wiggles smaller
 * than the tolerance (e.g. the sentinel noise floor) are ignored.
 */
export function describeMonotonicity(ys, tolerance = 0) {
  const tol = Math.max(0, Number(tolerance) || 0);
  if (!ys?.length) {
    return { monotonic: true, direction: 'flat', turningIndex: null };
  }
  let direction = 'flat';
  let lastSign = 0;
  for (let i = 1; i < ys.length; i++) {
    const a = ys[i - 1];
    const b = ys[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const delta = b - a;
    if (Math.abs(delta) <= tol) continue;
    const sign = delta > 0 ? 1 : -1;
    if (lastSign === 0) {
      lastSign = sign;
      direction = sign > 0 ? 'up' : 'down';
      continue;
    }
    if (sign !== lastSign) {
      return { monotonic: false, direction: 'turns', turningIndex: i - 1 };
    }
  }
  return { monotonic: true, direction, turningIndex: null };
}

function interpolateAt(ts, ys, t) {
  if (!ts?.length || ts.length !== ys?.length) return null;
  if (t <= ts[0]) return ys[0];
  if (t >= ts[ts.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < ts.length; i++) {
    if (t <= ts[i]) {
      const t0 = ts[i - 1];
      const t1 = ts[i];
      const y0 = ys[i - 1];
      const y1 = ys[i];
      if (Math.abs(t1 - t0) < 1e-15) return y0;
      const u = (t - t0) / (t1 - t0);
      return y0 + u * (y1 - y0);
    }
  }
  return ys[ys.length - 1];
}

/**
 * Assemble the chart-ready multi-curve model from widened curveSeries outputs.
 *
 * @param {object} opts
 * @param {object[]} opts.seriesList — outputs of curveSeries()
 * @param {object} opts.metric
 * @param {{ low: number, high: number }} opts.band
 * @param {number} opts.noiseFloor
 * @param {string|null} opts.focusedId
 * @param {number|null} opts.threshold
 * @param {string[]} opts.palette
 */
export function buildCurveModel({
  seriesList = [],
  metric,
  band,
  noiseFloor = 0,
  focusedId = null,
  threshold = null,
  palette = [],
} = {}) {
  const curves = [];
  let baselineMetric = null;

  for (let i = 0; i < seriesList.length; i++) {
    const series = seriesList[i];
    if (!series?.variable || !series.metric) continue;
    const variable = series.variable;
    const envelope = variable.envelope || series.envelope;
    const baselineValue = series.baselineValue ?? variable.baselineValue;
    const color = palette[i % Math.max(1, palette.length)] || '#6366f1';

    const ts = (series.x || []).map((v) => normalizedPosition(v, envelope, baselineValue));
    let ys;
    let meanYs = null;
    let seYs = null;
    const percentiles = series.series?.percentiles || {};

    if (metric?.kind === 'rate') {
      ys = series.series?.value || [];
      seYs = series.series?.se || null;
    } else {
      ys = percentiles[50] || percentiles[band?.low] || [];
      meanYs = series.series?.mean || null;
    }

    // Shared baseline metric (every curve embeds the same baseline bundle).
    if (baselineMetric == null) {
      const zeroIdx = ts.findIndex((t) => Math.abs(t) < 1e-12);
      if (zeroIdx >= 0 && Number.isFinite(ys[zeroIdx])) {
        baselineMetric = ys[zeroIdx];
      } else if (ys.length) {
        baselineMetric = interpolateAt(ts, ys, 0);
      }
    }

    const slope = slopePer10Pct(ts, ys);
    const mono = describeMonotonicity(ys, noiseFloor);
    const crossings = Number.isFinite(threshold)
      ? findThresholdCrossings(ts, ys, threshold)
      : [];

    const focused = focusedId != null
      ? variable.id === focusedId
      : i === 0;

    const points = ts.map((t, idx) => ({ x: t, y: ys[idx] }));

    const bandLow = percentiles[band?.low];
    const bandHigh = percentiles[band?.high];
    const bandPoints = (metric?.kind === 'perPath' && bandLow && bandHigh)
      ? {
        low: ts.map((t, idx) => ({ x: t, y: bandLow[idx] })),
        high: ts.map((t, idx) => ({ x: t, y: bandHigh[idx] })),
      }
      : null;

    // Nested fan only for the focused per-path curve.
    let fan = null;
    if (focused && metric?.kind === 'perPath') {
      const ranks = [
        [5, 95],
        [10, 90],
        [25, 75],
      ];
      fan = ranks
        .filter(([lo, hi]) => percentiles[lo] && percentiles[hi])
        .map(([lo, hi]) => ({
          low: lo,
          high: hi,
          lowPoints: ts.map((t, idx) => ({ x: t, y: percentiles[lo][idx] })),
          highPoints: ts.map((t, idx) => ({ x: t, y: percentiles[hi][idx] })),
        }));
    }

    let se = null;
    if (metric?.kind === 'rate' && seYs) {
      se = {
        low: ts.map((t, idx) => ({
          x: t,
          y: (ys[idx] ?? 0) - (seYs[idx] || 0),
        })),
        high: ts.map((t, idx) => ({
          x: t,
          y: (ys[idx] ?? 0) + (seYs[idx] || 0),
        })),
      };
    }

    let mean = null;
    if (focused && meanYs) {
      mean = ts.map((t, idx) => ({ x: t, y: meanYs[idx] }));
    }

    curves.push({
      id: variable.id,
      label: variable.label,
      unit: variable.unit,
      envelope,
      baselineValue,
      color,
      points,
      band: bandPoints,
      fan,
      se,
      mean,
      slope,
      monotonic: mono,
      crossings,
      focused,
      ys,
      ts,
    });
  }

  const noiseBand = (baselineMetric != null && noiseFloor > 0)
    ? { low: baselineMetric - noiseFloor, high: baselineMetric + noiseFloor }
    : null;

  return {
    curves,
    metric,
    band,
    baselineMetric,
    noiseBand,
    threshold: Number.isFinite(threshold) ? threshold : null,
  };
}

/** Interpolate every curve's native param + metric at a normalized t. */
export function readoutAt(model, t) {
  if (!model?.curves?.length || !Number.isFinite(t)) return [];
  return model.curves.map((c) => {
    const native = denormalizePosition(t, c.envelope, c.baselineValue);
    const metricValue = interpolateAt(c.ts, c.ys, t);
    return {
      id: c.id,
      label: c.label,
      unit: c.unit,
      color: c.color,
      native,
      metricValue,
      focused: c.focused,
    };
  });
}

/**
 * Toggle a variable id into a capped selection list (FIFO when over max).
 * Returns the next selectedIds array.
 */
export function toggleSelection(selectedIds, variableId, max = MAX_CURVE_SELECTION) {
  const ids = Array.isArray(selectedIds) ? [...selectedIds] : [];
  const idx = ids.indexOf(variableId);
  if (idx >= 0) {
    ids.splice(idx, 1);
    return ids;
  }
  ids.push(variableId);
  while (ids.length > max) ids.shift();
  return ids;
}
