// Accumulate config panel — DOM ↔ session state + Easy Mode presets.

import {
  getAccumulateState,
  patchAccumulateState,
  applyAccumulatePreset,
  detachAccumulatePreset,
  ALLOCATION_KEYS,
} from '../session.js';
import { getAccumulatePresets } from '../presets.js';
import { FEATURE_WITHDRAW } from '../../../state/storageKeys.js';
import { pickReturnsAllocationSlice } from '../../../state/returnsAllocationSlice.js';
import { mountPortfolioPanel } from '../../../portfolio/ui/panel.js';
import {
  populateWithdrawScenarioSelect,
  refreshLinkedPortfolioPreview,
  syncPortfolioSourceVisibility,
} from '../../../portfolio/ui/sourceControls.js';
import { buildAllocationOverTimeSeries, allocationFromConfig } from '../../../core/accumulation.js';

const SLEEVE_META = [
  { id: 'ira', label: 'IRA (pre-tax)' },
  { id: 'roth', label: 'Roth' },
  { id: 'afterTax', label: 'After-tax' },
];

/** Guard while Easy Mode writes the form (avoid treating as a user detach). */
let isApplyingPreset = false;

/** @type {ReturnType<typeof mountPortfolioPanel> | null} */
let returnsUi = null;

function el(id) {
  return document.getElementById(id);
}

function readNumber(id, fallback = 0) {
  const n = Number(el(id)?.value);
  return Number.isFinite(n) ? n : fallback;
}

function isPresetAttached() {
  return !!el('accumulate-preset-active')?.checked;
}

function currentPresetLevel() {
  const n = parseInt(el('accumulate-preset-level')?.value, 10);
  return [0, 1, 2].includes(n) ? n : 0;
}

function updatePresetName() {
  const presets = getAccumulatePresets();
  const preset = presets[currentPresetLevel()] || presets[0];
  const nameEl = el('accumulate-preset-name');
  if (nameEl && preset) {
    nameEl.textContent = `${preset.name} — ${preset.description}`;
  }
}

function updatePresetControlState() {
  const attached = isPresetAttached();
  const slider = el('accumulate-preset-level');
  if (slider) slider.disabled = !attached;
  const control = el('accumulate-preset-control');
  if (control) control.classList.toggle('opacity-50', !attached);
}

function applyLevelFromSlider() {
  const presets = getAccumulatePresets();
  const preset = presets[currentPresetLevel()];
  if (!preset) return;
  isApplyingPreset = true;
  try {
    applyAccumulatePreset(preset.id, { keepAttached: true });
    renderAccumulateForm();
  } finally {
    isApplyingPreset = false;
  }
}

/** Pull the current form into session state. */
export function syncAccumulateFormToState() {
  const state = getAccumulateState();
  const sleeves = {};
  for (const { id } of SLEEVE_META) {
    const startBalance = readNumber(`accumulate-${id}-start`, 0);
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
        ? readNumber(`accumulate-${id}-basis`, startBalance)
        : startBalance,
      contributionTiers: tiers.length ? tiers : [{ amount: 0, growthPct: 0 }],
    };
  }

  const returnsPartial = returnsUi?.readFromDom() || pickReturnsAllocationSlice(state);
  const source = document.querySelector('input[name="accumulate-portfolio-source"]:checked')?.value
    || 'local';
  const scenarioName = el('accumulate-scenario')?.value || '';

  const events = [];
  document.querySelectorAll('#accumulate-events [data-accum-event-row]').forEach((row) => {
    events.push({
      amount: Number(row.querySelector('[data-event-amount]')?.value) || 0,
      startYear: Math.max(1, parseInt(row.querySelector('[data-event-start]')?.value, 10) || 1),
      years: row.querySelector('[data-event-years]')?.value === ''
        ? ''
        : Math.max(1, parseInt(row.querySelector('[data-event-years]')?.value, 10) || 1),
    });
  });

  patchAccumulateState({
    numYears: Math.max(1, readNumber('accumulate-num-years', state.numYears)),
    afterTaxDragRate: Math.max(0, Math.min(1, readNumber('accumulate-drag', state.afterTaxDragRate))),
    numSimulations: Number(el('accumulate-paths')?.value) || state.numSimulations,
    sweepPaths: Number(el('accumulate-sweep-paths')?.value) || state.sweepPaths,
    exploreWeights: !!el('accumulate-explore-weights')?.checked,
    ...returnsPartial,
    allocationOverTimeTiers: state.allocationOverTimeTiers?.length > 1
      ? state.allocationOverTimeTiers
      : [returnsPartial.allocation],
    sleeves,
    events,
    presetActive: isPresetAttached(),
    presetLevel: currentPresetLevel(),
    portfolioSource: source,
    scenarioRef: source === 'link' && scenarioName
      ? { feature: FEATURE_WITHDRAW, name: scenarioName }
      : null,
  });
}

