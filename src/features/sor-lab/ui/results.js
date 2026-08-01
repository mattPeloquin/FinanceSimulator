// SOR Lab results panel: view controls + tornado / curve rendering from stored curves.

import { METRIC_DEFS, PERCENTILE_GRID, getMetricDef } from '../../../core/sensitivity.js';
import { onThemeChange } from '../../../ui/theme.js';
import { getChartTheme } from '../../../ui/charts/chartTheme.js';
import { formatK, formatPercent } from '../../../ui/format.js';
import { saveLabUiPrefs, loadLabUiPrefs } from '../../../state/labUiPrefs.js';
import {
  getLabConfig,
  patchLabView,
  getLabSweepResult,
  setLabSweepResult,
  isLabResultStale,
} from '../session.js';
import { tornadoRows, curveSeries, rankedTable } from './select.js';
import {
  buildCurveModel,
  toggleSelection,
  MAX_CURVE_SELECTION,
} from './curveModel.js';
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
  const threshold = document.getElementById('sor-lab-curve-threshold');
  if (metric) metric.value = v.metric || 'successRate';
  if (category) category.value = v.categoryFilter || 'all';
  if (bandLow) bandLow.value = String(v.band?.low ?? 10);
  if (bandHigh) bandHigh.value = String(v.band?.high ?? 90);
  if (barStyle) barStyle.value = v.barStyle || 'band';
  if (topN) topN.value = String(v.topN ?? 15);
  if (showNoise) showNoise.checked = !!v.showBelowNoise;
  if (threshold) {
    threshold.value = v.curveThreshold == null ? '' : String(v.curveThreshold);
  }
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

function formatMetricShort(value, metric) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (metric?.unit === 'fraction') return formatPercent(value, 1);
  if (metric?.unit === 'dollars') return formatK(value);
  if (metric?.unit === 'years') return value.toFixed(1);
  return String(Math.round(value * 100) / 100);
}

function defaultThresholdForMetric(metric) {
  if (metric?.kind === 'rate' && metric.unit === 'fraction') return 0.9;
  return null;
}

function ensureDefaultSelection(result, view) {
  const ids = Array.isArray(view.selectedVariableIds) ? [...view.selectedVariableIds] : [];
  if (ids.length) return view;
  const { rows } = tornadoRows(result, { ...view, topN: 0, showBelowNoise: true });
  const pick = rows.slice(0, 3).map((r) => r.id);
  return {
    ...view,
    selectedVariableIds: pick,
    focusedVariableId: pick[pick.length - 1] || null,
  };
}

function tornadoLegendHtml(metric, barStyle) {
  const swatch = (color, label) =>
    `<span class="inline-flex items-center gap-1 mr-3">`
    + `<span class="inline-block h-2.5 w-3 rounded-sm" style="background:${color}"></span>`
    + `${label}</span>`;
  const theme = getChartTheme();
  const colors = `${swatch(theme.tornadoLowEnd, 'Low end of range')}${swatch(theme.tornadoHighEnd, 'High end of range')}`;
  if (metric?.kind === 'rate') {
    return `${colors} Bar spans the metric at each end of the variable’s range from baseline; capped whisker adds Monte Carlo sampling error (±1 SE).`;
  }
  if (barStyle === 'median') {
    return `${colors} Bar spans the median outcome at each end of the range, relative to baseline.`;
  }
  return `${colors} Bar spans the P-low–P-high outcome band at each end, relative to the baseline median; the dark spine shows how far the median itself moves.`;
}

