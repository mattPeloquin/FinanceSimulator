// SOR Lab view prefs (metric, percentile band, filters). Stored under fs:sor-lab:ui.

import { SOR_LAB_UI_KEY } from './storageKeys.js';
import { PERCENTILE_GRID } from '../core/sensitivity.js';

export { SOR_LAB_UI_KEY };

/** Cap on simultaneously overlaid response curves (mirrors curveModel). */
const MAX_CURVE_SELECTION = 5;

export const DEFAULT_LAB_UI_PREFS = Object.freeze({
  metric: 'successRate',
  band: Object.freeze({ low: 10, high: 90 }),
  barStyle: 'band',
  categoryFilter: 'all',
  topN: 15,
  showBelowNoise: false,
  selectedVariableIds: Object.freeze([]),
  focusedVariableId: null,
  curveThreshold: null,
});
function snapPercentile(p, fallback) {
  const n = Number(p);
  if (!Number.isFinite(n)) return fallback;
  let best = PERCENTILE_GRID[0];
  let bestDist = Infinity;
  for (const g of PERCENTILE_GRID) {
    const d = Math.abs(g - n);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return best;
}

function normalizeSelectedIds(raw, legacyId) {
  let ids = [];
  if (Array.isArray(raw)) {
    ids = raw.filter((id) => typeof id === 'string' && id.length > 0);
  } else if (typeof legacyId === 'string' && legacyId.length > 0) {
    ids = [legacyId];
  }
  // Dedupe preserving order, then cap.
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_CURVE_SELECTION) break;
  }
  return out;
}

export function normalizeLabUiPrefs(raw) {
  const base = {
    metric: DEFAULT_LAB_UI_PREFS.metric,
    band: { ...DEFAULT_LAB_UI_PREFS.band },
    barStyle: DEFAULT_LAB_UI_PREFS.barStyle,
    categoryFilter: DEFAULT_LAB_UI_PREFS.categoryFilter,
    topN: DEFAULT_LAB_UI_PREFS.topN,
    showBelowNoise: DEFAULT_LAB_UI_PREFS.showBelowNoise,
    selectedVariableIds: [],
    focusedVariableId: null,
    curveThreshold: null,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  if (typeof raw.metric === 'string') base.metric = raw.metric;
  if (raw.band && typeof raw.band === 'object') {
    base.band = {
      low: snapPercentile(raw.band.low, base.band.low),
      high: snapPercentile(raw.band.high, base.band.high),
    };
    if (base.band.low > base.band.high) {
      [base.band.low, base.band.high] = [base.band.high, base.band.low];
    }
  }
  if (raw.barStyle === 'median' || raw.barStyle === 'band') base.barStyle = raw.barStyle;
  if (['all', 'decision', 'uncertainty'].includes(raw.categoryFilter)) {
    base.categoryFilter = raw.categoryFilter;
  }
  if (Number.isFinite(Number(raw.topN))) {
    base.topN = Math.min(40, Math.max(3, Math.round(Number(raw.topN))));
  }
  base.showBelowNoise = !!raw.showBelowNoise;
  base.selectedVariableIds = normalizeSelectedIds(
    raw.selectedVariableIds,
    raw.selectedVariableId,
  );
  if (typeof raw.focusedVariableId === 'string') {
    base.focusedVariableId = raw.focusedVariableId;
  } else if (base.selectedVariableIds.length) {
    base.focusedVariableId = base.selectedVariableIds[base.selectedVariableIds.length - 1];
  }
  if (base.focusedVariableId && !base.selectedVariableIds.includes(base.focusedVariableId)) {
    base.focusedVariableId = base.selectedVariableIds[base.selectedVariableIds.length - 1] || null;
  }
  if (raw.curveThreshold === null || raw.curveThreshold === '') {
    base.curveThreshold = null;
  } else if (Number.isFinite(Number(raw.curveThreshold))) {
    base.curveThreshold = Number(raw.curveThreshold);
  }
  return base;
}

export function loadLabUiPrefs() {
  try {
    const raw = localStorage.getItem(SOR_LAB_UI_KEY);
    if (raw) return normalizeLabUiPrefs(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  return normalizeLabUiPrefs(null);
}

export function saveLabUiPrefs(partial = {}) {
  const next = normalizeLabUiPrefs({ ...loadLabUiPrefs(), ...partial });
  try {
    localStorage.setItem(SOR_LAB_UI_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
