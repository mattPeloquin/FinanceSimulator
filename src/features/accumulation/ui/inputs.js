// Accumulation config panel — DOM ↔ session state + Easy Mode presets.

import {
  getAccumulationState,
  patchAccumulationState,
  applyAccumulationPreset,
  detachAccumulationPreset,
  ALLOCATION_KEYS,
} from '../session.js';
import { getAccumulationPresets } from '../presets.js';
import { pickReturnsAllocationSlice } from '../../../state/returnsAllocationSlice.js';
import { createReturnsAllocationUi } from '../../../ui/returnsAllocation/controller.js';
import { buildAllocationOverTimeSeries, allocationFromConfig } from '../../../core/accumulation.js';

const SLEEVE_META = [
  { id: 'ira', label: 'IRA (pre-tax)' },
  { id: 'roth', label: 'Roth' },
  { id: 'afterTax', label: 'After-tax' },
];

/** Guard while Easy Mode writes the form (avoid treating as a user detach). */
let isApplyingPreset = false;

/** @type {ReturnType<typeof createReturnsAllocationUi> | null} */
let returnsUi = null;

function el(id) {
  return document.getElementById(id);
}

function readNumber(id, fallback = 0) {
  const n = Number(el(id)?.value);
  return Number.isFinite(n) ? n : fallback;
}

function isPresetAttached() {
  return !!el('accumulation-preset-active')?.checked;
}

function currentPresetLevel() {
  const n = parseInt(el('accumulation-preset-level')?.value, 10);
  return [0, 1, 2].includes(n) ? n : 0;
}

function updatePresetName() {
  const presets = getAccumulationPresets();
  const preset = presets[currentPresetLevel()] || presets[0];
  const nameEl = el('accumulation-preset-name');
  if (nameEl && preset) {
    nameEl.textContent = `${preset.name} — ${preset.description}`;
  }
}

function updatePresetControlState() {
  const attached = isPresetAttached();
  const slider = el('accumulation-preset-level');
  if (slider) slider.disabled = !attached;
  const control = el('accumulation-preset-control');
  if (control) control.classList.toggle('opacity-50', !attached);
}

function applyLevelFromSlider() {
  const presets = getAccumulationPresets();
  const preset = presets[currentPresetLevel()];
  if (!preset) return;
  isApplyingPreset = true;
  try {
    applyAccumulationPreset(preset.id, { keepAttached: true });
    renderAccumulationForm();
  } finally {
    isApplyingPreset = false;
  }
}

/** Pull the current form into session state. */
export function syncAccumulationFormToState() {
  const state = getAccumulationState();
  const sleeves = {};
  for (const { id } of SLEEVE_META) {
    const startBalance = readNumber(`accumulation-${id}-start`, 0);
    const tiers = [];
    const rows = document.querySelectorAll(`[data-accum-sleeve="${id}"] [data-accum-tier-row]`);
    rows.forEach((row, index, arr) => {
      const amount = Number(row.querySelector('[data-tier-amount]')?.value) || 0;
      const growthPct = Number(row.querySelector('[data-tier-growth]')?.value) || 0;
      if (index === arr.length - 1) {
        tiers.push({ amount, growthPct });
      } else {
        const years = Math.max(1, parseInt(row.querySelector('[data-tier-years]')?.value, 10) || 1);
        tiers.push({ amount, growthPct, years });
      }
    });
    sleeves[id] = {
      startBalance,
      basis: id === 'afterTax'
        ? readNumber(`accumulation-${id}-basis`, startBalance)
        : startBalance,
      contributionTiers: tiers.length ? tiers : [{ amount: 0, growthPct: 0 }],
    };
  }

  const returnsPartial = returnsUi?.readFromDom() || pickReturnsAllocationSlice(state);

  const events = [];
  document.querySelectorAll('#accumulation-events [data-accum-event-row]').forEach((row) => {
    events.push({
      amount: Number(row.querySelector('[data-event-amount]')?.value) || 0,
      startYear: Math.max(1, parseInt(row.querySelector('[data-event-start]')?.value, 10) || 1),
      years: row.querySelector('[data-event-years]')?.value === ''
        ? ''
        : Math.max(1, parseInt(row.querySelector('[data-event-years]')?.value, 10) || 1),
    });
  });

  patchAccumulationState({
    numYears: Math.max(1, readNumber('accumulation-num-years', state.numYears)),
    afterTaxDragRate: Math.max(0, Math.min(1, readNumber('accumulation-drag', state.afterTaxDragRate))),
    numSimulations: Number(el('accumulation-paths')?.value) || state.numSimulations,
    sweepPaths: Number(el('accumulation-sweep-paths')?.value) || state.sweepPaths,
    exploreWeights: !!el('accumulation-explore-weights')?.checked,
    ...returnsPartial,
    allocationOverTimeTiers: state.allocationOverTimeTiers?.length > 1
      ? state.allocationOverTimeTiers
      : [returnsPartial.allocation],
    sleeves,
    events,
    presetActive: isPresetAttached(),
    presetLevel: currentPresetLevel(),
  });
}