function renderCurveChips(model) {
  const host = document.getElementById('sor-lab-curve-chips');
  if (!host) return;
  if (!model?.curves?.length) {
    host.innerHTML = '<span class="text-xs text-theme-muted">Click tornado rows to compare variables.</span>';
    return;
  }
  host.innerHTML = model.curves.map((c) => {
    const slope = c.slope == null
      ? ''
      : `<span class="text-theme-muted tabular-nums">${formatMetricShort(c.slope, model.metric)}/10%</span>`;
    const badge = c.monotonic?.monotonic === false
      ? '<span class="rounded bg-amber-500/20 px-1 text-[10px] text-amber-600 dark:text-amber-300">turns</span>'
      : '';
    const ring = c.focused ? 'ring-2 ring-theme-accent' : 'border border-theme-border';
    return `<button type="button" data-curve-id="${c.id}" data-role="focus"
        class="inline-flex items-center gap-1.5 rounded-full ${ring} bg-theme-input px-2.5 py-1 text-xs text-theme-heading hover:bg-theme-muted/40">
        <span class="inline-block h-2 w-2 rounded-full" style="background:${c.color}"></span>
        <span class="font-medium">${c.label}</span>
        ${slope}
        ${badge}
        <span data-role="remove" class="ml-0.5 text-theme-muted hover:text-theme-heading" aria-label="Remove ${c.label}">×</span>
      </button>`;
  }).join('');

  host.querySelectorAll('button[data-curve-id]').forEach((btn) => {
    btn.addEventListener('click', (evt) => {
      const id = btn.getAttribute('data-curve-id');
      const role = evt.target?.getAttribute?.('data-role');
      if (role === 'remove' || evt.target?.closest?.('[data-role="remove"]')) {
        toggleVariableSelection(id, { removeOnly: true });
        return;
      }
      patchLabView({ focusedVariableId: id });
      saveLabUiPrefs({ focusedVariableId: id });
      renderLabCharts();
    });
  });
}

