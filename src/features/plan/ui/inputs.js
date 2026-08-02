// Lifetime Plan form — timeline anchor + dynamic source rows.

import * as sessions from '../../../state/sessions.js';
import { resolveSourceStartYear } from '../../../core/lifetimePlan.js';
import { FEATURE_ACCUMULATE, FEATURE_WITHDRAW } from '../../../state/storageKeys.js';
import {
  getPlanState,
  patchPlanState,
  setPlanView,
  applyPlanPreset,
  detachPlanPreset,
  createPlanSourceRow,
  getResolvedSeriesMap,
} from '../session.js';
import { getPlanPresets } from '../presets.js';
import {
  listPlanSourceFeatures,
  strategyOptionsFor,
  defaultStrategyIdFor,
} from '../sources.js';
import { renderPlanCharts } from './results.js';

function el(id) {
  return document.getElementById(id);
}

let suppressForm = false;
/** Bumps on every renderPlanForm so stale async row rebuilds abort. */
let sourceRenderGen = 0;

function parsedBirth(raw) {
  if (raw === '' || raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function syncPlanFormToState() {
  if (suppressForm) return;
  const state = getPlanState();
  const sources = readSourcesFromDom(state.sources);
  patchPlanState({
    planStartYear: parseInt(el('plan-start-year')?.value, 10) || state.planStartYear,
    planEndYear: parseInt(el('plan-end-year')?.value, 10) || state.planEndYear,
    birthYearA: parsedBirth(el('plan-birth-a')?.value),
    birthYearB: parsedBirth(el('plan-birth-b')?.value),
    refreshSims: Number(el('plan-refresh-sims')?.value) || state.refreshSims,
    sources,
    presetActive: !!el('plan-preset-active')?.checked,
    view: state.view,
  });
}

function readSourcesFromDom(fallback) {
  const list = el('plan-sources-list');
  if (!list) return fallback || [];
  const rows = [...list.querySelectorAll('[data-plan-source-id]')];
  if (!rows.length) return fallback || [];
  return rows.map((row) => {
    const id = row.getAttribute('data-plan-source-id');
    const feature = row.querySelector('[data-field="feature"]')?.value
      || FEATURE_FALLBACK;
    return createPlanSourceRow({
      id,
      feature,
      sessionName: row.querySelector('[data-field="session"]')?.value || '',
      strategyId: row.querySelector('[data-field="strategy"]')?.value
        || defaultStrategyIdFor(feature),
      offsetYears: parseInt(row.querySelector('[data-field="offset"]')?.value, 10) || 0,
      startsAfter: row.querySelector('[data-field="starts-after"]')?.value || '',
      gapYears: parseInt(row.querySelector('[data-field="gap"]')?.value, 10) || 0,
      handoffPercentile: row.querySelector('[data-field="handoff"]')?.value || 'p50',
    });
  });
}

const FEATURE_FALLBACK = FEATURE_ACCUMULATE;

export function renderPlanForm() {
  const state = getPlanState();
  const gen = ++sourceRenderGen;
  suppressForm = true;
  try {
    if (el('plan-start-year')) el('plan-start-year').value = String(state.planStartYear);
    if (el('plan-end-year')) el('plan-end-year').value = String(state.planEndYear);
    if (el('plan-birth-a')) {
      el('plan-birth-a').value = state.birthYearA == null ? '' : String(state.birthYearA);
    }
    if (el('plan-birth-b')) {
      el('plan-birth-b').value = state.birthYearB == null ? '' : String(state.birthYearB);
    }
    if (el('plan-refresh-sims')) el('plan-refresh-sims').value = String(state.refreshSims);
    if (el('plan-preset-active')) el('plan-preset-active').checked = !!state.presetActive;
    if (el('plan-preset-level')) el('plan-preset-level').value = String(state.presetLevel);

    updatePresetLabel();
    syncViewToggle(state.view);
    void renderSourceRows(state.sources, gen).finally(() => {
      if (gen === sourceRenderGen) suppressForm = false;
    });
  } catch {
    if (gen === sourceRenderGen) suppressForm = false;
  }
}

function syncViewToggle(view) {
  const isNw = view !== 'cashflow';
  const nwBtn = el('plan-view-networth');
  const cfBtn = el('plan-view-cashflow');
  const nwPanel = el('plan-view-networth-panel');
  const cfPanel = el('plan-view-cashflow-panel');
  if (nwBtn) {
    nwBtn.className = isNw
      ? 'px-3 py-1 text-xs font-medium bg-theme-accent text-theme-on-accent'
      : 'px-3 py-1 text-xs font-medium bg-theme-surface text-theme-body hover:bg-theme-muted';
  }
  if (cfBtn) {
    cfBtn.className = !isNw
      ? 'px-3 py-1 text-xs font-medium bg-theme-accent text-theme-on-accent'
      : 'px-3 py-1 text-xs font-medium bg-theme-surface text-theme-body hover:bg-theme-muted';
  }
  nwPanel?.classList.toggle('hidden', !isNw);
  cfPanel?.classList.toggle('hidden', isNw);
}

function updatePresetLabel() {
  const presets = getPlanPresets();
  const state = getPlanState();
  const preset = presets[state.presetLevel] || presets[0];
  const nameEl = el('plan-preset-name');
  if (nameEl && preset) {
    nameEl.textContent = state.presetActive
      ? `${preset.name} — ${preset.description}`
      : `Easy Mode off (was ${preset.name})`;
  }
}

/**
 * @param {object[]} sources
 * @param {number} gen - render generation; abort if a newer render started
 */
async function renderSourceRows(sources, gen = sourceRenderGen) {
  const host = el('plan-sources-list');
  if (!host) return;
  host.innerHTML = '';

  const features = listPlanSourceFeatures();
  const seriesMap = getResolvedSeriesMap();
  const accumulateRows = sources.filter((s) => s.feature === FEATURE_ACCUMULATE);
  const accumulateOptions = accumulateRows.map((s, i) => ({
    id: s.id,
    label: s.sessionName
      ? `Accumulate — ${s.sessionName}`
      : (accumulateRows.length > 1 ? `Accumulate #${i + 1}` : 'Accumulate'),
  }));

  for (const src of sources) {
    if (gen !== sourceRenderGen) return;
    const row = document.createElement('div');
    row.className = 'relative rounded-md border border-theme-border bg-theme-surface px-3 py-2 pr-8';
    row.setAttribute('data-plan-source-id', src.id);

    const featureOpts = features.map((f) => (
      `<option value="${f.feature}" ${f.feature === src.feature ? 'selected' : ''}>${escapeHtml(f.title)}</option>`
    )).join('');

    const series = seriesMap.get(src.id) || null;
    const strategies = strategyOptionsFor(src.feature, series);
    const strategyOpts = strategies.map((s) => (
      `<option value="${s.id}" ${s.id === src.strategyId ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
    )).join('');

    const startYear = resolveDisplayedStartYear(src, series);
    const isWithdraw = src.feature === FEATURE_WITHDRAW;
    const startsAfterOpts = [
      `<option value="">(own start balance)</option>`,
      ...accumulateOptions
        .filter((a) => a.id !== src.id)
        .map((a) => (
          `<option value="${escapeAttr(a.id)}" ${src.startsAfter === a.id ? 'selected' : ''}>${escapeHtml(a.label)}</option>`
        )),
    ].join('');

    row.innerHTML = `
      <button type="button" data-action="remove" title="Remove source" aria-label="Remove source"
        class="absolute top-1 right-1 z-10 w-5 h-5 flex items-center justify-center rounded text-theme-muted hover:text-theme-danger hover:bg-theme-muted text-sm leading-none">
        ×
      </button>
      <div class="space-y-2">
        <div class="grid grid-cols-2 gap-2">
          <label class="block space-y-0.5">
            <span class="text-xs text-theme-muted">Feature</span>
            <select data-field="feature"
              class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm">
              ${featureOpts}
            </select>
          </label>
          <label class="block space-y-0.5">
            <span class="text-xs text-theme-muted">Session</span>
            <select data-field="session"
              class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm">
              <option value="">Current unsaved state</option>
            </select>
          </label>
          <label class="block space-y-0.5">
            <span class="text-xs text-theme-muted">Strategy</span>
            <select data-field="strategy"
              class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm">
              ${strategyOpts}
            </select>
          </label>
          <label class="block space-y-0.5">
            <span class="text-xs text-theme-muted">Start year (offset)</span>
            <div class="flex items-center gap-1">
              <span data-field="start-display" class="text-sm text-theme-body w-14">${startYear}</span>
              <input type="number" data-field="offset" value="${src.offsetYears || 0}" step="1"
                class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm"
                title="Year offset from auto-aligned start" />
            </div>
          </label>
        </div>
        ${isWithdraw ? `
        <div class="grid grid-cols-3 gap-2 pt-1 border-t border-theme-border">
          <label class="block space-y-0.5 col-span-1">
            <span class="text-xs text-theme-muted">Starts after</span>
            <select data-field="starts-after"
              class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm">
              ${startsAfterOpts}
            </select>
          </label>
          <label class="block space-y-0.5">
            <span class="text-xs text-theme-muted">Gap years</span>
            <input type="number" data-field="gap" min="0" step="1" value="${src.gapYears || 0}"
              class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
          </label>
          <label class="block space-y-0.5">
            <span class="text-xs text-theme-muted">Handoff</span>
            <select data-field="handoff"
              class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm">
              <option value="p10" ${src.handoffPercentile === 'p10' ? 'selected' : ''}>P10</option>
              <option value="p50" ${src.handoffPercentile === 'p50' ? 'selected' : ''}>P50</option>
              <option value="p90" ${src.handoffPercentile === 'p90' ? 'selected' : ''}>P90</option>
            </select>
          </label>
        </div>
        ` : ''}
      </div>
    `;

    host.appendChild(row);
    await populateSessionSelect(
      row.querySelector('[data-field="session"]'),
      src.feature,
      src.sessionName || '',
    );
    if (gen !== sourceRenderGen) return;
    bindSourceRow(row);
  }
}

function resolveDisplayedStartYear(src, series) {
  const state = getPlanState();
  const startAge = series?.startAge ?? (src.feature === FEATURE_ACCUMULATE || src.feature === FEATURE_WITHDRAW ? 0 : 65);
  return resolveSourceStartYear({
    startAge,
    planStartYear: state.planStartYear,
    birthYearA: state.birthYearA,
    birthYearB: state.birthYearB,
    offsetYears: src.offsetYears || 0,
  });
}

async function populateSessionSelect(selectEl, feature, currentName) {
  if (!selectEl) return;
  let names;
  try {
    const list = await sessions.list(feature);
    names = (list || []).map((s) => s.name).filter(Boolean);
  } catch {
    names = [];
  }
  const current = selectEl.value;
  selectEl.innerHTML = '';
  const unsaved = document.createElement('option');
  unsaved.value = '';
  unsaved.textContent = 'Current unsaved state';
  selectEl.appendChild(unsaved);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }
  if (currentName && !names.includes(currentName)) {
    const missing = document.createElement('option');
    missing.value = currentName;
    missing.textContent = `${currentName} (missing)`;
    selectEl.appendChild(missing);
  }
  selectEl.value = currentName || current || '';
}

function bindSourceRow(row) {
  const featureSelect = row.querySelector('[data-field="feature"]');
  if (featureSelect) {
    featureSelect.dataset.prevFeature = featureSelect.value;
    featureSelect.addEventListener('change', () => {
      if (suppressForm) return;
      const prev = featureSelect.dataset.prevFeature;
      const next = featureSelect.value;
      featureSelect.dataset.prevFeature = next;
      syncPlanFormToState();
      if (prev !== next) {
        const state = getPlanState();
        const id = row.getAttribute('data-plan-source-id');
        // Withdraw without a Starting Portfolio is all zeros — default the
        // handoff to the first Accumulate row when one exists.
        const firstAccum = next === FEATURE_WITHDRAW
          ? state.sources.find((s) => s.id !== id && s.feature === FEATURE_ACCUMULATE)
          : null;
        patchPlanState({
          sources: state.sources.map((s) => (
            s.id === id
              ? createPlanSourceRow({
                id: s.id,
                feature: next,
                strategyId: defaultStrategyIdFor(next),
                sessionName: '',
                offsetYears: s.offsetYears,
                startsAfter: firstAccum ? firstAccum.id : '',
              })
              : s
          )),
        });
        renderPlanForm();
      }
    });
  }

  for (const input of row.querySelectorAll('input, select')) {
    if (input.getAttribute('data-field') === 'feature') continue;
    input.addEventListener('change', () => {
      if (suppressForm) return;
      syncPlanFormToState();
      updateRowStartDisplay(row);
      // Re-render when starts-after changes so gap controls stay consistent.
      if (input.getAttribute('data-field') === 'starts-after') {
        renderPlanForm();
      }
    });
    if (input.tagName === 'INPUT' && input.type === 'number') {
      input.addEventListener('input', () => {
        if (input.getAttribute('data-field') === 'offset') updateRowStartDisplay(row);
      });
    }
  }

  row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
    const id = row.getAttribute('data-plan-source-id');
    const state = getPlanState();
    // One patch: keep sibling DOM edits, drop this row. Avoid sync-then-filter
    // (that re-renders with the row still present and races the async list rebuild).
    const fromDom = readSourcesFromDom(state.sources);
    patchPlanState({
      planStartYear: parseInt(el('plan-start-year')?.value, 10) || state.planStartYear,
      planEndYear: parseInt(el('plan-end-year')?.value, 10) || state.planEndYear,
      birthYearA: parsedBirth(el('plan-birth-a')?.value),
      birthYearB: parsedBirth(el('plan-birth-b')?.value),
      refreshSims: Number(el('plan-refresh-sims')?.value) || state.refreshSims,
      sources: fromDom
        .filter((s) => s.id !== id)
        .map((s) => (s.startsAfter === id ? { ...s, startsAfter: '' } : s)),
      presetActive: !!el('plan-preset-active')?.checked,
      view: state.view,
    });
    // onStateApplied → renderPlanForm; no second render.
  });
}

function updateRowStartDisplay(row) {
  const state = getPlanState();
  const id = row.getAttribute('data-plan-source-id');
  const src = state.sources.find((s) => s.id === id);
  if (!src) return;
  const series = getResolvedSeriesMap().get(id) || null;
  const offset = parseInt(row.querySelector('[data-field="offset"]')?.value, 10) || 0;
  const startAge = series?.startAge
    ?? (src.feature === FEATURE_ACCUMULATE || src.feature === FEATURE_WITHDRAW ? 0 : 65);
  const year = resolveSourceStartYear({
    startAge,
    planStartYear: parseInt(el('plan-start-year')?.value, 10) || state.planStartYear,
    birthYearA: parsedBirth(el('plan-birth-a')?.value),
    birthYearB: parsedBirth(el('plan-birth-b')?.value),
    offsetYears: offset,
  });
  const display = row.querySelector('[data-field="start-display"]');
  if (display) display.textContent = String(year);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

export function bindPlanInputs() {
  const presets = getPlanPresets();

  el('plan-preset-active')?.addEventListener('change', () => {
    if (suppressForm) return;
    if (el('plan-preset-active').checked) {
      const level = Number(el('plan-preset-level')?.value) || 0;
      const preset = presets[level];
      if (preset) applyPlanPreset(preset.id, { keepAttached: true });
      else patchPlanState({ presetActive: true });
    } else {
      detachPlanPreset();
    }
    renderPlanForm();
  });

  el('plan-preset-level')?.addEventListener('input', () => {
    if (suppressForm) return;
    const level = Number(el('plan-preset-level')?.value) || 0;
    const preset = presets[level];
    if (!preset) return;
    if (el('plan-preset-active')?.checked) {
      applyPlanPreset(preset.id, { keepAttached: true });
    } else {
      patchPlanState({ presetLevel: level });
    }
    renderPlanForm();
  });

  for (const id of [
    'plan-start-year',
    'plan-end-year',
    'plan-birth-a',
    'plan-birth-b',
    'plan-refresh-sims',
  ]) {
    el(id)?.addEventListener('change', () => {
      if (suppressForm) return;
      detachPlanPreset();
      syncPlanFormToState();
      for (const row of el('plan-sources-list')?.querySelectorAll('[data-plan-source-id]') || []) {
        updateRowStartDisplay(row);
      }
    });
  }

  el('plan-add-source')?.addEventListener('click', () => {
    syncPlanFormToState();
    const state = getPlanState();
    patchPlanState({
      sources: [
        ...state.sources,
        createPlanSourceRow({ feature: FEATURE_FALLBACK }),
      ],
    });
    renderPlanForm();
  });

  const setView = (view) => {
    setPlanView(view);
    syncViewToggle(view);
    renderPlanCharts();
  };
  el('plan-view-networth')?.addEventListener('click', () => setView('netWorth'));
  el('plan-view-cashflow')?.addEventListener('click', () => setView('cashflow'));
}