function tierRowHtml(tier, isLast) {
  return `
    <div data-accum-tier-row class="grid grid-cols-3 gap-2 items-end">
      <label class="block space-y-0.5">
        <span class="text-xs text-theme-muted">Amount ($000s/yr)</span>
        <input type="number" data-tier-amount step="0.1" value="${tier.amount ?? 0}"
          class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
      </label>
      <label class="block space-y-0.5">
        <span class="text-xs text-theme-muted">Growth %</span>
        <input type="number" data-tier-growth step="0.1" value="${tier.growthPct ?? 0}"
          class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
      </label>
      <label class="block space-y-0.5">
        <span class="text-xs text-theme-muted">${isLast ? 'Years (rest)' : 'Years'}</span>
        <input type="number" data-tier-years min="1" ${isLast ? 'disabled placeholder="rest"' : `value="${tier.years ?? 1}"`}
          class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm disabled:opacity-50" />
      </label>
    </div>`;
}

function renderSleeves(state) {
  const host = el('accumulation-sleeves');
  if (!host) return;
  host.innerHTML = SLEEVE_META.map(({ id, label }) => {
    const sleeve = state.sleeves[id];
    const tiers = sleeve.contributionTiers || [{ amount: 0, growthPct: 0 }];
    const basisField = id === 'afterTax'
      ? `<label class="block space-y-1">
          <span class="text-xs text-theme-muted">Basis ($000s)</span>
          <input type="number" id="accumulation-${id}-basis" value="${sleeve.basis ?? sleeve.startBalance}"
            class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
        </label>`
      : '';
    return `
      <div data-accum-sleeve="${id}" class="rounded-lg border border-theme-border/70 px-3 py-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-semibold text-theme-heading">${label}</h4>
          <button type="button" data-add-tier="${id}" class="text-xs text-theme-accent hover:underline">Add tier</button>
        </div>
        <label class="block space-y-1">
          <span class="text-xs text-theme-muted">Start balance ($000s)</span>
          <input type="number" id="accumulation-${id}-start" value="${sleeve.startBalance ?? 0}"
            class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
        </label>
        ${basisField}
        <div class="space-y-2" data-tier-list>
          ${tiers.map((t, i) => tierRowHtml(t, i === tiers.length - 1)).join('')}
        </div>
      </div>`;
  }).join('');

  host.querySelectorAll('[data-add-tier]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncAccumulationFormToState();
      detachAccumulationPreset();
      updatePresetControlState();
      const id = btn.getAttribute('data-add-tier');
      const current = getAccumulationState();
      const tiers = [...(current.sleeves[id].contributionTiers || [])];
      if (tiers.length) {
        const last = tiers[tiers.length - 1];
        tiers[tiers.length - 1] = { ...last, years: last.years || 5 };
      }
      tiers.push({ amount: 0, growthPct: 0 });
      patchAccumulationState({
        sleeves: {
          ...current.sleeves,
          [id]: { ...current.sleeves[id], contributionTiers: tiers },
        },
        presetActive: false,
      });
      renderAccumulationForm();
    });
  });
}

function renderEvents(state) {
  const host = el('accumulation-events');
  if (!host) return;
  const events = state.events?.length ? state.events : [];
  host.innerHTML = events.map((e, i) => `
    <div data-accum-event-row class="grid grid-cols-4 gap-2 items-end">
      <label class="block space-y-0.5 col-span-1">
        <span class="text-xs text-theme-muted">Amount</span>
        <input type="number" data-event-amount value="${e.amount}" class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
      </label>
      <label class="block space-y-0.5">
        <span class="text-xs text-theme-muted">Start yr</span>
        <input type="number" data-event-start min="1" value="${e.startYear}" class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
      </label>
      <label class="block space-y-0.5">
        <span class="text-xs text-theme-muted">Years</span>
        <input type="number" data-event-years min="1" value="${e.years === '' ? '' : e.years}" placeholder="1"
          class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
      </label>
      <button type="button" data-remove-event="${i}" class="text-xs text-theme-muted hover:text-theme-heading pb-2">Remove</button>
    </div>`).join('') || '<p class="text-xs text-theme-faint">No events.</p>';

  host.querySelectorAll('[data-remove-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncAccumulationFormToState();
      const idx = Number(btn.getAttribute('data-remove-event'));
      const eventsNext = [...getAccumulationState().events];
      eventsNext.splice(idx, 1);
      patchAccumulationState({ events: eventsNext, presetActive: false });
      if (el('accumulation-preset-active')) el('accumulation-preset-active').checked = false;
      updatePresetControlState();
      renderAccumulationForm();
    });
  });
}

