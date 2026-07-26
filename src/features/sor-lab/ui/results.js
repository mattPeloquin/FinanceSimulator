// SOR Lab results panel: view controls + tornado / curve rendering from stored curves.

import { METRIC_DEFS, PERCENTILE_GRID, getMetricDef } from '../../../core/sensitivity.js';
import { onThemeChange } from '../../../ui/theme.js';
import { saveLabUiPrefs, loadLabUiPrefs } from '../../../state/labUiPrefs.js';
import {
  getLabConfig,
  patchLabView,
  getLabSweepResult,
  setLabSweepResult,
  isLabResultStale,
} from '../session.js';
import { tornadoRows, curveSeries } from './select.js';
import { drawTornado } from './charts/tornado.js';
import { drawResponseCurve } from './charts/responseCurve.js';

let bound = false;
let viewControlsReady = false;

export function setLabLoading(isLoading) {
  const loading = document.getElementById('sor-lab-loading');
  const cancel = document.getElementById('sor-lab-cancel');
  const run = document.getElementById('sor-lab-run');
  if (isLoading) {
    loading?.classList.remove('hidden');
    loading?.classList.add('flex');
    cancel?.classList.remove('hidden');
    if (run) run.disabled = true;
    updateLabProgress(0);
  } else {
    loading?.classList.add('hidden');
    loading?.classList.remove('flex');
    cancel?.classList.add('hidden');
    if (run) run.disabled = false;
  }
}

export function updateLabProgress(fraction, stage, numCores) {
  const bar = document.getElementById('sor-lab-progress-bar');
  const text = document.getElementById('sor-lab-loading-text');
  const pctEl = document.getElementById('sor-lab-loading-pct');
  const pct = Math.round((Number(fraction) || 0) * 100);
  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (text) {
    const coreNote = numCores > 1 ? ` (${numCores + 1} cores)` : '';
    text.textContent = stage
      ? `${stage}…${coreNote}`
      : `Running sensitivity…${coreNote}`;
  }
}

export function clearLabResults() {
  setLabSweepResult(null);
  const empty = document.getElementById('sor-lab-results-empty');
  const panel = document.getElementById('sor-lab-results-panel');
  empty?.classList.remove('hidden');
  panel?.classList.add('hidden');
  refreshLabStaleBanner();
}

export function applyLabViewPrefs(view) {
  ensureViewControls();
  const v = view || getLabConfig().view;
  const metric = document.getElementById('sor-lab-metric');
  const category = document.getElementById('sor-lab-category');
  const bandLow = document.getElementById('sor-lab-band-low');
  const bandHigh = document.getElementById('sor-lab-band-high');
  const barStyle = document.getElementById('sor-lab-bar-style');
  const topN = document.getElementById('sor-lab-top-n');
  const showNoise = document.getElementById('sor-lab-show-noise');
  if (metric) metric.value = v.metric || 'successRate';
  if (category) category.value = v.categoryFilter || 'all';
  if (bandLow) bandLow.value = String(v.band?.low ?? 10);
  if (bandHigh) bandHigh.value = String(v.band?.high ?? 90);
  if (barStyle) barStyle.value = v.barStyle || 'band';
  if (topN) topN.value = String(v.topN ?? 15);
  if (showNoise) showNoise.checked = !!v.showBelowNoise;
  syncBandEnabled();
}

function ensureViewControls() {
  if (viewControlsReady) return;
  const metric = document.getElementById('sor-lab-metric');
  if (metric && metric.options.length === 0) {
    for (const m of METRIC_DEFS) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      metric.appendChild(opt);
    }
  }
  for (const id of ['sor-lab-band-low', 'sor-lab-band-high']) {
    const el = document.getElementById(id);
    if (!el || el.options.length) continue;
    for (const p of PERCENTILE_GRID) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = `P${p}`;
      el.appendChild(opt);
    }
  }
  viewControlsReady = true;
}

function syncBandEnabled() {
  const metricId = document.getElementById('sor-lab-metric')?.value || 'successRate';
  const def = getMetricDef(metricId);
  const isRate = def?.kind === 'rate';
  for (const id of ['sor-lab-band-low', 'sor-lab-band-high', 'sor-lab-bar-style']) {
    const el = document.getElementById(id);
    if (el) el.disabled = isRate;
  }
  const note = document.getElementById('sor-lab-band-note');
  note?.classList.toggle('hidden', !isRate);
}

export function refreshLabStaleBanner() {
  const banner = document.getElementById('sor-lab-stale-banner');
  if (!banner) return;
  const hasResult = !!getLabSweepResult();
  banner.classList.toggle('hidden', !(hasResult && isLabResultStale()));
}

