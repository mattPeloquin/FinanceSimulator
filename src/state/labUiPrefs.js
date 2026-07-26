// SOR Lab view prefs (metric, percentile band, filters). Stored under fs:sor-lab:ui.

import { SOR_LAB_UI_KEY } from './storageKeys.js';
import { PERCENTILE_GRID } from '../core/sensitivity.js';

export { SOR_LAB_UI_KEY };

export const DEFAULT_LAB_UI_PREFS = Object.freeze({
  metric: 'successRate',
  band: Object.freeze({ low: 10, high: 90 }),
  barStyle: 'band',
  categoryFilter: 'all',
  topN: 15,
  showBelowNoise: false,
  selectedVariableId: null,
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

export function normalizeLabUiPrefs(raw) {
  const base = {
    metric: DEFAULT_LAB_UI_PREFS.metric,
    band: { ...DEFAULT_LAB_UI_PREFS.band },
    barStyle: DEFAULT_LAB_UI_PREFS.barStyle,
    categoryFilter: DEFAULT_LAB_UI_PREFS.categoryFilter,
    topN: DEFAULT_LAB_UI_PREFS.topN,
    showBelowNoise: DEFAULT_LAB_UI_PREFS.showBelowNoise,
    selectedVariableId: null,
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
  if (typeof raw.selectedVariableId === 'string') {
    base.selectedVariableId = raw.selectedVariableId;
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