function renderEasyMode(state) {
  if (el('accumulation-preset-active')) {
    el('accumulation-preset-active').checked = state.presetActive !== false;
  }
  if (el('accumulation-preset-level')) {
    el('accumulation-preset-level').value = String(state.presetLevel ?? 0);
  }
  updatePresetName();
  updatePresetControlState();
}

/** Paint the form from session state. */
export function renderAccumulationForm() {
  const state = getAccumulationState();
  if (el('accumulation-num-years')) el('accumulation-num-years').value = state.numYears;
  if (el('accumulation-drag')) el('accumulation-drag').value = state.afterTaxDragRate;
  if (el('accumulation-paths')) el('accumulation-paths').value = String(state.numSimulations);
  if (el('accumulation-sweep-paths')) el('accumulation-sweep-paths').value = String(state.sweepPaths);
  if (el('accumulation-explore-weights')) el('accumulation-explore-weights').checked = state.exploreWeights !== false;
  renderEasyMode(state);
  renderSleeves(state);
  renderEvents(state);
  returnsUi?.refreshFromState();
}

/** Deterministic glidepath series for the preview chart (engine decimals). */
export function getGlidePreviewSeries() {
  const state = getAccumulationState();
  const start = allocationFromConfig(state.allocation, ALLOCATION_KEYS);
  return buildAllocationOverTimeSeries(
    state.allocationOverTimeTiers,
    state.numYears,
    start,
    ALLOCATION_KEYS,
  );
}

export function bindAccumulationInputs() {
  const host = el('accumulation-returns-host');
  if (host && !returnsUi) {
    returnsUi = createReturnsAllocationUi(host, {
      idPrefix: 'accumulation-',
      mountMarkup: true,
      getSlice: () => pickReturnsAllocationSlice(getAccumulationState()),
      setSlice: (partial) => {
        patchAccumulationState(partial);
      },
      onChange: () => {
        if (isApplyingPreset) return;
        if (getAccumulationState().presetActive) {
          detachAccumulationPreset();
          if (el('accumulation-preset-active')) el('accumulation-preset-active').checked = false;
          updatePresetControlState();
        }
      },
    });
  }

  renderAccumulationForm();

  const root = el('feature-accumulation');
  if (!root) return;

  el('accumulation-preset-active')?.addEventListener('change', () => {
    if (isApplyingPreset) return;
    if (isPresetAttached()) {
      applyLevelFromSlider();
    } else {
      detachAccumulationPreset();
      updatePresetControlState();
    }
  });

  el('accumulation-preset-level')?.addEventListener('input', () => {
    updatePresetName();
    if (isApplyingPreset || !isPresetAttached()) return;
    applyLevelFromSlider();
  });

  root.addEventListener('change', (e) => {
    if (isApplyingPreset) return;
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.id === 'accumulation-preset-active'
      || e.target.id === 'accumulation-preset-level'
      || e.target.closest('#accumulation-preset-control')) {
      return;
    }
    if (e.target.closest('#accumulation-returns-host')) {
      // Shared controller already patched state via setSlice.
      return;
    }
    if (e.target.closest('#accumulation-sleeves')
      || e.target.closest('#accumulation-events')
      || e.target.id?.startsWith('accumulation-')) {
      const wasAttached = getAccumulationState().presetActive;
      syncAccumulationFormToState();
      if (wasAttached) {
        detachAccumulationPreset();
        if (el('accumulation-preset-active')) el('accumulation-preset-active').checked = false;
        updatePresetControlState();
      }
    }
  });

  el('accumulation-add-event')?.addEventListener('click', () => {
    syncAccumulationFormToState();
    const events = [...getAccumulationState().events, { amount: -25, startYear: 5, years: 1 }];
    patchAccumulationState({ events, presetActive: false });
    if (el('accumulation-preset-active')) el('accumulation-preset-active').checked = false;
    updatePresetControlState();
    renderAccumulationForm();
  });
}