export function paintLabResults(payload) {
  const result = payload?.result;
  if (!result) return;
  setLabSweepResult(result);
  if (payload.config?.view) {
    patchLabView(payload.config.view);
  }
  const empty = document.getElementById('sor-lab-results-empty');
  const panel = document.getElementById('sor-lab-results-panel');
  empty?.classList.add('hidden');
  panel?.classList.remove('hidden');
  applyLabViewPrefs(getLabConfig().view);
  populateCurveVariableSelect(result);
  renderLabCharts();
  refreshLabStaleBanner();
  const status = document.getElementById('sor-lab-status');
  if (status) {
    const n = result.meta?.evaluationCount ?? 0;
    const ms = result.meta?.durationMs;
    const secs = ms != null ? ` in ${(ms / 1000).toFixed(1)}s` : '';
    status.textContent = `Sweep complete — ${n} evaluations${secs}. Seed ${result.meta?.seed ?? '—'}.`;
  }
}

function populateCurveVariableSelect(result) {
  const select = document.getElementById('sor-lab-curve-variable');
  if (!select) return;
  const view = getLabConfig().view;
  const { rows } = tornadoRows(result, { ...view, topN: 0, showBelowNoise: true });
  const current = view.selectedVariableId || rows[0]?.id || '';
  select.innerHTML = rows.map((r) =>
    `<option value="${r.id}"${r.id === current ? ' selected' : ''}>${r.label}</option>`,
  ).join('');
  if (current && !rows.some((r) => r.id === current) && rows[0]) {
    select.value = rows[0].id;
  }
}

export function renderLabCharts() {
  const result = getLabSweepResult();
  if (!result) return;
  const view = getLabConfig().view;
  const tornado = tornadoRows(result, view);
  drawTornado(document.getElementById('sor-lab-tornado'), {
    rows: tornado.rows,
    metric: tornado.metric,
    band: tornado.band,
    barStyle: view.barStyle,
    noiseFloor: tornado.noiseFloor,
  });
  const noiseLabel = document.getElementById('sor-lab-noise-label');
  if (noiseLabel && tornado.metric) {
    const floor = tornado.noiseFloor;
    const unit = tornado.metric.unit === 'fraction'
      ? `${(floor * 100).toFixed(2)} pp`
      : tornado.metric.unit === 'dollars'
        ? `$${(floor / 1000).toFixed(0)}k`
        : floor.toFixed(3);
    noiseLabel.textContent = `Noise floor (sentinels): ${unit}. Grey bars are at or below this level.`;
  }

  const variableId = document.getElementById('sor-lab-curve-variable')?.value
    || view.selectedVariableId
    || tornado.rows[0]?.id;
  if (variableId) {
    const curve = curveSeries(result, variableId, view);
    drawResponseCurve(document.getElementById('sor-lab-curve'), curve);
  }
}

function readViewFromDom() {
  return {
    metric: document.getElementById('sor-lab-metric')?.value || 'successRate',
    categoryFilter: document.getElementById('sor-lab-category')?.value || 'all',
    band: {
      low: Number(document.getElementById('sor-lab-band-low')?.value) || 10,
      high: Number(document.getElementById('sor-lab-band-high')?.value) || 90,
    },
    barStyle: document.getElementById('sor-lab-bar-style')?.value || 'band',
    topN: Number(document.getElementById('sor-lab-top-n')?.value) || 15,
    showBelowNoise: !!document.getElementById('sor-lab-show-noise')?.checked,
    selectedVariableId: document.getElementById('sor-lab-curve-variable')?.value || null,
  };
}

function onViewChange() {
  const view = readViewFromDom();
  patchLabView(view);
  saveLabUiPrefs(view);
  syncBandEnabled();
  if (getLabSweepResult()) {
    populateCurveVariableSelect(getLabSweepResult());
    renderLabCharts();
  }
}

export function bindLabResults() {
  if (bound) return;
  bound = true;
  ensureViewControls();

  // Seed view from persisted Lab UI prefs on first bind.
  const stored = loadLabUiPrefs();
  patchLabView(stored);
  applyLabViewPrefs(stored);

  for (const id of [
    'sor-lab-metric',
    'sor-lab-category',
    'sor-lab-band-low',
    'sor-lab-band-high',
    'sor-lab-bar-style',
    'sor-lab-top-n',
    'sor-lab-show-noise',
    'sor-lab-curve-variable',
  ]) {
    document.getElementById(id)?.addEventListener('change', onViewChange);
  }

  onThemeChange(() => {
    if (getLabSweepResult()) renderLabCharts();
  });
}