function renderRankedTable(result, view, model) {
  const table = document.getElementById('sor-lab-ranked-table');
  const tbody = table?.querySelector('tbody');
  if (!tbody) return;
  const ranked = rankedTable(result, view);
  const slopeById = new Map((model?.curves || []).map((c) => [c.id, c]));
  // Build slope for rows not currently selected too.
  const selected = new Set(view.selectedVariableIds || []);

  tbody.innerHTML = (ranked.rows || []).map((row) => {
    let slope = slopeById.get(row.id)?.slope;
    let mono = slopeById.get(row.id)?.monotonic;
    if (slope == null) {
      const series = curveSeries(result, row.id, view);
      if (series) {
        const mini = buildCurveModel({
          seriesList: [series],
          metric: ranked.metric,
          band: ranked.band,
          noiseFloor: ranked.noiseFloor,
          palette: ['#888'],
        });
        slope = mini.curves[0]?.slope;
        mono = mini.curves[0]?.monotonic;
      }
    }
    const flags = [
      row.belowNoise ? 'noise' : null,
      mono && !mono.monotonic ? 'turns' : null,
      selected.has(row.id) ? 'on chart' : null,
    ].filter(Boolean).join(', ') || '—';
    const selectedClass = selected.has(row.id) ? 'bg-theme-accent/10' : '';
    return `<tr data-var-id="${row.id}" class="cursor-pointer border-t border-theme-border/60 hover:bg-theme-muted/30 ${selectedClass}">
      <td class="py-1 pr-2">${row.label}</td>
      <td class="py-1 pr-2 text-theme-muted">${row.group || '—'}</td>
      <td class="py-1 pr-2 tabular-nums">${formatMetricShort(row.impact, ranked.metric)}</td>
      <td class="py-1 pr-2 tabular-nums">${formatMetricShort(slope, ranked.metric)}</td>
      <td class="py-1 text-theme-muted">${flags}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-var-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      toggleVariableSelection(tr.getAttribute('data-var-id'));
    });
  });
}

function toggleVariableSelection(variableId, { removeOnly = false } = {}) {
  if (!variableId) return;
  const view = getLabConfig().view;
  let ids = Array.isArray(view.selectedVariableIds) ? [...view.selectedVariableIds] : [];
  if (removeOnly) {
    ids = ids.filter((id) => id !== variableId);
  } else {
    ids = toggleSelection(ids, variableId, MAX_CURVE_SELECTION);
  }
  let focused = view.focusedVariableId;
  if (!ids.includes(focused)) {
    focused = ids[ids.length - 1] || null;
  } else if (!removeOnly && ids.includes(variableId)) {
    focused = variableId;
  }
  const next = { selectedVariableIds: ids, focusedVariableId: focused };
  patchLabView(next);
  saveLabUiPrefs(next);
  renderLabCharts();
}

export function paintLabResults(payload) {
  const result = payload?.result;
  if (!result) return;
  setLabSweepResult(result);
  if (payload.config?.view) {
    patchLabView(payload.config.view);
  }
  // Seed top-3 selection when nothing is selected yet.
  const seeded = ensureDefaultSelection(result, getLabConfig().view);
  if (seeded !== getLabConfig().view) {
    patchLabView({
      selectedVariableIds: seeded.selectedVariableIds,
      focusedVariableId: seeded.focusedVariableId,
    });
    // Default threshold for rate metrics when unset.
    const metric = getMetricDef(seeded.metric || 'successRate');
    if (getLabConfig().view.curveThreshold == null) {
      const defThresh = defaultThresholdForMetric(metric);
      if (defThresh != null) patchLabView({ curveThreshold: defThresh });
    }
  }
  const empty = document.getElementById('sor-lab-results-empty');
  const panel = document.getElementById('sor-lab-results-panel');
  empty?.classList.add('hidden');
  panel?.classList.remove('hidden');
  applyLabViewPrefs(getLabConfig().view);
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

export function renderLabCharts() {
  const result = getLabSweepResult();
  if (!result) return;
  let view = getLabConfig().view;
  view = ensureDefaultSelection(result, view);
  if (
    JSON.stringify(view.selectedVariableIds) !== JSON.stringify(getLabConfig().view.selectedVariableIds)
  ) {
    patchLabView({
      selectedVariableIds: view.selectedVariableIds,
      focusedVariableId: view.focusedVariableId,
    });
    view = getLabConfig().view;
  }

  const tornado = tornadoRows(result, view);
  drawTornado(document.getElementById('sor-lab-tornado'), {
    rows: tornado.rows,
    metric: tornado.metric,
    band: tornado.band,
    barStyle: view.barStyle,
    selectedIds: view.selectedVariableIds || [],
    onRowClick: (id) => toggleVariableSelection(id),
  });

  const legend = document.getElementById('sor-lab-tornado-legend');
  if (legend && tornado.metric) {
    legend.innerHTML = tornadoLegendHtml(tornado.metric, view.barStyle);
  }

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

  const ids = view.selectedVariableIds?.length
    ? view.selectedVariableIds
    : tornado.rows.slice(0, 3).map((r) => r.id);
  const seriesList = ids
    .map((id) => curveSeries(result, id, view))
    .filter(Boolean);
  const theme = getChartTheme();
  const threshold = view.curveThreshold;
  const model = buildCurveModel({
    seriesList,
    metric: tornado.metric,
    band: tornado.band,
    noiseFloor: tornado.noiseFloor,
    focusedId: view.focusedVariableId || ids[ids.length - 1] || null,
    threshold,
    palette: theme.labCurvePalette || [],
  });

  drawResponseCurve(document.getElementById('sor-lab-curve'), model, {
    readoutEl: document.getElementById('sor-lab-curve-readout'),
  });

  const caption = document.getElementById('sor-lab-curve-caption');
  if (caption) {
    if (tornado.metric?.kind === 'rate') {
      caption.textContent = 'Shaded ribbons are ±1 SE sampling error. Grey band is the sentinel noise floor around baseline.';
    } else {
      caption.textContent = 'Bands show the P-low–P-high spread; the focused curve adds a nested fan and dashed mean. Grey band is the sentinel noise floor.';
    }
  }

  renderCurveChips(model);
  renderRankedTable(result, view, model);
}

function readViewFromDom() {
  const threshRaw = document.getElementById('sor-lab-curve-threshold')?.value;
  let curveThreshold = null;
  if (threshRaw !== '' && threshRaw != null && Number.isFinite(Number(threshRaw))) {
    curveThreshold = Number(threshRaw);
  }
  const cfg = getLabConfig().view;
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
    selectedVariableIds: cfg.selectedVariableIds || [],
    focusedVariableId: cfg.focusedVariableId || null,
    curveThreshold,
  };
}

function onViewChange() {
  const view = readViewFromDom();
  // When metric switches to a rate and threshold is empty, seed 90%.
  const def = getMetricDef(view.metric);
  if (view.curveThreshold == null && def?.kind === 'rate') {
    view.curveThreshold = defaultThresholdForMetric(def);
    const el = document.getElementById('sor-lab-curve-threshold');
    if (el && view.curveThreshold != null) el.value = String(view.curveThreshold);
  }
  patchLabView(view);
  saveLabUiPrefs(view);
  syncBandEnabled();
  if (getLabSweepResult()) renderLabCharts();
}

export function bindLabResults() {
  if (bound) return;
  bound = true;
  ensureViewControls();

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
    'sor-lab-curve-threshold',
  ]) {
    document.getElementById(id)?.addEventListener('change', onViewChange);
  }

  onThemeChange(() => {
    if (getLabSweepResult()) renderLabCharts();
  });
}