async function updateAccumulatePortfolioSourceUi() {
  const source = document.querySelector('input[name="accumulate-portfolio-source"]:checked')?.value
    || getAccumulateState().portfolioSource
    || 'local';
  syncPortfolioSourceVisibility({
    source,
    linkWrapEl: el('accumulate-link-wrap'),
    localHostEl: el('accumulate-returns-host'),
  });
  if (source === 'link') {
    await refreshLinkedPortfolioPreview(
      el('accumulate-portfolio-preview'),
      el('accumulate-scenario')?.value,
    );
  } else {
    returnsUi?.refreshFromState();
  }
}

export async function refreshAccumulateScenarioPicker() {
  const current = getAccumulateState().scenarioRef?.name || '';
  await populateWithdrawScenarioSelect(el('accumulate-scenario'), current);
  await updateAccumulatePortfolioSourceUi();
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
  const host = el('accumulate-sleeves');
  if (!host) return;
  host.innerHTML = SLEEVE_META.map(({ id, label }) => {
    const sleeve = state.sleeves[id];
    const tiers = sleeve.contributionTiers || [{ amount: 0, growthPct: 0 }];
    const basisField = id === 'afterTax'
      ? `<label class="block space-y-1">
          <span class="text-xs text-theme-muted">Basis ($000s)</span>
          <input type="number" id="accumulate-${id}-basis" value="${sleeve.basis ?? sleeve.startBalance}"
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
          <input type="number" id="accumulate-${id}-start" value="${sleeve.startBalance ?? 0}"
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
      syncAccumulateFormToState();
      detachAccumulatePreset();
      updatePresetControlState();
      const id = btn.getAttribute('data-add-tier');
      const current = getAccumulateState();
      const tiers = [...(current.sleeves[id].contributionTiers || [])];
      if (tiers.length) {
        const last = tiers[tiers.length - 1];
        tiers[tiers.length - 1] = { ...last, years: last.years || 5 };
      }
      tiers.push({ amount: 0, growthPct: 0 });
      patchAccumulateState({
        sleeves: {
          ...current.sleeves,
          [id]: { ...current.sleeves[id], contributionTiers: tiers },
        },
        presetActive: false,
      });
      renderAccumulateForm();
    });
  });
}

function renderEvents(state) {
  const host = el('accumulate-events');
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
      syncAccumulateFormToState();
      const idx = Number(btn.getAttribute('data-remove-event'));
      const eventsNext = [...getAccumulateState().events];
      eventsNext.splice(idx, 1);
      patchAccumulateState({ events: eventsNext, presetActive: false });
      if (el('accumulate-preset-active')) el('accumulate-preset-active').checked = false;
      updatePresetControlState();
      renderAccumulateForm();
    });
  });
}

function renderEasyMode(state) {
  if (el('accumulate-preset-active')) {
    el('accumulate-preset-active').checked = state.presetActive !== false;
  }
  if (el('accumulate-preset-level')) {
    el('accumulate-preset-level').value = String(state.presetLevel ?? 0);
  }
  updatePresetName();
  updatePresetControlState();
}

/** Paint the form from session state. */
export function renderAccumulateForm() {
  const state = getAccumulateState();
  if (el('accumulate-num-years')) el('accumulate-num-years').value = state.numYears;
  if (el('accumulate-drag')) el('accumulate-drag').value = state.afterTaxDragRate;
  if (el('accumulate-paths')) el('accumulate-paths').value = String(state.numSimulations);
  if (el('accumulate-sweep-paths')) el('accumulate-sweep-paths').value = String(state.sweepPaths);
  if (el('accumulate-explore-weights')) el('accumulate-explore-weights').checked = state.exploreWeights !== false;
  renderEasyMode(state);
  renderSleeves(state);
  renderEvents(state);

  const source = state.scenarioRef?.name ? 'link' : (state.portfolioSource || 'local');
  const linkRadio = el('accumulate-source-link');
  const localRadio = el('accumulate-source-local');
  if (linkRadio) linkRadio.checked = source === 'link';
  if (localRadio) localRadio.checked = source !== 'link';
  returnsUi?.refreshFromState();
  void refreshAccumulateScenarioPicker();
}

/** Deterministic glidepath series for the preview chart (engine decimals). */
export function getGlidePreviewSeries() {
  const state = getAccumulateState();
  const start = allocationFromConfig(state.allocation, ALLOCATION_KEYS);
  return buildAllocationOverTimeSeries(
    state.allocationOverTimeTiers,
    state.numYears,
    start,
    ALLOCATION_KEYS,
  );
}

export function bindAccumulateInputs() {
  const host = el('accumulate-returns-host');
  if (host && !returnsUi) {
    returnsUi = mountPortfolioPanel(host, {
      idPrefix: 'accumulate-',
      mountMarkup: true,
      wrapAccordion: true,
      showOverTime: false,
      syncSparklines: true,
      sectionTitle: 'Investment Planning',
      sectionHelp: 'Historical years, distribution method, and asset allocation for Monte Carlo returns.',
      getPortfolio: () => pickReturnsAllocationSlice(getAccumulateState()),
      setPortfolio: (partial) => {
        patchAccumulateState({ ...partial, portfolioSource: 'local' });
      },
      onChange: () => {
        if (isApplyingPreset) return;
        if (getAccumulateState().presetActive) {
          detachAccumulatePreset();
          if (el('accumulate-preset-active')) el('accumulate-preset-active').checked = false;
          updatePresetControlState();
        }
      },
    });
  }

  renderAccumulateForm();

  const root = el('feature-accumulate');
  if (!root) return;

  el('accumulate-preset-active')?.addEventListener('change', () => {
    if (isApplyingPreset) return;
    if (isPresetAttached()) {
      applyLevelFromSlider();
    } else {
      detachAccumulatePreset();
      updatePresetControlState();
    }
  });

  el('accumulate-preset-level')?.addEventListener('input', () => {
    updatePresetName();
    if (isApplyingPreset || !isPresetAttached()) return;
    applyLevelFromSlider();
  });

  document.querySelectorAll('input[name="accumulate-portfolio-source"]').forEach((r) => {
    r.addEventListener('change', () => {
      syncAccumulateFormToState();
      void updateAccumulatePortfolioSourceUi();
    });
  });
  el('accumulate-scenario')?.addEventListener('change', () => {
    syncAccumulateFormToState();
    void updateAccumulatePortfolioSourceUi();
  });

  root.addEventListener('change', (e) => {
    if (isApplyingPreset) return;
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.id === 'accumulate-preset-active'
      || e.target.id === 'accumulate-preset-level'
      || e.target.closest('#accumulate-preset-control')) {
      return;
    }
    if (e.target.name === 'accumulate-portfolio-source'
      || e.target.id === 'accumulate-scenario') {
      return;
    }
    if (e.target.closest('#accumulate-returns-host')) {
      // Shared controller already patched state via setSlice.
      return;
    }
    if (e.target.closest('#accumulate-sleeves')
      || e.target.closest('#accumulate-events')
      || e.target.id?.startsWith('accumulate-')) {
      const wasAttached = getAccumulateState().presetActive;
      syncAccumulateFormToState();
      if (wasAttached) {
        detachAccumulatePreset();
        if (el('accumulate-preset-active')) el('accumulate-preset-active').checked = false;
        updatePresetControlState();
      }
    }
  });

  el('accumulate-add-event')?.addEventListener('click', () => {
    syncAccumulateFormToState();
    const events = [...getAccumulateState().events, { amount: -25, startYear: 5, years: 1 }];
    patchAccumulateState({ events, presetActive: false });
    if (el('accumulate-preset-active')) el('accumulate-preset-active').checked = false;
    updatePresetControlState();
    renderAccumulateForm();
  });
}
